/**
 * WhatsApp Client
 * Main class for interacting with WhatsApp Business Cloud API
 */

import type { AxiosResponse } from 'axios';
import type {
  WebhookPayload,
  WhatsAppMessage,
  SendMessageOptions,
  SendMediaOptions,
  TemplateComponent,
  HandlerFunction,
  HandlerOptions,
  InteractiveHandlerOptions,
  StatusHandlerFunction,
  StatusHandlerOptions,
  CarouselCard,
  QuickReplyAction,
  CtaUrlAction,
  FlowParameters,
  NextStepOptions,
  NextStepState,
} from './types/index.js';
import { Dispatcher } from './Dispatcher.js';
import type { Update } from './Update.js';
import type { InlineButton, ListItem, ListSection } from './Markup.js';
import type { InteractiveSendOptions } from './Message.js';
import type { UpdateHandler } from './Handlers.js';
import {
  TextHandler,
  ButtonHandler,
  InteractiveQueryHandler,
  ButtonReplyHandler,
  ListReplyHandler,
  FlowReplyHandler,
  ImageHandler,
  AudioHandler,
  VideoHandler,
  DocumentHandler,
  StickerHandler,
  LocationHandler,
} from './Handlers.js';
import {
  markAsRead as markMessageAsRead,
  sendTextMessage as sendTextMessageRequest,
  sendInteractiveMessage,
  sendButtonMessage as sendButtonMessageRequest,
  sendListMessage as sendListMessageRequest,
  sendFlowMessage as sendFlowMessageRequest,
  sendTemplateMessage,
  sendMediaMessage,
  sendCarouselButtonMessage,
  sendCarouselUrlMessage,
  sendLocationMessage,
  getMediaUrl,
  downloadMedia,
  downloadMediaData,
  sendTypingIndicator,
} from './Message.js';
import { formatPhoneNumber } from './utils/helpers.js';
import type { ContextStore } from './context/ContextStore.js';
import type { UserContext } from './context/UserContext.js';

/**
 * WhatsApp Client Configuration
 */
export interface WhatsAppConfig {
  numberId: string;
  token: string;
  markAsRead?: boolean;
  showTyping?: boolean;
  version?: number;
  handlers?: Record<string, UpdateHandler>;
  /**
   * Named step handlers for multi-turn flows, registered at startup (see
   * {@link WhatsApp.registerStep}). Requires `contextStore`.
   */
  steps?: Record<string, UpdateHandler>;
  /**
   * Persistent storage for per-user conversation context, e.g.
   * `new RedisContextStore(redis)` or `new PostgresContextStore(pool)`.
   *
   * Optional — but **required** as soon as any handler declares a `context`
   * parameter; registering such a handler without a store throws
   * {@link ContextStoreRequiredError}.
   */
  contextStore?: ContextStore;
  /**
   * How many times a context-aware handler is re-run when saving its context
   * hits an optimistic-lock conflict (another server changed the user's
   * context while the handler ran). After the retries are exhausted the
   * {@link ContextConflictError} propagates out of `processUpdate`.
   *
   * @default 3
   */
  contextConflictRetries?: number;
  /**
   * Ignore a message whose id (wamid) was already handled for that user.
   * WhatsApp redelivers a webhook (with backoff, for a long time) whenever it
   * does not receive a 200 in time — including when your handler *did* run
   * and commit but the response was late. With this on, the handled ids are
   * stored in the user's context record together with the handler's changes,
   * so a redelivery is skipped instead of being applied twice. Requires
   * `contextStore`; has no effect without one.
   *
   * @default true
   */
  dedupeMessages?: boolean;
}

/**
 * Main WhatsApp Client Class
 *
 * @example
 * ```typescript
 * const client = new WhatsApp({
 *   numberId: '1234567890',
 *   token: 'your_access_token'
 * });
 *
 * // Register message handler
 * client.onTextMessage(async (update) => {
 *   await update.replyWithText('Hello!');
 * });
 *
 * // Stateful handler — requires `contextStore` in the config
 * client.onTextMessage(async (update, context) => {
 *   const visits = context.get('visits', 0) + 1;
 *   context.set('visits', visits);
 *   await update.replyWithText(`Visit #${visits}`);
 * });
 *
 * // Process incoming webhook
 * await client.processUpdate(webhookPayload);
 * ```
 */
export class WhatsApp {
  public id: string;
  public token: string;
  public versionNumber: number;
  public baseUrl: string;
  public msgUrl: string;
  public mediaUrl: string;
  /** The configured context store, if any. */
  public readonly contextStore?: ContextStore;
  private dispatcher: Dispatcher;

