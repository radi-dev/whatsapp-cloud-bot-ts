import { jest } from '@jest/globals';
import {
  sendCarouselButtonMessage,
  sendCarouselUrlMessage,
} from '../src/Message.js';
import type {
  CarouselCard,
  QuickReplyAction,
  CtaUrlAction,
} from '../src/types/index.js';
import axios from 'axios';

describe('Message API - Media Carousel Messages', () => {
  const url = 'https://graph.facebook.com/v16.0/12345/messages';
  const token = 'test-token';
  const phoneNumber = '1234567890';
  const text = 'Check out these items!';
  let postSpy: jest.SpiedFunction<typeof axios.post>;

  beforeEach(() => {
    jest.clearAllMocks();
    postSpy = jest.spyOn(axios, 'post');
  });

  afterEach(() => {
    postSpy.mockRestore();
  });

  it('should pass quick-reply cards through directly to the payload', async () => {
    postSpy.mockResolvedValueOnce({ data: { message_id: 'msg123' } } as any);

    const cards: CarouselCard<QuickReplyAction>[] = [
      {
        card_index: 0,
        type: 'cta_url',
        header: {
          type: 'image',
          image: { link: 'https://example.com/img1.jpg' },
        },
        body: { text: 'First item' },
        action: {
          buttons: [
            {
              type: 'quick_reply',
              quick_reply: { id: 'qr1', title: 'Buy Now' },
            },
          ],
        },
      },
      {
        card_index: 1,
        type: 'cta_url',
        header: {
          type: 'image',
          image: { link: 'https://example.com/img2.jpg' },
        },
        body: { text: 'Second item' },
        action: {
          buttons: [
            {
              type: 'quick_reply',
              quick_reply: { id: 'qr2', title: 'Shop' },
            },
          ],
        },
      },
    ];

    await sendCarouselButtonMessage(url, token, phoneNumber, text, cards);

    expect(postSpy).toHaveBeenCalledTimes(1);
    const payload = postSpy.mock.calls[0][1] as any;

    expect(payload.type).toBe('interactive');
    expect(payload.interactive.type).toBe('carousel');
    expect(payload.interactive.body.text).toBe(text);

    // Cards are passed through as-is — no re-mapping
    const sentCards = payload.interactive.action.cards;
    expect(sentCards).toBe(cards); // exact same reference
    expect(sentCards[0].action.buttons[0].quick_reply.id).toBe('qr1');
    expect(sentCards[1].action.buttons[0].quick_reply.title).toBe('Shop');
  });

  it('should pass cta_url cards through directly to the payload', async () => {
    postSpy.mockResolvedValueOnce({ data: {} } as any);

    const cards: CarouselCard<CtaUrlAction>[] = [
      {
        card_index: 0,
        type: 'cta_url',
        header: {
          type: 'image',
          image: { link: 'https://example.com/img1.jpg' },
        },
        body: { text: 'Visit our site' },
        action: {
          name: 'cta_url',
          parameters: { display_text: 'Visit', url: 'https://example.com' },
        },
      },
      {
        card_index: 1,
        type: 'cta_url',
        header: {
          type: 'image',
          image: { link: 'https://example.com/img2.jpg' },
        },
        body: { text: 'Shop now' },
        action: {
          name: 'cta_url',
          parameters: { display_text: 'Shop', url: 'https://shop.example.com' },
        },
      },
    ];

    await sendCarouselUrlMessage(url, token, phoneNumber, text, cards);

    const payload = postSpy.mock.calls[0][1] as any;
    const sentCards = payload.interactive.action.cards;

    expect(sentCards[0].action.name).toBe('cta_url');
    expect(sentCards[0].action.parameters.url).toBe('https://example.com');
    expect(sentCards[1].action.parameters.display_text).toBe('Shop');
  });

  it('should allow cards with empty action parameters', async () => {
    postSpy.mockResolvedValueOnce({ data: {} } as any);

    const cards: CarouselCard<CtaUrlAction>[] = [
      {
        card_index: 0,
        type: 'cta_url',
        header: {
          type: 'image',
          image: { link: 'https://example.com/img1.jpg' },
        },
        action: {},
      },
      {
        card_index: 1,
        type: 'cta_url',
        header: {
          type: 'image',
          image: { link: 'https://example.com/img2.jpg' },
        },
        action: {},
      },
    ];

    await sendCarouselUrlMessage(url, token, phoneNumber, text, cards);

    const payload = postSpy.mock.calls[0][1] as any;
    expect(payload.interactive.action.cards[0].action.name).toBe('cta_url');
  });

  it('should throw if fewer than 2 cards are provided', async () => {
    const cards: CarouselCard<QuickReplyAction>[] = [
      {
        card_index: 0,
        type: 'cta_url',
        header: {
          type: 'image',
          image: { link: 'https://example.com/img.jpg' },
        },
        action: { buttons: [{ quick_reply: { id: 'dummy', title: 'Dummy' } }] },
      },
    ];
    await expect(
      sendCarouselButtonMessage(url, token, phoneNumber, text, cards)
    ).rejects.toThrow('Carousel must have between 2 and 10 cards.');
  });

  it('should throw if more than 10 cards are provided', async () => {
    const cards: CarouselCard<QuickReplyAction>[] = Array.from(
      { length: 11 },
      (_, i) => ({
        card_index: i,
        type: 'cta_url' as const,
        header: {
          type: 'image' as const,
          image: { link: `https://example.com/img${i}.jpg` },
        },
        action: {
          buttons: [{ quick_reply: { id: `dummy${i}`, title: `Dummy ${i}` } }],
        },
      })
    );
    await expect(
      sendCarouselButtonMessage(url, token, phoneNumber, text, cards)
    ).rejects.toThrow('Carousel must have between 2 and 10 cards.');
  });
});
