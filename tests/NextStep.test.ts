import { jest } from '@jest/globals';
import { WhatsApp } from '../src/WhatsApp.js';
import { UnknownStepError } from '../src/Dispatcher.js';
import { TextHandler, ImageHandler } from '../src/Handlers.js';
import { MemoryContextStore } from '../src/context/MemoryContextStore.js';
import {
  ContextConflictError,
  ContextStoreError,
  ContextStoreRequiredError,
} from '../src/context/ContextStore.js';
import { UserContext, NEXT_STEP_KEY } from '../src/context/UserContext.js';
import type { WebhookPayload } from '../src/types/index.js';

const PHONE_NUMBER_ID = '106540352242922';
const nowSeconds = () => String(Math.floor(Date.now() / 1000));

function payload(
  from: string,
  message: Record<string, unknown>
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
              messages: [
                {
                  from,
                  id: `wamid.${from}.${Math.random()}`,
                  timestamp: nowSeconds(),
                  ...message,
                } as WebhookPayload['entry'][0]['changes'][0]['value']['messages'] extends
                  Array<infer M> | undefined
                  ? M
                  : never,
              ],
            },
          },
        ],
      },
    ],
  };
}

const text = (from: string, body: string) =>
  payload(from, { type: 'text', text: { body } });
const image = (from: string) =>
  payload(from, {
    type: 'image',
    image: { id: 'img', mime_type: 'image/png', sha256: 'x' },
  });

function makeClient(store?: MemoryContextStore, retries?: number): WhatsApp {
  return new WhatsApp({
    numberId: PHONE_NUMBER_ID,
    token: 'test-token',
    markAsRead: false,
    contextStore: store,
    contextConflictRetries: retries,
    // These suites assert exact record contents; redelivery dedupe (which
    // adds handled message ids to the record) is covered in Dedupe.test.ts.
    dedupeMessages: false,
  });
}

/**
 * A bot "instance": registration wizard driven by next steps. Built from a
 * factory so several instances (or a restarted one) share only the store.
 */
function makeWizard(store: MemoryContextStore, replies: string[]) {
  const client = makeClient(store);

  client.registerStep(
    'ask_name',
    new TextHandler(async (update, context) => {
      context.set('name', update.messageText);
      replies.push('email?');
      await client.setNextStep(update, 'ask_email', { fallback: 'cancel' });
    })
  );
  client.registerStep(
    'ask_email',
    new TextHandler(async (update, context) => {
      context.set('email', update.messageText);
      replies.push(`done ${context.get('name')} ${context.get('email')}`);
      context.clear();
    })
  );
  client.registerStep(
    'cancel',
    new TextHandler(async (_update, context) => {
      context.clear();
      replies.push('cancelled');
    })
  );

  client.onTextMessage(
    async (update) => {
      replies.push('name?');
      await client.setNextStep(update, 'ask_name', { fallback: 'cancel' });
    },
    { regex: /^register$/i }
  );
  client.onTextMessage(async (update) => {
    replies.push(`echo ${update.messageText}`);
  });

  return client;
}