  /**
   * Creates a new WhatsApp client instance
   * @param config - Client configuration
   */
  constructor(config: WhatsAppConfig) {
    this.id = config.numberId;
    this.token = config.token;
    this.versionNumber = config.version || 21;

    this.baseUrl = `https://graph.facebook.com/v${this.versionNumber}.0`;
    this.msgUrl = `${this.baseUrl}/${this.id}/messages`;
    this.mediaUrl = `${this.baseUrl}/${this.id}/media`;

    this.contextStore = config.contextStore;
    this.dispatcher = new Dispatcher(
      this,
      config.markAsRead !== false,
      config.showTyping !== false,
      {
        store: config.contextStore,
        conflictRetries: config.contextConflictRetries,
        dedupeMessages: config.dedupeMessages,
      }
    );
    if (config.handlers) {
      for (const handler of Object.values(config.handlers)) {
        this.dispatcher.registerHandler(handler);
      }
    }
    if (config.steps) {
      for (const [name, handler] of Object.entries(config.steps)) {
        this.dispatcher.registerStep(name, handler);
      }
    }
  }

  /**
   * Set API version
   */
  setVersion(version: number): void {
    this.versionNumber = version;
    this.baseUrl = `https://graph.facebook.com/v${this.versionNumber}.0`;
    this.msgUrl = `${this.baseUrl}/${this.id}/messages`;
    this.mediaUrl = `${this.baseUrl}/${this.id}/media`;
  }

  /**
   * Process incoming webhook update
   */
  async processUpdate(update: WebhookPayload): Promise<void> {
    return this.dispatcher.processUpdate(update);
  }

  /**
   * Mark message as read
   */
  async markAsRead(
    message: WhatsAppMessage,
    showTyping: boolean
  ): Promise<AxiosResponse> {
    return markMessageAsRead(this.msgUrl, this.token, message.id, showTyping);
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(
    messageId: string,
    markAsRead: boolean = true
  ): Promise<AxiosResponse> {
    return sendTypingIndicator(this.msgUrl, this.token, messageId, markAsRead);
  }

  /**
   * Send a message. If `options.replyMarkup` is provided it is sent as an
   * interactive message, otherwise as plain text.
   *
   * For text-only sends prefer {@link sendTextMessage}; for interactive sends
   * prefer {@link sendButtonMessage} / {@link sendListMessage} /
   * {@link sendFlowMessage}.
   */
  async sendMessage(
    phoneNumber: string,
    text: string,
    options: SendMessageOptions = {}
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);

    if (options.replyMarkup) {
      return sendInteractiveMessage(
        this.msgUrl,
        this.token,
        formattedPhone,
        text,
        options.replyMarkup,
        {
          msgId: options.msgId,
          header: options.header,
          headerType: options.headerType,
          footer: options.footer,
          bizOpaqueCallbackData: options.bizOpaqueCallbackData,
        }
      );
    }

    return sendTextMessageRequest(
      this.msgUrl,
      this.token,
      formattedPhone,
      text,
      {
        msgId: options.msgId,
        webPagePreview: options.webPagePreview,
        tagMessage: options.tagMessage,
        bizOpaqueCallbackData: options.bizOpaqueCallbackData,
      }
    );
  }

  /**
   * Send a plain **text** message (no interactive markup). Use this when you
   * only ever send text — unlike {@link sendMessage} it never branches into the
   * interactive path.
   */
  async sendTextMessage(
    phoneNumber: string,
    text: string,
    options: {
      msgId?: string;
      webPagePreview?: boolean;
      tagMessage?: boolean;
      bizOpaqueCallbackData?: string;
    } = {}
  ): Promise<AxiosResponse> {
    return sendTextMessageRequest(
      this.msgUrl,
      this.token,
      formatPhoneNumber(phoneNumber),
      text,
      options
    );
  }

  /**
   * Send an interactive **button** message (1–3 quick-reply buttons).
   */
  async sendButtonMessage(
    phoneNumber: string,
    text: string,
    buttons: (string | InlineButton)[],
    options: InteractiveSendOptions = {}
  ): Promise<AxiosResponse> {
    return sendButtonMessageRequest(
      this.msgUrl,
      this.token,
      formatPhoneNumber(phoneNumber),
      text,
      buttons,
      options
    );
  }

  /**
   * Send an interactive **list** message.
   */
  async sendListMessage(
    phoneNumber: string,
    text: string,
    buttonText: string,
    items: (ListItem | ListSection)[],
    options: InteractiveSendOptions = {}
  ): Promise<AxiosResponse> {
    return sendListMessageRequest(
      this.msgUrl,
      this.token,
      formatPhoneNumber(phoneNumber),
      text,
      buttonText,
      items,
      options
    );
  }

