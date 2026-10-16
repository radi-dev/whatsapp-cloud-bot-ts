import { jest } from '@jest/globals';
import { WhatsApp } from '../src/WhatsApp.js';
import { Update } from '../src/Update.js';
import { InlineFlow, buildFlowAction, ListItem } from '../src/Markup.js';
import type { WebhookValue } from '../src/types/index.js';
import axios from 'axios';

describe('Interactive & Flow messages', () => {
  let postSpy: jest.SpiedFunction<typeof axios.post>;
  let client: WhatsApp;

  beforeEach(() => {
    jest.clearAllMocks();
    postSpy = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: {} } as never);
    client = new WhatsApp({ numberId: '123', token: 'test-token' });
  });

  afterEach(() => postSpy.mockRestore());

  const lastPayload = (): any => {
    const calls = postSpy.mock.calls;
    return calls[calls.length - 1][1];
  };

  it('sendTextMessage builds a text-only payload', async () => {
    await client.sendTextMessage('1234567890', 'hi');
    const p = lastPayload();
    expect(p.type).toBe('text');
    expect(p.text.body).toBe('hi');
    expect(p.interactive).toBeUndefined();
  });

  it('sendButtonMessage builds an interactive button payload', async () => {
    await client.sendButtonMessage('1234567890', 'Pick', ['Yes', 'No']);
    const p = lastPayload();
    expect(p.type).toBe('interactive');
    expect(p.interactive.type).toBe('button');
    expect(p.interactive.action.buttons).toHaveLength(2);
  });

  it('sendListMessage builds an interactive list payload', async () => {
    await client.sendListMessage('1234567890', 'Pick', 'Menu', [
      new ListItem('A'),
      new ListItem('B'),
    ]);
    const p = lastPayload();
    expect(p.interactive.type).toBe('list');
    expect(p.interactive.action.button).toBe('Menu');
  });

  it('sendFlowMessage builds a flow payload with documented defaults', async () => {
    await client.sendFlowMessage('1234567890', 'Tap to start', {
      flow_id: '999',
      flow_cta: 'Sign up',
    });
    const p = lastPayload();
    expect(p.type).toBe('interactive');
    expect(p.interactive.type).toBe('flow');
    const params = p.interactive.action.parameters;
    expect(p.interactive.action.name).toBe('flow');
    expect(params.flow_message_version).toBe('3');
    expect(params.mode).toBe('published');
    expect(params.flow_token).toBe('unused');
    expect(params.flow_action).toBe('navigate');
    expect(params.flow_id).toBe('999');
    expect(params.flow_cta).toBe('Sign up');
    expect(params.flow_name).toBeUndefined();
  });

  it('serializes flow_action_payload.data and defaults the screen', async () => {
    await client.sendFlowMessage('1234567890', 'x', {
      flow_name: 'signup',
      flow_cta: 'Go',
      flow_action_payload: { data: { plan: 'pro' } },
    });
    const params = lastPayload().interactive.action.parameters;
    expect(params.flow_name).toBe('signup');
    expect(params.flow_action_payload.screen).toBe('FIRST_ENTRY_SCREEN');
    expect(params.flow_action_payload.data).toBe(
      JSON.stringify({ plan: 'pro' })
    );
  });

  it('omits flow_action_payload for data_exchange', async () => {
    await client.sendFlowMessage('1234567890', 'x', {
      flow_id: '1',
      flow_cta: 'Go',
      flow_action: 'data_exchange',
      flow_action_payload: { screen: 'X' },
    });
    expect(
      lastPayload().interactive.action.parameters.flow_action_payload
    ).toBeUndefined();
  });

  it('buildFlowAction enforces exactly one of flow_id / flow_name', () => {
    expect(() =>
      buildFlowAction({ flow_id: '1', flow_name: 'n', flow_cta: 'c' } as never)
    ).toThrow();
    expect(() => buildFlowAction({ flow_cta: 'c' } as never)).toThrow();
  });

  it('InlineFlow yields a flow reply markup', () => {
    const flow = new InlineFlow({ flow_id: '1', flow_cta: 'Go' });
    expect(flow.type).toBe('flow');
    expect((flow.markup as any).name).toBe('flow');
  });

  it('Update.replyWithFlow delegates to the client', async () => {
    const value = {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '1', phone_number_id: '123' },
      contacts: [{ profile: { name: 'X' }, wa_id: '1234567890' }],
      messages: [
        {
          from: '1234567890',
          id: 'wamid.1',
          timestamp: '1',
          type: 'text',
          text: { body: 'hi' },
        },
      ],
    } as WebhookValue;

    const update = new Update(client, value);
    const spy = jest.spyOn(client, 'sendFlowMessage');
    await update.replyWithFlow('Go', { flow_id: '1', flow_cta: 'Go' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
