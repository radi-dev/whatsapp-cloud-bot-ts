/**
 * Core type definitions for WhatsApp Bot Client
 */

import type { AxiosResponse } from 'axios';
import type { Update } from '../Update.js';
import type { StatusUpdate } from '../StatusUpdate.js';
import type { InlineButton, ListItem, ListSection } from '../Markup.js';
import type { InteractiveSendOptions } from '../Message.js';
import type { UserContext } from '../context/UserContext.js';
import type { ContextStore } from '../context/ContextStore.js';

/**
 * WhatsApp webhook value object received from WhatsApp servers
 */
export interface WebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Array<{
    profile: {
      name: string;
    };
    wa_id: string;
  }>;
  messages?: WhatsAppMessage[];
  statuses?: MessageStatus[];
}

/**
 * Delivery status reported for a previously-sent message.
 * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
 */
export type MessageStatusType = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Error detail attached to a 'failed' message status. Inspect `code` to decide
 * whether a retry makes sense — not every failure is retryable.
 */
export interface MessageStatusError {
  /** WhatsApp error code (e.g. 131049). The key signal for retry decisions. */
  code: number;
  /** Short, human-readable error title. */
  title: string;
  /** Longer error message (often identical to `title`). */
  message?: string;
  /** Additional, more specific detail. */
  error_data?: {
    details: string;
  };
  /** Link to the relevant error-code documentation. */
  href?: string;
}

/**
 * Conversation context attached to a message status (billing window, origin).
 */
export interface MessageStatusConversation {
  id: string;
  origin?: {
    type: string;
  };
  expiration_timestamp?: string;
}

/**
 * Pricing/billing context attached to a message status.
 */
export interface MessageStatusPricing {
  billable?: boolean;
  pricing_model?: string;
  category?: string;
}

/**
 * A single message-status entry delivered via the `statuses` webhook.
 *
 * `id` is the WhatsApp message id (wamid) returned when the message was sent —
 * it is the only field that ties this status back to the original message.
 */
export interface MessageStatus {
  /** WhatsApp message id (wamid) of the message this status refers to. */
  id: string;
  /** Current delivery status. */
  status: MessageStatusType;
  /** Unix timestamp in seconds, as a string, of when the status occurred. */
  timestamp: string;
  /** WhatsApp user id (phone number) the message was sent to. */
  recipient_id: string;
  conversation?: MessageStatusConversation;
  pricing?: MessageStatusPricing;
  /** Present when `status` is 'failed'. Describes why delivery failed. */
  errors?: MessageStatusError[];
  /**
   * Arbitrary tracking string you supplied as `biz_opaque_callback_data` when
   * sending — echoed back here so you can correlate the status to your own
   * records without maintaining a separate lookup table.
   */
  biz_opaque_callback_data?: string;
}

/**
 * Complete webhook object structure
 */
export interface WebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: WebhookValue;
      field: string;
    }>;
  }>;
}

/**
 * Message types supported by WhatsApp
 */
export type MessageType =
  | 'text'
  | 'button'
  | 'interactive'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'unknown'
  | 'unsupported';

/**
 * Sub-types of an interactive reply message (`message.interactive.type`):
 * - `button_reply` — a reply (quick-reply) button was tapped
 * - `list_reply` — a list option was chosen
 * - `nfm_reply` — a Flow was completed/submitted
 */
export type InteractiveReplyType = 'button_reply' | 'list_reply' | 'nfm_reply';

/**
 * Parsed Flow completion reply (`interactive.nfm_reply`).
 */
export interface FlowReplyData {
  /** Always `'flow'`. */
  name: string;
  /** Always `'Sent'`. */
  body: string;
  /** Raw `response_json` string returned by the Flow. */
  responseJson: string;
  /** Parsed `response_json` object. */
  data: Record<string, unknown>;
  /** `flow_token` from the parsed response, if present. */
  flowToken?: string;
}

/**
 * Base WhatsApp message structure
 */
export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: MessageType;
  text?: {
    body: string;
  };
  button?: {
    payload: string;
    text: string;
  };
  interactive?: {
    type: InteractiveReplyType;
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
    /** Present when a user completes/submits a Flow (type `nfm_reply`). */
    nfm_reply?: {
      /** Always `'flow'`. */
      name: string;
      /** Always `'Sent'`. */
      body: string;
      /** Flow-specific data as a JSON string (the flow's Complete payload). */
      response_json: string;
    };
  };
  image?: MediaObject;
  audio?: MediaObject & { voice?: boolean };
  video?: MediaObject;
  document?: MediaObject;
  sticker?: MediaObject;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  context?: {
    from: string;
    id: string;
  };
}

