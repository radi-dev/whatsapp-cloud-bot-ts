/**
 * Update Class
 * Represents an incoming message update from WhatsApp
 */

import type { AxiosResponse } from 'axios';
import type {
  WebhookValue,
  WhatsAppMessage,
  SendMessageOptions,
  SendMediaOptions,
  WhatsAppClient,
  CarouselCard,
  QuickReplyAction,
  CtaUrlAction,
  FlowParameters,
  FlowReplyData,
} from './types/index.js';
import type { InlineButton, ListItem, ListSection } from './Markup.js';
import type { InteractiveSendOptions } from './Message.js';
import type { UserContext } from './context/UserContext.js';
import { ContextStoreRequiredError } from './context/ContextStore.js';

/** Text-only reply options. */
export interface ReplyTextOptions {
  msgId?: string;
  webPagePreview?: boolean;
  tagMessage?: boolean;
  bizOpaqueCallbackData?: string;
}

/**
 * Update class - encapsulates an incoming WhatsApp message
 */
export class Update {
  public bot: WhatsAppClient;
  public value: WebhookValue;
  public message: WhatsAppMessage;
  public user: {
    profile: { name: string };
    wa_id: string;
  };
  public userDisplayName: string;
  public userPhoneNumber: string;
  public messageId: string;
  public messageText?: string;
  public interactiveText?: any;
  /** Parsed Flow completion reply, set on `nfm_reply` interactive messages. */
  public flowReply?: FlowReplyData;
  public mediaUrl?: string;
  public mediaMimeType?: string;
  public mediaFileId?: string;
  public mediaHash?: string;
  public mediaVoice?: boolean;
  public locAddress?: string;
  public locName?: string;
  public locLatitude?: number;
  public locLongitude?: number;
  private attachedContext?: UserContext;

  constructor(bot: WhatsAppClient, value: WebhookValue) {
    this.bot = bot;
    this.value = value;
    this.message = value.messages?.[0] || ({} as WhatsAppMessage);
    this.user = value.contacts?.[0] || { profile: { name: '' }, wa_id: '' };
    this.userDisplayName = this.user.profile?.name || '';
    this.userPhoneNumber = this.user.wa_id || '';
    this.messageId = this.message.id || '';
  }

  /**
   * The sender's persistent {@link UserContext} for this update. Attached by
   * the dispatcher whenever a `contextStore` is configured (for every handler,
   * context-aware or not), so helpers that only receive the `update` can still
   * read state or call `setNextStep`. Changes are persisted together with the
   * handler's own context changes when the handler resolves.
   *
   * @throws {ContextStoreRequiredError} when no context is attached (no store
   *   configured, or an `Update` constructed outside the dispatcher)
   */
  get context(): UserContext {
    if (!this.attachedContext) {
      throw new ContextStoreRequiredError(
        'update.context was accessed but no context is attached to this update.'
      );
    }
    return this.attachedContext;
  }

  /** Whether a {@link UserContext} is attached (see {@link context}). */
  get hasContext(): boolean {
    return this.attachedContext !== undefined;
  }

  /** @internal Used by the dispatcher to attach the loaded context. */
  attachContext(context: UserContext | undefined): void {
    this.attachedContext = context;
  }

  // ---------------------------------------------------------------------------
  // Text
  // ---------------------------------------------------------------------------

  /**
   * Reply with a plain text message (text-only).
   */
  async replyWithText(
    text: string,
    options: ReplyTextOptions = {}
  ): Promise<AxiosResponse> {
    return await this.bot.sendTextMessage(this.userPhoneNumber, text, {
      ...options,
      msgId: options.msgId || this.messageId,
    });
  }

  /**
   * @deprecated Use {@link replyWithText} (text) or {@link replyWithButton} /
   * {@link replyWithList} / {@link replyWithFlow} (interactive). Retained for
   * backwards compatibility; still supports `options.replyMarkup`.
   */
  async replyMessage(
    text: string,
    options: SendMessageOptions = {}
  ): Promise<AxiosResponse> {
    return await this.bot.sendMessage(this.userPhoneNumber, text, {
      ...options,
      msgId: options.msgId || this.messageId,
    });
  }

  // ---------------------------------------------------------------------------
  // Interactive (buttons / list / flow)
  // ---------------------------------------------------------------------------

  /**
   * Reply with an interactive button message (1–3 quick-reply buttons).
   */
  async replyWithButton(
    text: string,
    buttons: (string | InlineButton)[],
    options: InteractiveSendOptions = {}
  ): Promise<AxiosResponse> {
    return await this.bot.sendButtonMessage(
      this.userPhoneNumber,
      text,
      buttons,
      {
        ...options,
        msgId: options.msgId || this.messageId,
      }
    );
  }

  /**
   * Reply with an interactive list message.
   */
  async replyWithList(
    text: string,
    buttonText: string,
    items: (ListItem | ListSection)[],
    options: InteractiveSendOptions = {}
  ): Promise<AxiosResponse> {
    return await this.bot.sendListMessage(
      this.userPhoneNumber,
      text,
      buttonText,
      items,
      { ...options, msgId: options.msgId || this.messageId }
    );
  }