describe('next step — registration', () => {
  it('hard-fails without a context store', () => {
    const client = makeClient();
    expect(() =>
      client.registerStep('s', new TextHandler(async () => {}))
    ).toThrow(ContextStoreRequiredError);
    expect(
      () =>
        new WhatsApp({
          numberId: PHONE_NUMBER_ID,
          token: 't',
          steps: { s: new TextHandler(async () => {}) },
        })
    ).toThrow(ContextStoreRequiredError);
  });

  it('accepts steps via the config option and registerStep', () => {
    const store = new MemoryContextStore();
    const a = new TextHandler(async () => {});
    const client = new WhatsApp({
      numberId: PHONE_NUMBER_ID,
      token: 't',
      contextStore: store,
      steps: { a },
    });
    client.registerStep('b', new TextHandler(async () => {}));
    client.registerStep('a', a); // same instance again is fine
    expect(() =>
      client.registerStep('a', new TextHandler(async () => {}))
    ).toThrow(ContextStoreError);
    expect(() => client.registerStep('', a)).toThrow(ContextStoreError);
    expect(() => client.registerStep('c', (async () => {}) as never)).toThrow(
      ContextStoreError
    );
  });

  it('setNextStep rejects unknown step and fallback names up-front', async () => {
    const store = new MemoryContextStore();
    const client = makeClient(store);
    client.registerStep('known', new TextHandler(async () => {}));
    await expect(client.setNextStep('111', 'typo')).rejects.toThrow(
      UnknownStepError
    );
    await expect(
      client.setNextStep('111', 'known', { fallback: 'typo' })
    ).rejects.toThrow(UnknownStepError);
    expect(await store.get('111')).toBeUndefined(); // nothing written
  });

  it('rejects the old closure-based API with guidance', async () => {
    const store = new MemoryContextStore();
    const client = makeClient(store);
    const unregistered = new TextHandler(async () => {});
    await expect(client.setNextStep('111', unregistered)).rejects.toThrow(
      /register the handler at startup/
    );
    const registered = new TextHandler(async () => {});
    client.registerStep('ok', registered);
    await expect(
      client.setNextStep('111', registered, (async () => {}) as never)
    ).rejects.toThrow(/no longer accepts a fallback function/);
  });

  it('accepts a registered handler instance in place of its name', async () => {
    const store = new MemoryContextStore();
    const client = makeClient(store);
    const handler = new TextHandler(async () => {});
    client.registerStep('by_instance', handler);
    await client.setNextStep('111', handler);
    expect((await client.getNextStep('111'))?.step).toBe('by_instance');
  });
});