/**
 * Media object structure
 */
export interface MediaObject {
  id: string;
  mime_type: string;
  sha256: string;
  caption?: string;
  url?: string;
}

/**
 * Update data extracted from messages
 */
export interface UpdateData {
  messageText: string;
  button?: {
    payload: string;
    text: string;
  };
  listReply?: {
    id: string;
    title: string;
    description?: string;
  };
  buttonReply?: {
    id: string;
    title: string;
  };
  flowReply?: FlowReplyData;
  mediaMimeType?: string;
  mediaFileId?: string;
  mediaHash?: string;
  mediaVoice?: boolean;
  mediaUrl?: string;
  locAddress?: string;
  locName?: string;
  locLatitude?: number;
  locLongitude?: number;
}

/**
 * Handler function type.
 *
 * Declare only `update` for a stateless handler. Declare a second `context`
 * parameter to receive the user's persistent {@link UserContext} — doing so
 * marks the handler as context-aware, which **requires** a `contextStore` to be
 * configured on the client (registration throws
 * {@link ContextStoreRequiredError} otherwise). See {@link HandlerOptions.context}
 * to override the automatic detection.
 *
 * The dispatcher loads the context before the handler runs and saves it after
 * the handler resolves; if the handler throws, unsaved changes are discarded.
 * Saves are optimistically locked: if another server changed the user's
 * context meanwhile, the handler is re-run with fresh state (see
 * `contextConflictRetries`), so keep side effects reasonably idempotent.
 */
export type HandlerFunction = (
  update: Update,
  context: UserContext
) => void | Promise<void>;
export type FilterFunction = (text: string) => boolean;

/**
 * Message-status handler callback. Receives a {@link StatusUpdate} describing
 * one delivery-status change for a previously-sent message.
 */
export type StatusHandlerFunction = (
  status: StatusUpdate
) => void | Promise<void>;

/**
 * Options for registering a message-status handler.
 */
export interface StatusHandlerOptions {
  /**
   * Only invoke the handler for these status value(s). Omit to receive every
   * status. e.g. `{ status: 'failed' }` to react only to delivery failures.
   */
  status?: MessageStatusType | MessageStatusType[];
  /**
   * Skip this handler if more than this many minutes have elapsed since the
   * status webhook's `timestamp` (WEBHOOK_TRIGGER_TIMESTAMP). Useful for
   * dropping stale receipts delivered long after the event. Omit to always run.
   */
  ignoreAfterMinutes?: number;
}

/**
 * Handler options
 */
export interface HandlerOptions {
  regex?: RegExp;
  filter?: FilterFunction;
  /**
   * Whether this handler uses the persistent user context.
   *
   * - `undefined` (default): auto-detect — the handler is context-aware when
   *   its function declares two or more parameters (`(update, context) => …`).
   * - `true`: always load/save the context for this handler.
   * - `false`: never, even if the function declares a `context` parameter.
   *
   * Context-aware handlers require a `contextStore` on the client; registering
   * one without a store throws {@link ContextStoreRequiredError}.
   */
  context?: boolean;
  persistent?: boolean;
  /**
   * Skip this handler if more than this many minutes have elapsed since the
   * webhook's `timestamp` (WEBHOOK_TRIGGER_TIMESTAMP). Useful for dropping
   * stale messages replayed or delivered long after they were sent. Omit to
   * always run regardless of age.
   */
  ignoreAfterMinutes?: number;
}

/**
 * Interactive handler options
 */
export interface InteractiveHandlerOptions extends HandlerOptions {
  handleButton?: boolean;
  handleList?: boolean;
}

/**
 * Options for {@link UserContext.setNextStep} / `client.setNextStep`.
 */
export interface NextStepOptions {
  /**
   * Name of a registered step to run *instead of* `step` when the message
   * text matches `fallbackRegex` — typically a cancel/abort handler.
   */
  fallback?: string;
  /**
   * Gate for the fallback. Defaults to `/^(end|stop|cancel)$/i` when a
   * fallback is given. Persisted with the step (source + flags).
   */
  fallbackRegex?: RegExp | string;
}

/**
 * A user's pending next step, as persisted in their context record. Step and
 * fallback are **names** of handlers registered with `client.registerStep`
 * (or the `steps` config option) — that is what makes the state portable
 * across restarts and instances.
 */
export interface NextStepState {
  step: string;
  fallback?: string;
  fallbackRegex?: RegExp;
}