  /**
   * Reply with an interactive WhatsApp Flow message.
   */
  async replyWithFlow(
    text: string,
    flow: FlowParameters,
    options: InteractiveSendOptions = {}
  ): Promise<AxiosResponse> {
    return await this.bot.sendFlowMessage(this.userPhoneNumber, text, flow, {
      ...options,
      msgId: options.msgId || this.messageId,
    });
  }

  /**
   * Reply with a quick-reply button carousel
   */
  async replyWithButtonCarousel(
    text: string,
    cards: CarouselCard<QuickReplyAction>[],
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.bot.sendButtonCarousel(
      this.userPhoneNumber,
      text,
      cards,
      bizOpaqueCallbackData
    );
  }

  /**
   * Reply with a CTA URL carousel
   */
  async replyWithUrlCarousel(
    text: string,
    cards: CarouselCard<CtaUrlAction>[],
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.bot.sendUrlCarousel(
      this.userPhoneNumber,
      text,
      cards,
      bizOpaqueCallbackData
    );
  }

  // ---------------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------------

  /**
   * Reply with media (type inferred from `options.mediaType`, default image).
   */
  async replyWithMedia(
    mediaPath: string,
    options: SendMediaOptions = {}
  ): Promise<AxiosResponse> {
    return await this.bot.sendMediaMessage(this.userPhoneNumber, mediaPath, {
      ...options,
      msgId: options.msgId || this.messageId,
    });
  }

  /** Reply with an image message. */
  async replyWithImage(
    imagePath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.bot.sendImage(
      this.userPhoneNumber,
      imagePath,
      caption,
      bizOpaqueCallbackData
    );
  }

  /** Reply with a video message. */
  async replyWithVideo(
    videoPath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.bot.sendVideo(
      this.userPhoneNumber,
      videoPath,
      caption,
      bizOpaqueCallbackData
    );
  }

  /** Reply with an audio message. */
  async replyWithAudio(
    audioPath: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.bot.sendAudio(
      this.userPhoneNumber,
      audioPath,
      bizOpaqueCallbackData
    );
  }

  /** Reply with a document message. */
  async replyWithDocument(
    documentPath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.bot.sendDocument(
      this.userPhoneNumber,
      documentPath,
      caption,
      bizOpaqueCallbackData
    );
  }

  /** Reply with a sticker message. */
  async replyWithSticker(
    stickerPath: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.bot.sendMediaMessage(this.userPhoneNumber, stickerPath, {
      mediaType: 'sticker',
      bizOpaqueCallbackData,
    });
  }

  /** Reply with a location message. */
  async replyWithLocation(
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.bot.sendLocation(
      this.userPhoneNumber,
      latitude,
      longitude,
      name,
      address,
      bizOpaqueCallbackData
    );
  }

  /** Reply with a template message. */
  async replyWithTemplate(
    templateName: string,
    components?: any[],
    languageCode?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.bot.sendTemplateMessage(
      this.userPhoneNumber,
      templateName,
      components,
      languageCode,
      bizOpaqueCallbackData
    );
  }

  // ---------------------------------------------------------------------------
  // Deprecated aliases (kept for backwards compatibility)
  // ---------------------------------------------------------------------------

  /** @deprecated Use {@link replyWithMedia}. */
  async replyMedia(
    mediaPath: string,
    options: SendMediaOptions = {}
  ): Promise<AxiosResponse> {
    return await this.replyWithMedia(mediaPath, options);
  }

  /** @deprecated Use {@link replyWithTemplate}. */
  async replyTemplate(
    templateName: string,
    components?: any[],
    languageCode?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.replyWithTemplate(
      templateName,
      components,
      languageCode,
      bizOpaqueCallbackData
    );
  }

  /** @deprecated Use {@link replyWithImage}. */
  async replyImage(
    imagePath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.replyWithImage(imagePath, caption, bizOpaqueCallbackData);
  }

  /** @deprecated Use {@link replyWithVideo}. */
  async replyVideo(
    videoPath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.replyWithVideo(videoPath, caption, bizOpaqueCallbackData);
  }

  /** @deprecated Use {@link replyWithAudio}. */
  async replyAudio(
    audioPath: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.replyWithAudio(audioPath, bizOpaqueCallbackData);
  }

  /** @deprecated Use {@link replyWithDocument}. */
  async replyDocument(
    documentPath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.replyWithDocument(
      documentPath,
      caption,
      bizOpaqueCallbackData
    );
  }

  /** @deprecated Use {@link replyWithLocation}. */
  async replyLocation(
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.replyWithLocation(
      latitude,
      longitude,
      name,
      address,
      bizOpaqueCallbackData
    );
  }

  /** @deprecated Use {@link replyWithSticker}. */
  async replySticker(
    stickerPath: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return await this.replyWithSticker(stickerPath, bizOpaqueCallbackData);
  }
}