describe('next step — persistence', () => {
  let store: MemoryContextStore;
  let replies: string[];

  beforeEach(() => {
    store = new MemoryContextStore();
    replies = [];
  });

  it('is stored in the context record under the reserved key, with the fallback regex serialised', async () => {
    const client = makeWizard(store, replies);
    await client.processUpdate(text('111', 'register'));

    const record = await store.get('111');
    expect(record?.data).toEqual({
      [NEXT_STEP_KEY]: {
        step: 'ask_name',
        fallback: 'cancel',
        fallbackRegex: { source: '^(end|stop|cancel)$', flags: 'i' },
      },
    });
    expect(await client.getNextStep('111')).toEqual({
      step: 'ask_name',
      fallback: 'cancel',
      fallbackRegex: /^(end|stop|cancel)$/i,
    });
  });

  it('drives a multi-turn flow on a single instance', async () => {
    const client = makeWizard(store, replies);
    await client.processUpdate(text('111', 'register'));
    await client.processUpdate(text('111', 'Ada'));
    await client.processUpdate(text('111', 'ada@example.com'));
    await client.processUpdate(text('111', 'hello'));

    expect(replies).toEqual([
      'name?',
      'email?',
      'done Ada ada@example.com',
      'echo hello',
    ]);
    // Flow finished: data cleared and step consumed -> record gone
    expect(await store.get('111')).toBeUndefined();
  });

  it('survives a restart (new instance, same store) mid-flow', async () => {
    const before = makeWizard(store, replies);
    await before.processUpdate(text('111', 'register'));
    await before.processUpdate(text('111', 'Ada'));

    // "restart": brand-new process with empty memory, only the store remains
    const after = makeWizard(store, replies);
    await after.processUpdate(text('111', 'ada@example.com'));

    expect(replies).toEqual(['name?', 'email?', 'done Ada ada@example.com']);
  });

  it('is honoured by whichever instance receives the next message', async () => {
    const instanceA = makeWizard(store, replies);
    const instanceB = makeWizard(store, replies);
    const instanceC = makeWizard(store, replies);

    await instanceA.processUpdate(text('111', 'register'));
    await instanceB.processUpdate(text('111', 'Ada'));
    await instanceC.processUpdate(text('111', 'ada@example.com'));

    expect(replies).toEqual(['name?', 'email?', 'done Ada ada@example.com']);
  });

  it('keeps per-user steps independent', async () => {
    const client = makeWizard(store, replies);
    await client.processUpdate(text('111', 'register'));
    await client.processUpdate(text('222', 'hello'));
    await client.processUpdate(text('111', 'Ada'));
    expect(replies).toEqual(['name?', 'echo hello', 'email?']);
    expect((await client.getNextStep('111'))?.step).toBe('ask_email');
    expect(await client.getNextStep('222')).toBeUndefined();
  });

  it('the fallback runs instead of the step when its regex matches, consuming the step', async () => {
    const client = makeWizard(store, replies);
    await client.processUpdate(text('111', 'register'));
    await client.processUpdate(text('111', 'cancel'));
    await client.processUpdate(text('111', 'Ada'));
    expect(replies).toEqual(['name?', 'cancelled', 'echo Ada']);
    expect(await store.get('111')).toBeUndefined();
  });

  it('honours a custom fallbackRegex (string or RegExp) and no fallback at all', async () => {
    const client = makeClient(store);
    const seen: string[] = [];
    client.registerStep(
      'step',
      new TextHandler(async (u) => void seen.push(`step:${u.messageText}`))
    );
    client.registerStep(
      'bail',
      new TextHandler(async (u) => void seen.push(`bail:${u.messageText}`))
    );

    await client.setNextStep('111', 'step', {
      fallback: 'bail',
      fallbackRegex: '^quit$',
    });
    await client.processUpdate(text('111', 'cancel')); // default regex must NOT apply
    await client.setNextStep('111', 'step', {
      fallback: 'bail',
      fallbackRegex: /^quit$/,
    });
    await client.processUpdate(text('111', 'quit'));
    await client.setNextStep('111', 'step');
    await client.processUpdate(text('111', 'cancel')); // no fallback -> step gets it

    expect(seen).toEqual(['step:cancel', 'bail:quit', 'step:cancel']);
  });

  it('a pending step takes precedence over regular handlers, but persistent handlers still run first', async () => {
    const client = makeClient(store);
    const seen: string[] = [];
    client.registerStep(
      'step',
      new TextHandler(async () => void seen.push('step'))
    );
    client.onTextMessage(async () => void seen.push('persistent'), {
      persistent: true,
      regex: /^help$/,
    });
    client.onTextMessage(async () => void seen.push('regular'));

    await client.setNextStep('111', 'step');
    await client.processUpdate(text('111', 'help')); // persistent wins, step stays pending
    expect((await client.getNextStep('111'))?.step).toBe('step');
    await client.processUpdate(text('111', 'anything')); // step consumes
    await client.processUpdate(text('111', 'anything')); // back to normal routing
    expect(seen).toEqual(['persistent', 'step', 'regular']);
  });

  it('does not fire a step for a message of another type (and keeps it pending)', async () => {
    const client = makeClient(store);
    const seen: string[] = [];
    client.registerStep(
      'want_text',
      new TextHandler(async () => void seen.push('text-step'))
    );
    client.onImageMessage(async () => void seen.push('image-handler'));

    await client.setNextStep('111', 'want_text');
    await client.processUpdate(image('111'));
    expect(seen).toEqual([]); // pending step suppresses regular handlers
    expect((await client.getNextStep('111'))?.step).toBe('want_text');
    await client.processUpdate(text('111', 'now'));
    expect(seen).toEqual(['text-step']);
  });

  it('supports steps of any handler type', async () => {
    const client = makeClient(store);
    const seen: string[] = [];
    client.registerStep(
      'want_image',
      new ImageHandler(async (u) => void seen.push(u.mediaFileId!))
    );
    await client.setNextStep('111', 'want_image');
    await client.processUpdate(image('111'));
    expect(seen).toEqual(['img']);
  });

  it('keeps the step pending (and discards context changes) when the step handler throws', async () => {
    const client = makeClient(store);
    client.registerStep(
      'boom',
      new TextHandler(async (_u, context) => {
        context.set('partial', true);
        throw new Error('boom');
      })
    );
    await client.setNextStep('111', 'boom');
    await expect(client.processUpdate(text('111', 'x'))).rejects.toThrow(
      'boom'
    );
    expect((await client.getNextStep('111'))?.step).toBe('boom');
    expect((await store.get('111'))?.data).toEqual({
      [NEXT_STEP_KEY]: { step: 'boom' },
    });
  });

  it('lets a step handler chain to the next step', async () => {
    const client = makeClient(store);
    const seen: string[] = [];
    client.registerStep(
      'one',
      new TextHandler(async (update) => {
        seen.push('one');
        await client.setNextStep(update, 'two');
      })
    );
    client.registerStep(
      'two',
      new TextHandler(async () => void seen.push('two'))
    );
    await client.setNextStep('111', 'one');
    await client.processUpdate(text('111', 'a'));
    await client.processUpdate(text('111', 'b'));
    await client.processUpdate(text('111', 'c'));
    expect(seen).toEqual(['one', 'two']);
  });

  it('can be set from the context object directly (validated against the registry)', async () => {
    const client = makeClient(store);
    const seen: string[] = [];
    client.registerStep(
      'next',
      new TextHandler(async () => void seen.push('next'))
    );
    let error: unknown;
    client.onTextMessage(async (_u, context) => {
      try {
        context.setNextStep('typo');
      } catch (e) {
        error = e;
      }
      context.setNextStep('next');
    });
    await client.processUpdate(text('111', 'go'));
    expect(error).toBeInstanceOf(UnknownStepError);
    await client.processUpdate(text('111', 'again'));
    expect(seen).toEqual(['next']);
  });

  it('clearNextStep works inside a handler (joins the save) and outside (immediate write)', async () => {
    const client = makeClient(store);
    const seen: string[] = [];
    client.registerStep(
      'step',
      new TextHandler(async () => void seen.push('step'))
    );
    client.onTextMessage(
      async (update) => {
        await client.clearNextStep(update.userPhoneNumber); // by phone, in flight
      },
      { persistent: true, regex: /^reset$/ }
    );
    client.onTextMessage(async () => void seen.push('regular'));

    await client.setNextStep('111', 'step');
    await client.processUpdate(text('111', 'reset'));
    expect(await client.getNextStep('111')).toBeUndefined();
    await client.processUpdate(text('111', 'x'));
    expect(seen).toEqual(['regular']);

    await client.setNextStep('111', 'step');
    await client.clearNextStep('111'); // outside
    expect(await store.get('111')).toBeUndefined();
  });

  it('drops a stale step whose handler is no longer registered and routes normally', async () => {
    const seen: string[] = [];
    const oldDeploy = makeClient(store);
    oldDeploy.registerStep('legacy', new TextHandler(async () => {}));
    await oldDeploy.setNextStep('111', 'legacy');

    const newDeploy = makeClient(store);
    newDeploy.onTextMessage(
      async (u) => void seen.push(`regular:${u.messageText}`)
    );
    await newDeploy.processUpdate(text('111', 'hi'));
    expect(seen).toEqual(['regular:hi']);
    expect(await store.get('111')).toBeUndefined(); // stale entry cleaned up
  });

  it('setNextStep from outside a handler uses optimistic locking and retries', async () => {
    const client = makeClient(store, 5);
    client.registerStep('s', new TextHandler(async () => {}));
    await store.set('111', { a: 1 }, 0);
    const original = store.set.bind(store);
    let sabotaged = false;
    jest.spyOn(store, 'set').mockImplementation(async (id, data, expected) => {
      if (!sabotaged) {
        sabotaged = true;
        await original(id, { a: 2 }, expected); // someone else writes first
      }
      return original(id, data, expected);
    });
    await client.setNextStep('111', 's');
    const rec = await store.get('111');
    expect(rec?.data).toEqual({ a: 2, [NEXT_STEP_KEY]: { step: 's' } });
    expect(rec?.version).toBe(3);
  });
});