/**
 * Shape of a user's stored context document. Values must be JSON-serialisable.
 */
export interface UserContextData {
  [key: string]: any;
}

/**
 * Reply markup types
 */
export type ReplyMarkupType =
  'button' | 'list' | 'location_request_message' | 'carousel' | 'flow';

/**
 * WhatsApp Flow — interactive message types
 * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/flows
 */

/** Whether the referenced Flow is a draft or a published Flow. */
export type FlowMode = 'draft' | 'published';

/**
 * How the Flow is launched:
 * - `navigate` — open a specific screen (optionally with prefilled data)
 * - `data_exchange` — the first screen is resolved by your Flow endpoint
 */
export type FlowActionType = 'navigate' | 'data_exchange';

/**
 * Payload describing the first screen to show. Only valid when
 * `flow_action` is `navigate`; omitted otherwise.
 */
export interface FlowActionPayload {
  /** ID of the entry screen to display first. Defaults to `FIRST_ENTRY_SCREEN`. */
  screen?: string;
  /**
   * Input data for the first screen. Must be a non-empty object — the library
   * serializes it to the JSON string the API expects.
   */
  data?: Record<string, unknown>;
}

/**
 * Identifier for the Flow — exactly one of `flow_id` or `flow_name` is required
 * (they are mutually exclusive).
 */
export type FlowIdentifier =
  | { flow_id: string; flow_name?: never }
  | { flow_name: string; flow_id?: never };

/**
 * Developer-facing parameters for sending a Flow message. Fields the library
 * defaults (version, mode, token, action) are optional; supply the rest.
 */
export type FlowParameters = FlowIdentifier & {
  /** Text on the CTA button that opens the Flow (≤30 chars advised, no emoji). */
  flow_cta: string;
  /** Flow Message version. Defaults to `'3'` — you normally don't set this. */
  flow_message_version?: string;
  /** Draft or published Flow. Defaults to `'published'`. */
  mode?: FlowMode;
  /** Business-generated identifier echoed back to your endpoint. Defaults to `'unused'`. */
  flow_token?: string;
  /** `navigate` or `data_exchange`. Defaults to `'navigate'`. */
  flow_action?: FlowActionType;
  /** First-screen payload. Only used when `flow_action` is `navigate`. */
  flow_action_payload?: FlowActionPayload;
};

/**
 * The resolved `interactive.action` object sent to the API for a Flow message
 * (after defaults are applied and `flow_action_payload.data` is serialized).
 */
export interface FlowAction {
  name: 'flow';
  parameters: {
    flow_message_version: string;
    flow_id?: string;
    flow_name?: string;
    flow_cta: string;
    mode: FlowMode;
    flow_token: string;
    flow_action: FlowActionType;
    flow_action_payload?: {
      screen: string;
      data?: string;
    };
  };
}

/**
 * Template component structure
 */
export interface TemplateComponent {
  type: string;
  parameters?: any[];
}

/**
 * Send message options
 */
export interface SendMessageOptions {
  msgId?: string;
  replyMarkup?: ReplyMarkup;
  header?: string;
  headerType?: 'text' | 'image' | 'video' | 'document';
  footer?: string;
  webPagePreview?: boolean;
  tagMessage?: boolean;
  /**
   * Arbitrary tracking string (max ~512 chars) echoed back on the message's
   * status webhook as `biz_opaque_callback_data`. Use it to correlate delivery
   * statuses to your own records without a wamid lookup table.
   */
  bizOpaqueCallbackData?: string;
}

/**
 * Send media options
 */
export interface SendMediaOptions {
  caption?: string;
  mediaProviderToken?: string;
  msgId?: string;
  tagMessage?: boolean;
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  /**
   * Arbitrary tracking string (max ~512 chars) echoed back on the message's
   * status webhook as `biz_opaque_callback_data`. Use it to correlate delivery
   * statuses to your own records without a wamid lookup table.
   */
  bizOpaqueCallbackData?: string;
}

/**
 * CTA URL button action — opens a URL in the user's browser when tapped.
 *
 * Used as the `action` of a {@link UrlCarouselCard}.
 */
export type CtaUrlAction = {
  /**
   * Action name. Auto-populated by the library to `'cta_url'` at send time —
   * you don't need to set it.
   */
  name?: 'cta_url';
  /**
   * Button label and destination URL. Optional only to allow building a card
   * incrementally — supply both `display_text` and `url` for a working button.
   */
  parameters?: {
    /** Text shown on the button (max 20 characters). */
    display_text: string;
    /** URL opened when the button is tapped. */
    url: string;
  };
};

