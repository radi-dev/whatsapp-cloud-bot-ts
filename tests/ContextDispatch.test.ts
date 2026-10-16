import { jest } from '@jest/globals';
import { WhatsApp } from '../src/WhatsApp.js';
import { Dispatcher } from '../src/Dispatcher.js';
import { TextHandler, handlerUsesContext } from '../src/Handlers.js';
import { MemoryContextStore } from '../src/context/MemoryContextStore.js';
import {
  ContextConflictError,
  ContextStoreRequiredError,
} from '../src/context/ContextStore.js';
import type { WebhookPayload, HandlerFunction } from '../src/types/index.js';

const PHONE_NUMBER_ID = '106540352242922';
const nowSeconds = () => String(Math.floor(Date.now() / 1000));

function textPayload(from: string, body: string): WebhookPayload {
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
              messages: [
                {
                  from,
                  id: `wamid.${from}.${body}.${Math.random()}`,
                  timestamp: nowSeconds(),
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function makeClient(
  store?: MemoryContextStore,
  contextConflictRetries?: number
): WhatsApp {
  return new WhatsApp({
    numberId: PHONE_NUMBER_ID,
    token: 'test-token',
    markAsRead: false,
    contextStore: store,
    contextConflictRetries,
    // Exact record contents are asserted here; redelivery dedupe is covered
    // in Dedupe.test.ts.
    dedupeMessages: false,
  });
}

/** A manual gate: `wait()` blocks until `open()` is called. */
function makeGate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, wait: () => opened };
}

const stateless: HandlerFunction = async (_update) => {};
const stateful: HandlerFunction = async (_update, _context) => {};

// -----------------------------------------------------------------------------
// Detection
// -----------------------------------------------------------------------------

describe('handlerUsesContext', () => {
  it('auto-detects from the declared parameter count', () => {
    expect(handlerUsesContext(stateless)).toBe(false);
    expect(handlerUsesContext(stateful)).toBe(true);
    expect(handlerUsesContext(async () => {})).toBe(false);
    expect(handlerUsesContext(async function (_u, _c) {})).toBe(true);
  });

  it('explicit option overrides detection', () => {
    expect(handlerUsesContext(stateless, { context: true })).toBe(true);
    expect(handlerUsesContext(stateful, { context: false })).toBe(false);
  });

  it('is reflected on the handler instance', () => {
    expect(new TextHandler(stateless).context).toBe(false);
    expect(new TextHandler(stateful).context).toBe(true);
    expect(new TextHandler(stateful, { context: false }).context).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Hard fail when context is referenced without a store
// -----------------------------------------------------------------------------

describe('hard fail without a contextStore', () => {
  it('stateless handlers work fine without a store', async () => {
    const client = makeClient();
    const seen: string[] = [];
    client.onTextMessage(async (update) => {
      seen.push(update.messageText ?? '');
    });
    await client.processUpdate(textPayload('111', 'hi'));
    expect(seen).toEqual(['hi']);
  });

  it('throws at registration for every on* method when the handler declares context', () => {
    const client = makeClient();
    const methods = [
      'onTextMessage',
      'onMessage',
      'onButtonMessage',
      'onInteractiveMessage',
      'onButtonReply',
      'onListReply',
      'onFlowReply',
      'onImageMessage',
      'onAudioMessage',
      'onVideoMessage',
      'onDocumentMessage',
      'onStickerMessage',
      'onLocationMessage',
    ] as const;

    for (const method of methods) {
      expect(() => client[method](stateful)).toThrow(ContextStoreRequiredError);
      expect(() => client[method](stateless)).not.toThrow();
    }
  });

  it('throws when { context: true } is forced without a store', () => {
    const client = makeClient();
    expect(() => client.onTextMessage(stateless, { context: true })).toThrow(
      ContextStoreRequiredError
    );
  });

  it('does not throw when a 2-arg handler opts out with { context: false }', async () => {
    const client = makeClient();
    let received: unknown = 'unset';
    client.onTextMessage(
      async (_update, context) => {
        received = context;
      },
      { context: false }
    );
    await client.processUpdate(textPayload('111', 'hi'));
    expect(received).toBeUndefined();
  });

  it('throws from the constructor `handlers` option', () => {
    expect(
      () =>
        new WhatsApp({
          numberId: PHONE_NUMBER_ID,
          token: 't',
          handlers: { h: new TextHandler(stateful) },
        })
    ).toThrow(ContextStoreRequiredError);
  });

  it('throws from registerStep / setNextStep / clearNextStep / getNextStep (steps live in the store)', async () => {
    const client = makeClient();
    expect(() => client.registerStep('s', new TextHandler(stateless))).toThrow(
      ContextStoreRequiredError
    );
    await expect(client.setNextStep('111', 's')).rejects.toThrow(
      ContextStoreRequiredError
    );
    await expect(client.clearNextStep('111')).rejects.toThrow(
      ContextStoreRequiredError
    );
    await expect(client.getNextStep('111')).rejects.toThrow(
      ContextStoreRequiredError
    );
  });

  it('throws when update.context is accessed without a store', async () => {
    const client = makeClient();
    let error: unknown;
    client.onTextMessage(async (update) => {
      try {
        update.context.get('x');
      } catch (e) {
        error = e;
      }
    });
    await client.processUpdate(textPayload('111', 'hi'));
    expect(error).toBeInstanceOf(ContextStoreRequiredError);
  });

  it('throws from getContext / clearContext', async () => {
    const client = makeClient();
    await expect(client.getContext('111')).rejects.toThrow(
      ContextStoreRequiredError
    );
    await expect(client.clearContext('111')).rejects.toThrow(
      ContextStoreRequiredError
    );
  });

  it('the error message tells the developer what to do', () => {
    const client = makeClient();
    expect(() => client.onTextMessage(stateful)).toThrow(/contextStore/);
    expect(() => client.onTextMessage(stateful)).toThrow(/context: false/);
  });

  it('Dispatcher.registerHandler enforces it directly too', () => {
    const dispatcher = new Dispatcher(makeClient() as never, false, false, {});
    expect(() => dispatcher.registerHandler(new TextHandler(stateful))).toThrow(
      ContextStoreRequiredError
    );
  });
});

// -----------------------------------------------------------------------------
// Lifecycle: load → handler → save
// -----------------------------------------------------------------------------

describe('context lifecycle around handlers', () => {
  let store: MemoryContextStore;

  beforeEach(() => {
    store = new MemoryContextStore();
  });

  it('hands a UserContext for the sender and persists changes after the handler', async () => {
    const client = makeClient(store);
    client.onTextMessage(async (update, context) => {
      expect(context.userId).toBe(update.userPhoneNumber);
      context.set('last', update.messageText);
    });

    await client.processUpdate(textPayload('111', 'one'));
    expect((await store.get('111'))?.data).toEqual({ last: 'one' });
  });

  it('carries state across turns (multi-step survey)', async () => {
    const client = makeClient(store);
    const replies: string[] = [];

    client.onTextMessage(async (update, context) => {
      const step = context.get('step', 0);
      switch (step) {
        case 0:
          context.set('step', 1);
          replies.push('name?');
          break;
        case 1:
          context.set('name', update.messageText).set('step', 2);
          replies.push('age?');
          break;
        case 2:
          replies.push(`${context.get('name')} is ${update.messageText}`);
          context.clear();
          break;
      }
    });

    await client.processUpdate(textPayload('111', 'hi'));
    await client.processUpdate(textPayload('111', 'Ada'));
    expect((await store.get('111'))?.data).toEqual({ step: 2, name: 'Ada' });
    await client.processUpdate(textPayload('111', '36'));

    expect(replies).toEqual(['name?', 'age?', 'Ada is 36']);
    // clear() at the end removed the record entirely
    expect(store.size).toBe(0);
  });

  it('keeps users isolated', async () => {
    const client = makeClient(store);
    client.onTextMessage(async (update, context) => {
      context.set('count', context.get('count', 0) + 1);
    });
    await client.processUpdate(textPayload('111', 'a'));
    await client.processUpdate(textPayload('111', 'b'));
    await client.processUpdate(textPayload('222', 'c'));
    expect((await store.get('111'))?.data).toEqual({ count: 2 });
    expect((await store.get('222'))?.data).toEqual({ count: 1 });
  });

  it('survives a "restart" (new client, same external store)', async () => {
    const first = makeClient(store);
    first.onTextMessage(async (_u, context) => context.set('step', 5));
    await first.processUpdate(textPayload('111', 'x'));

    const second = makeClient(store);
    let seen: number | undefined;
    second.onTextMessage(async (_u, context) => {
      seen = context.get('step');
    });
    await second.processUpdate(textPayload('111', 'y'));
    expect(seen).toBe(5);
  });

  it('discards unsaved changes when the handler throws', async () => {
    const client = makeClient(store);
    await store.set('111', { step: 1 }, 0);
    client.onTextMessage(async (_u, context) => {
      context.set('step', 2);
      throw new Error('boom');
    });
    await expect(client.processUpdate(textPayload('111', 'x'))).rejects.toThrow(
      'boom'
    );
    expect((await store.get('111'))?.data).toEqual({ step: 1 });
  });

  it('honours an explicit context.save() before a failure', async () => {
    const client = makeClient(store);
    client.onTextMessage(async (_u, context) => {
      context.set('committed', true);
      await context.save();
      context.set('uncommitted', true);
      throw new Error('boom');
    });
    await expect(client.processUpdate(textPayload('111', 'x'))).rejects.toThrow(
      'boom'
    );
    expect((await store.get('111'))?.data).toEqual({ committed: true });
  });

  it('loads the record once per message when a store is configured (routing needs it) and never writes for read-only stateless handlers', async () => {
    const client = makeClient(store);
    const getSpy = jest.spyOn(store, 'get');
    const setSpy = jest.spyOn(store, 'set');
    client.onTextMessage(async () => {});
    await client.processUpdate(textPayload('111', 'x'));
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('does not touch the store at all for clients without one', async () => {
    const client = makeClient();
    client.onTextMessage(async () => {});
    await expect(
      client.processUpdate(textPayload('111', 'x'))
    ).resolves.toBeUndefined();
  });

  it('exposes update.context to stateless handlers when a store is configured', async () => {
    const client = makeClient(store);
    client.onTextMessage(async (update) => {
      expect(update.hasContext).toBe(true);
      update.context.set('viaUpdate', true);
    });
    await client.processUpdate(textPayload('111', 'x'));
    expect((await store.get('111'))?.data).toEqual({ viaUpdate: true });
  });

  it('hands the same context instance via the parameter and update.context', async () => {
    const client = makeClient(store);
    client.onTextMessage(async (update, context) => {
      expect(update.context).toBe(context);
    });
    await client.processUpdate(textPayload('111', 'x'));
  });

  it('loads context once and saves once per handled message', async () => {
    const client = makeClient(store);
    const getSpy = jest.spyOn(store, 'get');
    const setSpy = jest.spyOn(store, 'set');
    client.onTextMessage(async (_u, context) => context.set('a', 1));
    await client.processUpdate(textPayload('111', 'x'));
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('refreshes TTL (touch) after a read-only turn on an existing record', async () => {
    const client = makeClient(store);
    await store.set('111', { a: 1 }, 0);
    const touchSpy = jest.spyOn(store, 'touch');
    client.onTextMessage(async (_u, context) => {
      context.get('a');
    });
    await client.processUpdate(textPayload('111', 'x'));
    expect(touchSpy).toHaveBeenCalledWith('111');
  });

  it('exposes getContext / clearContext for use outside handlers', async () => {
    const client = makeClient(store);
    expect(client.contextStore).toBe(store);

    const ctx = await client.getContext('111');
    ctx.set('fromAdmin', true);
    await ctx.save();
    expect((await store.get('111'))?.data).toEqual({ fromAdmin: true });

    await client.clearContext('111');
    expect(await store.get('111')).toBeUndefined();
  });

  it('propagates store failures to processUpdate', async () => {
    const client = makeClient(store);
    jest.spyOn(store, 'get').mockRejectedValueOnce(new Error('redis down'));
    client.onTextMessage(async (_u, _c) => {});
    await expect(client.processUpdate(textPayload('111', 'x'))).rejects.toThrow(
      'redis down'
    );
  });
});

// -----------------------------------------------------------------------------
// Cross-server concurrency (optimistic locking + retry)
// -----------------------------------------------------------------------------

describe('optimistic locking across servers', () => {
  let store: MemoryContextStore;

  beforeEach(() => {
    store = new MemoryContextStore();
  });

  it('re-runs a handler whose save conflicted, with fresh state, instead of losing the update', async () => {
    // Two "servers" share the external store. Server A loads the context, then
    // stalls; server B processes another message for the same user and
    // commits; A's save must conflict and A must re-run against B's state.
    const serverA = makeClient(store);
    const serverB = makeClient(store);
    const gate = makeGate();
    const runsA: Array<{ attempt: number; sawCount: number }> = [];
    let attemptsA = 0;

    serverA.onTextMessage(async (_u, context) => {
      attemptsA++;
      runsA.push({ attempt: attemptsA, sawCount: context.get('count', 0) });
      if (attemptsA === 1) {
        await gate.wait(); // hold the first attempt until B has committed
      }
      context.set('count', context.get('count', 0) + 1);
    });
    serverB.onTextMessage(async (_u, context) => {
      context.set('count', context.get('count', 0) + 1);
    });

    const a = serverA.processUpdate(textPayload('111', 'a'));
    await new Promise((r) => setImmediate(r)); // let A load its context
    await serverB.processUpdate(textPayload('111', 'b'));
    gate.open();
    await a;

    expect(runsA).toEqual([
      { attempt: 1, sawCount: 0 },
      { attempt: 2, sawCount: 1 }, // re-run saw B's write
    ]);
    expect(await store.get('111')).toEqual({ data: { count: 2 }, version: 2 });
  });

  it('a conflict thrown by an explicit context.save() inside the handler also triggers a re-run', async () => {
    const serverA = makeClient(store);
    const gate = makeGate();
    let attempts = 0;

    serverA.onTextMessage(async (_u, context) => {
      attempts++;
      context.set('attempt', attempts);
      if (attempts === 1) {
        await gate.wait();
      }
      await context.save(); // explicit commit
      context.set('after', true);
    });

    const a = serverA.processUpdate(textPayload('111', 'a'));
    await new Promise((r) => setImmediate(r));
    await store.set('111', { other: 'server' }, 0); // someone else created it
    gate.open();
    await a;

    expect(attempts).toBe(2);
    expect((await store.get('111'))?.data).toEqual({
      other: 'server',
      attempt: 2,
      after: true,
    });
  });

  it('gives up after contextConflictRetries and propagates ContextConflictError', async () => {
    const client = makeClient(store, 2);
    let attempts = 0;
    client.onTextMessage(async (_u, context) => {
      attempts++;
      // Sabotage: bump the stored version behind our back on every attempt
      const rec = await store.get('111');
      await store.set('111', { v: attempts }, rec?.version ?? 0);
      context.set('mine', attempts);
    });

    await expect(client.processUpdate(textPayload('111', 'x'))).rejects.toThrow(
      ContextConflictError
    );
    expect(attempts).toBe(3); // 1 initial + 2 retries
    expect((await store.get('111'))?.data).toEqual({ v: 3 }); // never overwritten
  });

  it('contextConflictRetries: 0 disables re-runs', async () => {
    const client = makeClient(store, 0);
    let attempts = 0;
    client.onTextMessage(async (_u, context) => {
      attempts++;
      await store.set('111', { other: true }, 0);
      context.set('mine', true);
    });
    await expect(client.processUpdate(textPayload('111', 'x'))).rejects.toThrow(
      ContextConflictError
    );
    expect(attempts).toBe(1);
  });

  it('defaults to 3 retries', async () => {
    const client = makeClient(store);
    let attempts = 0;
    client.onTextMessage(async (_u, context) => {
      attempts++;
      const rec = await store.get('111');
      await store.set('111', { v: attempts }, rec?.version ?? 0);
      context.set('mine', attempts);
    });
    await expect(client.processUpdate(textPayload('111', 'x'))).rejects.toThrow(
      ContextConflictError
    );
    expect(attempts).toBe(4);
  });

  it('non-conflict errors are not retried', async () => {
    const client = makeClient(store);
    let attempts = 0;
    client.onTextMessage(async (_u, _c) => {
      attempts++;
      throw new Error('boom');
    });
    await expect(client.processUpdate(textPayload('111', 'x'))).rejects.toThrow(
      'boom'
    );
    expect(attempts).toBe(1);
  });

  it('many servers incrementing the same user concurrently never lose an update', async () => {
    const servers = Array.from({ length: 8 }, () => makeClient(store, 50));
    for (const server of servers) {
      server.onTextMessage(async (_u, context) => {
        context.set('count', context.get('count', 0) + 1);
        // yield so other "servers" interleave between load and save
        await new Promise((r) => setImmediate(r));
      });
    }
    const messages = 40;
    await Promise.all(
      Array.from({ length: messages }, (_, i) =>
        servers[i % servers.length].processUpdate(textPayload('111', `m${i}`))
      )
    );
    expect((await store.get('111'))?.data).toEqual({ count: messages });
  });
});