describe('next step — atomicity with context under concurrency', () => {
  it('step transition and data commit together; a conflicting run is re-resolved against fresh state', async () => {
    const store = new MemoryContextStore();
    const serverA = makeClient(store);
    const serverB = makeClient(store);
    const seen: string[] = [];
    let gateOpen!: () => void;
    const gate = new Promise<void>((r) => (gateOpen = r));
    let attemptsA = 0;

    for (const [name, server] of [
      ['A', serverA],
      ['B', serverB],
    ] as const) {
      server.registerStep(
        'confirm',
        new TextHandler(async (u, context) => {
          seen.push(`${name}:confirm:${u.messageText}:${context.get('order')}`);
        })
      );
      server.onTextMessage(
        async (update, context) => {
          if (name === 'A') {
            attemptsA++;
            if (attemptsA === 1) await gate; // stall first attempt
          }
          context.set('order', update.messageText);
          await server.setNextStep(update, 'confirm');
          seen.push(`${name}:order:${update.messageText}`);
        },
        { regex: /^order/ }
      );
    }

    // A starts processing "order 1" and stalls after loading the context.
    const a = serverA.processUpdate(text('111', 'order 1'));
    await new Promise((r) => setImmediate(r));
    // B processes "order 2" fully: sets order=2 and the confirm step.
    await serverB.processUpdate(text('111', 'order 2'));
    // B then receives "yes", which consumes the confirm step.
    await serverB.processUpdate(text('111', 'yes'));
    gateOpen();
    await a; // A's first save conflicts -> re-run sets order=1 + step again

    // Note the repeated 'A:order:order 1': a side effect performed before a
    // conflicting save is re-executed on the retry (documented caveat).
    expect(seen).toEqual([
      'B:order:order 2',
      'B:confirm:yes:order 2',
      'A:order:order 1',
      'A:order:order 1',
    ]);
    expect(attemptsA).toBe(2);
    expect(await store.get('111')).toEqual({
      data: { order: 'order 1', [NEXT_STEP_KEY]: { step: 'confirm' } },
      version: 3,
    });
  });

  it('a step consumed on another instance is not consumed twice', async () => {
    const store = new MemoryContextStore();
    const serverA = makeClient(store);
    const serverB = makeClient(store);
    const seen: string[] = [];
    let gateOpen!: () => void;
    const gate = new Promise<void>((r) => (gateOpen = r));
    let first = true;

    for (const [name, server] of [
      ['A', serverA],
      ['B', serverB],
    ] as const) {
      server.registerStep(
        'step',
        new TextHandler(async (u) => {
          if (name === 'A' && first) {
            first = false;
            await gate;
          }
          seen.push(`${name}:step:${u.messageText}`);
        })
      );
      server.onTextMessage(
        async (u) => void seen.push(`${name}:regular:${u.messageText}`)
      );
    }

    await serverA.setNextStep('111', 'step');
    const a = serverA.processUpdate(text('111', 'm1')); // loads record with step, stalls
    await new Promise((r) => setImmediate(r));
    await serverB.processUpdate(text('111', 'm2')); // consumes the step, commits
    gateOpen();
    await a; // A's save conflicts (record gone); re-run sees no step -> regular handler

    // A's first (stalled) step run had already produced its side effect
    // before the conflict was detected; the retry routes to the regular handler.
    expect(seen).toEqual(['B:step:m2', 'A:step:m1', 'A:regular:m1']);
    expect(await store.get('111')).toBeUndefined();
  });

  it('a context-less persistent setNextStep caller cannot lose a concurrent data write', async () => {
    const store = new MemoryContextStore();
    const client = makeClient(store, 3);
    client.registerStep('s', new TextHandler(async () => {}));
    let gateOpen!: () => void;
    const gate = new Promise<void>((r) => (gateOpen = r));
    let attempts = 0;
    client.onTextMessage(async (update) => {
      attempts++;
      if (attempts === 1) await gate;
      await client.setNextStep(update, 's'); // stateless handler, in-flight join
    });

    const run = client.processUpdate(text('111', 'x'));
    await new Promise((r) => setImmediate(r));
    const other = await UserContext.load(store, '111');
    other.set('written', 'elsewhere');
    await other.save();
    gateOpen();
    await run;

    expect(attempts).toBe(2);
    expect((await store.get('111'))?.data).toEqual({
      written: 'elsewhere',
      [NEXT_STEP_KEY]: { step: 's' },
    });
  });
});