/**
 * A single quick-reply button. Tapping it sends `quick_reply.id` back to your
 * webhook as an interactive `button_reply`.
 *
 * Used inside a {@link QuickReplyAction}.
 */
export type ButtonAction = {
  /**
   * Button type. Auto-populated by the library to `'quick_reply'` at send
   * time — you don't need to set it.
   */
  type?: 'quick_reply';
  quick_reply: {
    /** Payload returned to your webhook when the button is tapped (max 256 characters). */
    id: string;
    /** Text shown on the button (max 20 characters). */
    title: string;
  };
};

/**
 * Quick-reply action for a carousel card — one or more buttons that send a
 * payload back to the bot. Every card in the same carousel must declare the
 * same number of buttons.
 *
 * Used as the `action` of a {@link ButtonCarouselCard}.
 */
export type QuickReplyAction = {
  buttons: ButtonAction[];
};

/**
 * Media header for a carousel card. Provide **either** an image **or** a video
 * link — the `type` field is auto-populated by the library at send time, so you
 * only need to supply the media link.
 */
export type CarouselHeader =
  | {
      /** Auto-set to `'image'` by the library — you don't need to set it. */
      type?: 'image';
      image: { link: string };
    }
  | {
      /** Auto-set to `'video'` by the library — you don't need to set it. */
      type?: 'video';
      video: { link: string };
    };

/**
 * A single card in an interactive media carousel.
 *
 * The `action` type parameter determines the card flavour:
 * - {@link CtaUrlAction} → a CTA-URL card (see {@link UrlCarouselCard})
 * - {@link QuickReplyAction} → a quick-reply button card (see {@link ButtonCarouselCard})
 *
 * `card_index` and `type` are auto-populated by the library at send time, so
 * you normally only set `header`, `body`, and `action`.
 *
 * @example
 * ```typescript
 * const card: UrlCarouselCard = {
 *   header: { image: { link: 'https://example.com/img.jpg' } },
 *   body: { text: 'Visit our store' },
 *   action: { parameters: { display_text: 'Shop Now', url: 'https://example.com' } },
 * };
 * ```
 */
export interface CarouselCard<
  T extends QuickReplyAction | CtaUrlAction = CtaUrlAction,
> {
  /** Position of the card in the carousel. Auto-populated by the library. */
  card_index?: number;
  /** Card type. Auto-populated by the library — you don't need to set it. */
  type?: 'cta_url';
  /** Media header shown at the top of the card (image or video). */
  header: CarouselHeader;
  /** Optional card body text (max 1024 characters, up to 2 line breaks). */
  body?: {
    text: string;
  };
  /** The card's button action (CTA URL or quick-reply buttons). */
  action: T;
}

/** A carousel card whose button opens a URL (CTA URL). */
export type UrlCarouselCard = CarouselCard<CtaUrlAction>;

/** A carousel card with one or more quick-reply buttons. */
export type ButtonCarouselCard = CarouselCard<QuickReplyAction>;

/**
 * Per-user conversation state handed to context-aware handlers. See the
 * {@link UserContext} class (re-exported here for convenience).
 */
export type { UserContext };

/**
 * Update handler base interface
 */
export interface UpdateHandler {
  name: MessageType;
  regex?: RegExp;
  filter?: FilterFunction;
  action: HandlerFunction;
  context: boolean;
  persistent: boolean;
  list?: boolean;
  button?: boolean;
  ignoreAfterMinutes?: number;
  /**
   * For `interactive` handlers, the reply sub-types this handler accepts. The
   * dispatcher only runs the handler when `message.interactive.type` is one of
   * these. Undefined means "no sub-type restriction".
   */
  interactiveTypes?: InteractiveReplyType[];

  extractData(message: WhatsAppMessage): UpdateData;
  filterCheck(text: string): boolean;
  run(update: Update, context?: UserContext): Promise<void>;
}

/**
 * Reply markup base interface
 */
export interface ReplyMarkup {
  type: ReplyMarkupType;
  markup: any;
}

/**
 * WhatsApp client interface
 */
export interface WhatsAppClient {
  id: string;
  token: string;
  versionNumber: number;
  baseUrl: string;
  msgUrl: string;
  mediaUrl: string;

  // Core methods
  processUpdate(update: WebhookPayload): Promise<void>;
  setVersion(version: number): void;

