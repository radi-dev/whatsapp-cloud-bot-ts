import { jest } from '@jest/globals';
import { WhatsApp } from '../src/WhatsApp.js';
import type { ButtonCarouselCard } from '../src/types/index.js';
import axios from 'axios';

describe('biz_opaque_callback_data threading', () => {
  let postSpy: jest.SpiedFunction<typeof axios.post>;
  let client: WhatsApp;

  beforeEach(() => {
    jest.clearAllMocks();
    postSpy = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: {} } as never);
    client = new WhatsApp({ numberId: '123', token: 'test-token' });
  });

  afterEach(() => {
    postSpy.mockRestore();
  });

  function lastPayload(): any {
    const calls = postSpy.mock.calls;
    return calls[calls.length - 1][1];
  }

  const cards: ButtonCarouselCard[] = [
    {
      header: { image: { link: 'https://example.com/1.jpg' } },
      action: { buttons: [{ quick_reply: { id: 'a', title: 'A' } }] },
    },
    {
      header: { image: { link: 'https://example.com/2.jpg' } },
      action: { buttons: [{ quick_reply: { id: 'b', title: 'B' } }] },
    },
  ];

  it('is attached to a text message', async () => {
    await client.sendMessage('1234567890', 'hi', {
      bizOpaqueCallbackData: 'track-text',
    });
    expect(lastPayload().biz_opaque_callback_data).toBe('track-text');
  });

  it('is attached to media (image)', async () => {
    await client.sendImage('1234567890', 'https://x/i.jpg', 'cap', 'track-img');
    expect(lastPayload().biz_opaque_callback_data).toBe('track-img');
  });

  it('is attached to a template message', async () => {
    await client.sendTemplateMessage(
      '1234567890',
      'tmpl',
      [],
      'en_US',
      'track-tmpl'
    );
    expect(lastPayload().biz_opaque_callback_data).toBe('track-tmpl');
  });

  it('is attached to a location message', async () => {
    await client.sendLocation('1234567890', 1, 2, 'n', 'a', 'track-loc');
    expect(lastPayload().biz_opaque_callback_data).toBe('track-loc');
  });

  it('is attached to a carousel message', async () => {
    await client.sendButtonCarousel(
      '1234567890',
      'pick',
      cards,
      'track-carousel'
    );
    expect(lastPayload().biz_opaque_callback_data).toBe('track-carousel');
  });

  it('is omitted when not provided', async () => {
    await client.sendMessage('1234567890', 'hi');
    expect(lastPayload().biz_opaque_callback_data).toBeUndefined();
  });
});