describe('UserContext next-step API', () => {
  it('hides the reserved key from the data accessors and guards it', async () => {
    const store = new MemoryContextStore();
    const ctx = await UserContext.load(store, '1');
    ctx.set('a', 1).setNextStep('s');
    expect(ctx.keys()).toEqual(['a']);
    expect(ctx.all()).toEqual({ a: 1 });
    expect(ctx.size).toBe(1);
    expect(ctx.userData).toEqual({ a: 1 });
    expect(JSON.parse(JSON.stringify(ctx))).toEqual({ a: 1 });
    expect(() => ctx.get(NEXT_STEP_KEY)).toThrow(ContextStoreError);
    expect(() => ctx.set(NEXT_STEP_KEY, 1)).toThrow(ContextStoreError);
    expect(() => ctx.has(NEXT_STEP_KEY)).toThrow(ContextStoreError);
    expect(ctx.nextStep).toEqual({
      step: 's',
      fallback: undefined,
      fallbackRegex: undefined,
    });
  });

  it('a pending step keeps the record alive when data is cleared, and is counted as dirty', async () => {
    const store = new MemoryContextStore();
    const ctx = await UserContext.load(store, '1');
    ctx.setNextStep('s');
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.isDirty).toBe(true);
    await ctx.save();
    expect((await store.get('1'))?.data).toEqual({
      [NEXT_STEP_KEY]: { step: 's' },
    });

    ctx.clear(); // data only
    await ctx.save();
    expect(ctx.nextStep?.step).toBe('s');
    expect(ctx.clearNextStep()).toBe(true);
    expect(ctx.clearNextStep()).toBe(false);
    await ctx.save();
    expect(await store.get('1')).toBeUndefined();
  });

  it('validates step names and rejects empty ones', async () => {
    const store = new MemoryContextStore();
    const ctx = await UserContext.load(store, '1');
    expect(() => ctx.setNextStep('')).toThrow(ContextStoreError);
    const hooked = new UserContext(store, '1', undefined, {
      validateStep: (n) => {
        if (n !== 'ok') throw new Error(`bad ${n}`);
      },
    });
    expect(() => hooked.setNextStep('nope')).toThrow('bad nope');
    expect(() => hooked.setNextStep('ok', { fallback: 'nope' })).toThrow(
      'bad nope'
    );
    hooked.setNextStep('ok', { fallback: 'ok', fallbackRegex: 'x' });
    expect(hooked.nextStep?.fallbackRegex).toEqual(/x/);
  });

  it('ignores malformed reserved entries from storage', async () => {
    const store = new MemoryContextStore();
    await store.set('1', { a: 1, [NEXT_STEP_KEY]: 'garbage' }, 0);
    const ctx = await UserContext.load(store, '1');
    expect(ctx.nextStep).toBeUndefined();
    expect(ctx.all()).toEqual({ a: 1 });
  });

  it('destroy() wipes the step too; reload() restores it', async () => {
    const store = new MemoryContextStore();
    const ctx = await UserContext.load(store, '1');
    ctx.setNextStep('s');
    await ctx.save();
    ctx.clearNextStep();
    await ctx.reload();
    expect(ctx.nextStep?.step).toBe('s');
    await ctx.destroy();
    expect(ctx.nextStep).toBeUndefined();
    expect(await store.get('1')).toBeUndefined();
  });

  it('conflicts on the step transition are detected like any other write', async () => {
    const store = new MemoryContextStore();
    const a = await UserContext.load(store, '1');
    const b = await UserContext.load(store, '1');
    a.setNextStep('x');
    await a.save();
    b.setNextStep('y');
    await expect(b.save()).rejects.toThrow(ContextConflictError);
  });
});
