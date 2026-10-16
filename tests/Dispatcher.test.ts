import { WhatsApp } from '../src/WhatsApp.js';
import type { WebhookPayload } from '../src/types/index.js';

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
                  id: `wamid.${from}.${body}`,
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

function makeClient(): WhatsApp {
  return new WhatsApp({
    numberId: PHONE_NUMBER_ID,
    token: 'test-token',
    markAsRead: false,
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Dispatcher per-phone serialization', () => {
  it('processes updates from the same number serially', async () => {
    const client = makeClient();
    const events: string[] = [];

    client.onMessage(async (update) => {
      events.push(`start:${update.messageText}`);
      await delay(20);
      events.push(`end:${update.messageText}`);
    });

    const p1 = client.processUpdate(textPayload('111', 'A'));
    const p2 = client.processUpdate(textPayload('111', 'B'));
    await Promise.all([p1, p2]);

    expect(events).toEqual(['start:A', 'end:A', 'start:B', 'end:B']);
  });

  it('processes updates from different numbers concurrently', async () => {
    const client = makeClient();
    const events: string[] = [];

    client.onMessage(async (update) => {
      events.push(`start:${update.messageText}`);
      await delay(30);
      events.push(`end:${update.messageText}`);
    });

    const p1 = client.processUpdate(textPayload('111', 'X'));
    const p2 = client.processUpdate(textPayload('222', 'Y'));
    await Promise.all([p1, p2]);

    // Both start before either finishes -> they overlap (ran concurrently)
    expect(events).toEqual(['start:X', 'start:Y', 'end:X', 'end:Y']);
  });

  it('a throwing handler does not block later updates from the same number', async () => {
    const client = makeClient();
    const seen: string[] = [];

    client.onMessage(async (update) => {
      if (update.messageText === 'boom') {
        throw new Error('handler failed');
      }
      seen.push(update.messageText ?? '');
    });

    // First update rejects; its rejection must not wedge the chain
    await expect(
      client.processUpdate(textPayload('111', 'boom'))
    ).rejects.toThrow('handler failed');
    await client.processUpdate(textPayload('111', 'after'));

    expect(seen).toEqual(['after']);
  });

  it('prunes per-phone chain entries after processing drains (no leak)', async () => {
    const client = makeClient();
    client.onMessage(async () => {
      await delay(5);
    });

    const chains = (
      client as unknown as { dispatcher: { chains: Map<string, unknown> } }
    ).dispatcher.chains;

    await Promise.all([
      client.processUpdate(textPayload('111', 'a')),
      client.processUpdate(textPayload('111', 'b')), // same number, chained
      client.processUpdate(textPayload('222', 'c')),
      client.processUpdate(textPayload('333', 'd')),
    ]);

    // Every number went idle -> map fully cleaned up
    expect(chains.size).toBe(0);
    expect(client.getQueueStatus()).toEqual({ size: 0, isProcessing: false });
  });

  it('reports in-flight work via getQueueStatus', async () => {
    const client = makeClient();
    expect(client.getQueueStatus()).toEqual({ size: 0, isProcessing: false });

    client.onMessage(async () => {
      await delay(20);
    });

    const pending = client.processUpdate(textPayload('111', 'hi'));
    expect(client.getQueueStatus().isProcessing).toBe(true);
    await pending;
    expect(client.getQueueStatus()).toEqual({ size: 0, isProcessing: false });
  });
});