  // Message sending methods
  sendMessage(
    phoneNumber: string,
    text: string,
    options?: SendMessageOptions
  ): Promise<AxiosResponse>;

  sendTextMessage(
    phoneNumber: string,
    text: string,
    options?: {
      msgId?: string;
      webPagePreview?: boolean;
      tagMessage?: boolean;
      bizOpaqueCallbackData?: string;
    }
  ): Promise<AxiosResponse>;

  sendButtonMessage(
    phoneNumber: string,
    text: string,
    buttons: (string | InlineButton)[],
    options?: InteractiveSendOptions
  ): Promise<AxiosResponse>;

  sendListMessage(
    phoneNumber: string,
    text: string,
    buttonText: string,
    items: (ListItem | ListSection)[],
    options?: InteractiveSendOptions
  ): Promise<AxiosResponse>;

  sendFlowMessage(
    phoneNumber: string,
    text: string,
    flow: FlowParameters,
    options?: InteractiveSendOptions
  ): Promise<AxiosResponse>;

  sendTemplateMessage(
    phoneNumber: string,
    templateName: string,
    components?: TemplateComponent[],
    languageCode?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse>;

  sendMediaMessage(
    phoneNumber: string,
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<AxiosResponse>;

  sendButtonCarousel(
    phoneNumber: string,
    text: string,
    cards: CarouselCard<QuickReplyAction>[],
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse>;

  sendUrlCarousel(
    phoneNumber: string,
    text: string,
    cards: CarouselCard<CtaUrlAction>[],
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse>;

  sendImage(
    phoneNumber: string,
    imagePath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse>;

  sendVideo(
    phoneNumber: string,
    videoPath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse>;

  sendAudio(
    phoneNumber: string,
    audioPath: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse>;

  sendDocument(
    phoneNumber: string,
    documentPath: string,
    caption?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse>;

  sendLocation(
    phoneNumber: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
    bizOpaqueCallbackData?: string
  ): Promise<AxiosResponse>;

  // Media utility methods
  getMediaUrl(mediaId: string): Promise<any>;
  downloadMedia(mediaId: string, filePath?: string): Promise<string>;
  downloadMediaData(mediaId: string): Promise<Buffer>;

  // Message status methods
  markAsRead(
    message: WhatsAppMessage,
    showTyping: boolean
  ): Promise<AxiosResponse>;
  sendTypingIndicator(
    messageId: string,
    markAsRead?: boolean
  ): Promise<AxiosResponse>;

  // Handler registration methods
  onTextMessage(action: HandlerFunction, options?: HandlerOptions): void;
  /** @deprecated Use onTextMessage. */
  onMessage(action: HandlerFunction, options?: HandlerOptions): void;
  onButtonMessage(action: HandlerFunction, options?: HandlerOptions): void;
  onInteractiveMessage(
    action: HandlerFunction,
    options?: InteractiveHandlerOptions
  ): void;
  onButtonReply(action: HandlerFunction, options?: HandlerOptions): void;
  onListReply(action: HandlerFunction, options?: HandlerOptions): void;
  onFlowReply(action: HandlerFunction, options?: HandlerOptions): void;
  onImageMessage(action: HandlerFunction, options?: HandlerOptions): void;
  onAudioMessage(action: HandlerFunction, options?: HandlerOptions): void;
  onVideoMessage(action: HandlerFunction, options?: HandlerOptions): void;
  onDocumentMessage(action: HandlerFunction, options?: HandlerOptions): void;
  onStickerMessage(action: HandlerFunction, options?: HandlerOptions): void;
  onLocationMessage(action: HandlerFunction, options?: HandlerOptions): void;
  onMessageStatus(
    action: StatusHandlerFunction,
    options?: StatusHandlerOptions
  ): void;

  // Conversation context methods
  /** The configured context store, if any. */
  readonly contextStore?: ContextStore;
  getContext(userId: string): Promise<UserContext>;
  clearContext(userId: string): Promise<void>;

  // Conversation flow methods (next step is persisted in the context store)
  registerStep(name: string, handler: UpdateHandler): void;
  setNextStep(
    target: Update | string,
    step: string | UpdateHandler,
    options?: NextStepOptions
  ): Promise<void>;
  clearNextStep(target: Update | string): Promise<void>;
  getNextStep(target: Update | string): Promise<NextStepState | undefined>;

  // Utility methods
  getQueueStatus(): { size: number; isProcessing: boolean };
}

/**
 * Dispatcher configuration
 */
export interface DispatcherConfig {
  markAsRead: boolean;
  showTyping: boolean;
}
