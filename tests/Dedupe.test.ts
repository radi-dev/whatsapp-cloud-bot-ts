/**
 * Webhook redelivery idempotency.
 *
 * WhatsApp redelivers a webhook (with backoff) whenever it does not get a
 * timely 200 — including when the handler already ran and committed. These
 * tests pin down how that interacts with the context store and the
 * optimistic-locking retries.
 */
import { WhatsApp } from '../src/WhatsApp.js';
import { TextHandler } from '../src/Handlers.js';
import { MemoryContextStore } from '../src/context/MemoryContextStore.js';
import {
  UserContext,
  RECENT_MESSAGES_KEY,
  RECENT_MESSAGES_LIMIT,
} from '../src/context/UserContext.js';
import { ContextStoreError } from '../src/context/ContextStore.js';
import type { WebhookPayload } from '../src/types/index.js';

const PHONE_NUMBER_ID = '106540352242922';

function textPayload(
  from: string,
  body: string,
  id: string,
  timestamp = String(Math.floor(Date.now() / 1000))
): WebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550783881',
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [{ profile: { name: 'Test' }, wa_id: from }],
              messages: [{ from, id, timestamp, type: 'text', text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

function makeClient(
  store?: MemoryContextStore,
  options: { dedupeMessages?: boolean; contextConflictRetries?: number } = {}
): WhatsApp {
  return new WhatsApp({
    numberId: PHONE_NUMBER_ID,
    token: 'test-token',
    markAsRead: false,
    contextStore: store,
    ...options,
  });
}

describe('webhook redelivery dedupe (default on)', () => {
  let store: MemoryContextStore;

  beforeEach(() => {
    store = new MemoryContextStore();
  });

  it('a redelivered message (same wamid) is not applied twice', async () => {
    const client = makeClient(store);
    let runs = 0;
    client.onTextMessage(async (_u, context) => {
      runs++;
      context.set('count', context.get('count', 0) + 1);
    });

    const payload = textPayload('111', 'hi', 'wamid.A');
    await client.processUpdate(payload);
    await client.processUpdate(payload); // WhatsApp retry of the same webhook
    await client.processUpdate(payload);

    expect(runs).toBe(1);
    expect((await store.get('111'))?.data.count).toBe(1);
  });

  it('distinct messages are still processed', async () => {
    const client = makeClient(store);
    client.onTextMessage(async (_u, context) => {
      context.set('count', context.get('count', 0) + 1);
    });
    await client.processUpdate(textPayload('111', 'a', 'wamid.A'));
    await client.processUpdate(textPayload('111', 'b', 'wamid.B'));
    expect((await store.get('111'))?.data.count).toBe(2);
  });

  it('handled ids are committed in the same record as the handler changes', async () => {
    const client = makeClient(store);
    client.onTextMessage(async (_u, context) => context.set('seen', true));
    await client.processUpdate(textPayload('111', 'a', 'wamid.A'));
    expect((await store.get('111'))?.data).toEqual({
      seen: true,
      [RECENT_MESSAGES_KEY]: ['wamid.A'],
    });
  });

  it('a message whose handler failed is NOT marked, so the redelivery re-runs it', async () => {
    const client = makeClient(store);
    let attempt = 0;
    client.onTextMessage(async (_u, context) => {
      attempt++;
      if (attempt === 1) throw new Error('transient');
      context.set('done', true);
    });

    const payload = textPayload('111', 'x', 'wamid.A');
    await expect(client.processUpdate(payload)).rejects.toThrow('transient'); // -> app returns 500
    await client.processUpdate(payload); // WhatsApp redelivers
    expect(attempt).toBe(2);
    expect((await store.get('111'))?.data.done).toBe(true);
  });

  it('also protects stateless handlers (the marker rides on the loaded record)', async () => {
    const client = makeClient(store);
    let runs = 0;
    client.onTextMessage(async () => {
      runs++;
    });
    const payload = textPayload('111', 'x', 'wamid.A');
    await client.processUpdate(payload);
    await client.processUpdate(payload);
    expect(runs).toBe(1);
  });

  it('a redelivery that lands on another instance is skipped too', async () => {
    const instanceA = makeClient(store);
    const instanceB = makeClient(store);
    let runs = 0;
    for (const instance of [instanceA, instanceB]) {
      instance.onTextMessage(async (_u, context) => {
        runs++;
        context.set('count', context.get('count', 0) + 1);
      });
    }
    const payload = textPayload('111', 'x', 'wamid.A');
    await instanceA.processUpdate(payload);
    await instanceB.processUpdate(payload);
    expect(runs).toBe(1);
    expect((await store.get('111'))?.data.count).toBe(1);
  });

  it('a redelivery racing the original on another instance converges to a single application', async () => {
    // Instance A is still running the handler for wamid.A (slow) when the
    // redelivery reaches instance B. B's commit wins; A's save conflicts,
    // re-runs, and on the re-run sees the id and skips.
    const instanceA = makeClient(store);
    const instanceB = makeClient(store);
    let gateOpen!: () => void;
    const gate = new Promise<void>((r) => (gateOpen = r));
    const runs: string[] = [];
    let firstA = true;

    instanceA.onTextMessage(async (_u, context) => {
      runs.push('A');
      if (firstA) {
        firstA = false;
        await gate;
      }
      context.set('count', context.get('count', 0) + 1);
    });
    instanceB.onTextMessage(async (_u, context) => {
      runs.push('B');
      context.set('count', context.get('count', 0) + 1);
    });

    const payload = textPayload('111', 'x', 'wamid.A');
    const a = instanceA.processUpdate(payload);
    await new Promise((r) => setImmediate(r));
    await instanceB.processUpdate(payload);
    gateOpen();
    await a;

    expect(runs).toEqual(['A', 'B']); // A's re-run skipped without invoking the handler
    expect((await store.get('111'))?.data.count).toBe(1);
  });

  it('a consumed next step is not consumed again by a redelivery', async () => {
    const client = makeClient(store);
    const seen: string[] = [];
    client.registerStep(
      'step',
      new TextHandler(async () => void seen.push('step'))
    );
    client.onTextMessage(async () => void seen.push('regular'));

    await client.setNextStep('111', 'step');
    const payload = textPayload('111', 'x', 'wamid.A');
    await client.processUpdate(payload);
    await client.processUpdate(payload); // without dedupe this would hit the regular handler
    expect(seen).toEqual(['step']);
  });

  it('keeps only the most recent ids', async () => {
    const client = makeClient(store);
    client.onTextMessage(async () => {});
    for (let i = 0; i < RECENT_MESSAGES_LIMIT + 5; i++) {
      await client.processUpdate(textPayload('111', 'x', `wamid.${i}`));
    }
    const ids = (await store.get('111'))?.data[RECENT_MESSAGES_KEY] as string[];
    expect(ids).toHaveLength(RECENT_MESSAGES_LIMIT);
    expect(ids[0]).toBe('wamid.5');
    expect(ids[ids.length - 1]).toBe(`wamid.${RECENT_MESSAGES_LIMIT + 4}`);
  });

  it('keeps the record alive after context.clear() (ids must survive until TTL)', async () => {
    const client = makeClient(store);
    client.onTextMessage(async (_u, context) => {
      context.set('a', 1);
      context.clear();
    });
    await client.processUpdate(textPayload('111', 'x', 'wamid.A'));
    expect((await store.get('111'))?.data).toEqual({
      [RECENT_MESSAGES_KEY]: ['wamid.A'],
    });
    // clearContext / destroy wipe everything, ids included
    await client.clearContext('111');
    expect(await store.get('111')).toBeUndefined();
  });

  it('a message no handler matched is not marked (nothing happened, retry is harmless)', async () => {
    const client = makeClient(store);
    client.onTextMessage(async () => {}, { regex: /^only-this$/ });
    await client.processUpdate(textPayload('111', 'other', 'wamid.A'));
    expect(await store.get('111')).toBeUndefined();
  });

  it('messages older than ignoreAfterMinutes (default 5) are dropped regardless — late WhatsApp retries never run handlers', async () => {
    const client = makeClient(store);
    let runs = 0;
    client.onTextMessage(async () => {
      runs++;
    });
    const tenMinutesAgo = String(Math.floor(Date.now() / 1000) - 10 * 60);
    await client.processUpdate(
      textPayload('111', 'late', 'wamid.late', tenMinutesAgo)
    );
    expect(runs).toBe(0);
  });

  it('can be disabled', async () => {
    const client = makeClient(store, { dedupeMessages: false });
    let runs = 0;
    client.onTextMessage(async () => {
      runs++;
    });
    const payload = textPayload('111', 'x', 'wamid.A');
    await client.processUpdate(payload);
    await client.processUpdate(payload);
    expect(runs).toBe(2);
    expect(await store.get('111')).toBeUndefined();
  });

  it('has no effect without a context store (nothing to remember ids in)', async () => {
    const client = makeClient();
    let runs = 0;
    client.onTextMessage(async () => {
      runs++;
    });
    const payload = textPayload('111', 'x', 'wamid.A');
    await client.processUpdate(payload);
    await client.processUpdate(payload);
    expect(runs).toBe(2);
  });
});

describe('UserContext handled-message API', () => {
  it('tracks ids, hides the reserved key and guards it', async () => {
    const store = new MemoryContextStore();
    const ctx = await UserContext.load(store, '1');
    expect(ctx.hasSeenMessage('a')).toBe(false);
    ctx.markMessageSeen('a').markMessageSeen('a').markMessageSeen('');
    expect(ctx.recentMessages).toEqual(['a']);
    expect(ctx.hasSeenMessage('a')).toBe(true);
    expect(ctx.isEmpty).toBe(true); // ids are not user data
    expect(ctx.keys()).toEqual([]);
    expect(ctx.isDirty).toBe(true);
    expect(() => ctx.get(RECENT_MESSAGES_KEY)).toThrow(ContextStoreError);
    expect(() => ctx.set(RECENT_MESSAGES_KEY, [])).toThrow(ContextStoreError);
    await ctx.save();
    const again = await UserContext.load(store, '1');
    expect(again.recentMessages).toEqual(['a']);
  });

  it('ignores a malformed stored list', async () => {
    const store = new MemoryContextStore();
    await store.set('1', { [RECENT_MESSAGES_KEY]: 'nope' }, 0);
    const ctx = await UserContext.load(store, '1');
    expect(ctx.recentMessages).toEqual([]);
  });
});
