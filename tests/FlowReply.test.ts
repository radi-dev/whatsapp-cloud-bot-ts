import { jest } from '@jest/globals';
import { WhatsApp } from '../src/WhatsApp.js';
import type { Update } from '../src/Update.js';
import type {
  WebhookPayload,
  InteractiveReplyType,
} from '../src/types/index.js';

const PHONE_NUMBER_ID = '106540352242922';

function interactivePayload(
  type: InteractiveReplyType,
  extra: Record<string, unknown>
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
                display_phone_number: '1',
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [{ profile: { name: 'X' }, wa_id: '16505551234' }],
              messages: [
                {
                  from: '16505551234',
                  id: 'wamid.1',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'interactive',
                  interactive: { type, ...extra },
                } as never,
              ],
            },
          },
        ],
      },
    ],
  };
}

const flowPayload = () =>
  interactivePayload('nfm_reply', {
    nfm_reply: {
      name: 'flow',
      body: 'Sent',
      response_json: JSON.stringify({ flow_token: 'tok_42', email: 'a@b.com' }),
    },
  });

const buttonPayload = () =>
  interactivePayload('button_reply', {
    button_reply: { id: 'yes', title: 'Yes' },
  });

const listPayload = () =>
  interactivePayload('list_reply', {
    list_reply: { id: 'opt_1', title: 'Option 1' },
  });

function makeClient(): WhatsApp {
  return new WhatsApp({
    numberId: PHONE_NUMBER_ID,
    token: 't',
    markAsRead: false,
  });
}

describe('Flow reply (nfm_reply) handling', () => {
  it('onFlowReply receives the parsed flow response', async () => {
    const client = makeClient();
    let received: Update | undefined;
    client.onFlowReply((update) => {
      received = update;
    });

    await client.processUpdate(flowPayload());

    expect(received).toBeDefined();
    expect(received!.flowReply).toBeDefined();
    expect(received!.flowReply!.name).toBe('flow');
    expect(received!.flowReply!.body).toBe('Sent');
    expect(received!.flowReply!.flowToken).toBe('tok_42');
    expect(received!.flowReply!.data.email).toBe('a@b.com');
  });

  it('onFlowReply does NOT fire for button or list replies', async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onFlowReply(handler);

    await client.processUpdate(buttonPayload());
    await client.processUpdate(listPayload());

    expect(handler).not.toHaveBeenCalled();
  });

  it('onButtonReply and onListReply only fire for their sub-type', async () => {
    const client = makeClient();
    const onButton = jest.fn();
    const onList = jest.fn();
    client.onButtonReply(onButton);
    client.onListReply(onList);

    await client.processUpdate(buttonPayload());
    expect(onButton).toHaveBeenCalledTimes(1);
    expect(onList).not.toHaveBeenCalled();

    await client.processUpdate(listPayload());
    expect(onList).toHaveBeenCalledTimes(1);
    expect(onButton).toHaveBeenCalledTimes(1);
  });

  it('onButtonReply ignores a flow reply', async () => {
    const client = makeClient();
    const onButton = jest.fn();
    client.onButtonReply(onButton);

    await client.processUpdate(flowPayload());
    expect(onButton).not.toHaveBeenCalled();
  });

  it('onTextMessage handles plain text', async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onTextMessage(handler);

    await client.processUpdate({
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
                  display_phone_number: '1',
                  phone_number_id: PHONE_NUMBER_ID,
                },
                contacts: [{ profile: { name: 'X' }, wa_id: '16505551234' }],
                messages: [
                  {
                    from: '16505551234',
                    id: 'wamid.2',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'hello' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