  /**
   * Send an interactive **Flow** message.
   */
  async sendFlowMessage(
    phoneNumber: string,
    text: string,
    flow: FlowParameters,
    options: InteractiveSendOptions = {}
  ): Promise<AxiosResponse> {
    return sendFlowMessageRequest(
      this.msgUrl,
      this.token,
      formatPhoneNumber(phoneNumber),
      text,
      flow,
      options
    );
  }

  /**
   * Send template message
   */
  async sendTemplateMessage(
    phoneNumber: string,
    templateName: string,
    components: TemplateComponent[] = [],
    languageCode: string = 'en_US',
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);

    return sendTemplateMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      templateName,
      components,
      languageCode,
      bizOpaqueCallbackData
    );
  }

  /**
   * Send media message
   */
  async sendMediaMessage(
    phoneNumber: string,
    mediaPath: string,
    options: SendMediaOptions = {}
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const mediaType = options.mediaType || 'image';

    return sendMediaMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      mediaPath,
      mediaType,
      options.caption,
      options.bizOpaqueCallbackData
    );
  }

  /**
   * Send an interactive media carousel message
   */
  async sendButtonCarousel(
    phoneNumber: string,
    text: string,
    cards: CarouselCard<QuickReplyAction>[],
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);

    return await sendCarouselButtonMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      text,
      cards,
      bizOpaqueCallbackData
    );
  }

  async sendUrlCarousel(
    phoneNumber: string,
    text: string,
    cards: CarouselCard<CtaUrlAction>[],
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);

    return await sendCarouselUrlMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      text,
      cards,
      bizOpaqueCallbackData
    );
  }

  /**
   * Send image message
   */
  async sendImage(
    phoneNumber: string,
    imagePath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    return this.sendMediaMessage(phoneNumber, imagePath, {
      caption,
      bizOpaqueCallbackData,
    });
  }

  /**
   * Send video message
   */
  async sendVideo(
    phoneNumber: string,
    videoPath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    return sendMediaMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      videoPath,
      'video',
      caption,
      bizOpaqueCallbackData
    );
  }

  /**
   * Send audio message
   */
  async sendAudio(
    phoneNumber: string,
    audioPath: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    return sendMediaMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      audioPath,
      'audio',
      undefined,
      bizOpaqueCallbackData
    );
  }

  /**
   * Send document message
   */
  async sendDocument(
    phoneNumber: string,
    documentPath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    return sendMediaMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      documentPath,
      'document',
      caption,
      bizOpaqueCallbackData
    );
  }

  /**
   * Send location message
   */
  async sendLocation(
    phoneNumber: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    return sendLocationMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      latitude,
      longitude,
      name,
      address,
      bizOpaqueCallbackData
    );
  }

  /**
   * Get media URL from media ID
   */
  async getMediaUrl(mediaId: string): Promise<any> {
    return getMediaUrl(this.baseUrl, mediaId, this.token);
  }

  /**
   * Download media file
   */
  async downloadMedia(mediaId: string, filePath?: string): Promise<string> {
    return downloadMedia(this.baseUrl, mediaId, this.token, filePath);
  }

  /**
   * Download media as buffer
   */
  async downloadMediaData(mediaId: string): Promise<Buffer> {
    return downloadMediaData(this.baseUrl, mediaId, this.token);
  }

  /**
   * Register a plain text message handler.
   */
  onTextMessage(action: HandlerFunction, options: HandlerOptions = {}): void {
    const handler = new TextHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * @deprecated Use {@link onTextMessage}.
   */
  onMessage(action: HandlerFunction, options: HandlerOptions = {}): void {
    this.onTextMessage(action, options);
  }

  /**
   * Register button message handler (template/CTA `button` messages).
   */
  onButtonMessage(action: HandlerFunction, options: HandlerOptions = {}): void {
    const handler = new ButtonHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register interactive message handler (handles **both** button and list
   * replies). Prefer {@link onButtonReply} / {@link onListReply} when you only
   * care about one reply type.
   */
  onInteractiveMessage(
    action: HandlerFunction,
    options: InteractiveHandlerOptions = {}
  ): void {
    const handler = new InteractiveQueryHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register a handler for interactive **button** replies only.
   */
  onButtonReply(action: HandlerFunction, options: HandlerOptions = {}): void {
    const handler = new ButtonReplyHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register a handler for interactive **list** replies only.
   */
  onListReply(action: HandlerFunction, options: HandlerOptions = {}): void {
    const handler = new ListReplyHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register a handler for **Flow** completion replies (`nfm_reply`). The parsed
   * Flow response is available on `update.flowReply`.
   */
  onFlowReply(action: HandlerFunction, options: HandlerOptions = {}): void {
    const handler = new FlowReplyHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register image message handler
   */
  onImageMessage(action: HandlerFunction, options: HandlerOptions = {}): void {
    const handler = new ImageHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register audio message handler
   */
  onAudioMessage(action: HandlerFunction, options: HandlerOptions = {}): void {
    const handler = new AudioHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register video message handler
   */
  onVideoMessage(action: HandlerFunction, options: HandlerOptions = {}): void {
    const handler = new VideoHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register document message handler
   */
  onDocumentMessage(
    action: HandlerFunction,
    options: HandlerOptions = {}
  ): void {
    const handler = new DocumentHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register sticker message handler
   */
  onStickerMessage(
    action: HandlerFunction,
    options: HandlerOptions = {}
  ): void {
    const handler = new StickerHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register location message handler
   */
  onLocationMessage(
    action: HandlerFunction,
    options: HandlerOptions = {}
  ): void {
    const handler = new LocationHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register a message-status handler.
   *
   * Status webhooks report what happened to a message you previously sent
   * (`sent`, `delivered`, `read`, `failed`). The status's `messageId` (wamid)
   * is the only link back to the original message.
   *
   * @param action - Callback invoked with a {@link StatusUpdate}
   * @param options - Optionally filter by status, e.g. `{ status: 'failed' }`
   *
   * @example
   * ```typescript
   * client.onMessageStatus((status) => {
   *   console.error(`Delivery failed for ${status.messageId}:`, status.error?.code);
   * }, { status: 'failed' });
   * ```
   */
  onMessageStatus(
    action: StatusHandlerFunction,
    options: StatusHandlerOptions = {}
  ): void {
    this.dispatcher.registerStatusHandler(action, options);
  }

  /**
   * Register a named **step handler** for multi-turn flows. The name is what
   * gets persisted in the user's context when you call {@link setNextStep},
   * so register every step at startup on every instance (or pass them via the
   * `steps` config option).
   *
   * @example
   * ```typescript
   * client.registerStep('ask_email', new TextHandler(async (update, context) => {
   *   context.set('email', update.messageText);
   *   await update.replyWithText('Thanks!');
   * }));
   * client.registerStep('cancel', new TextHandler(async (update) => {
   *   await update.replyWithText('Cancelled.');
   * }));
   *
   * client.onTextMessage(async (update) => {
   *   await update.replyWithText('What is your email?');
   *   await client.setNextStep(update, 'ask_email', { fallback: 'cancel' });
   * }, { regex: /^register$/i });
   * ```
   *
   * @throws {ContextStoreRequiredError} when no `contextStore` is configured
   */
  registerStep(name: string, handler: UpdateHandler): void {
    this.dispatcher.registerStep(name, handler);
  }

  /**
   * Route the user's next message to a registered step handler. Persisted in
   * the context store, so it survives restarts and is honoured by whichever
   * instance receives the next message.
   *
   * Inside a handler pass the `update`; the change is committed together
   * with the handler's context when it resolves. From outside (cron, admin
   * endpoint) pass the phone number; the change is written immediately.
   *
   * @param target - The current `Update`, or a phone number
   * @param step - A registered step name (or the registered handler instance)
   * @param options - Optional `fallback` step + `fallbackRegex` gate
   * @throws {ContextStoreRequiredError} when no `contextStore` is configured
   * @throws {UnknownStepError} when the step or fallback is not registered
   */
  async setNextStep(
    target: Update | string,
    step: string | UpdateHandler,
    options: NextStepOptions = {}
  ): Promise<void> {
    return this.dispatcher.setNextStep(target, step, options);
  }

  /**
   * Cancel the user's pending next step.
   */
  async clearNextStep(target: Update | string): Promise<void> {
    return this.dispatcher.clearNextStep(target);
  }

  /**
   * The user's pending next step, if any.
   */
  async getNextStep(
    target: Update | string
  ): Promise<NextStepState | undefined> {
    return this.dispatcher.getNextStep(target);
  }

  /**
   * Load a user's persistent conversation context outside of a handler (e.g.
   * from a status handler, a cron job or an admin endpoint). Changes are only
   * persisted when you `await context.save()`.
   *
   * @throws {ContextStoreRequiredError} when no `contextStore` is configured
   */
  async getContext(phoneNumber: string): Promise<UserContext> {
    return this.dispatcher.getContext(phoneNumber);
  }

  /**
   * Delete a user's persistent conversation context.
   *
   * @throws {ContextStoreRequiredError} when no `contextStore` is configured
   */
  async clearContext(phoneNumber: string): Promise<void> {
    return this.dispatcher.clearContext(phoneNumber);
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { size: number; isProcessing: boolean } {
    return this.dispatcher.getQueueStatus();
  }
}
