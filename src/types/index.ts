/**
 * Core type definitions for WhatsApp Bot Client
 */

import type { AxiosResponse } from 'axios';

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
  statuses?: any[];
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
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
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
}

/**
 * Update data extracted from messages
 */
export interface UpdateData {
  messageText: string;
  listReply?: {
    id: string;
    title: string;
    description?: string;
  };
  buttonReply?: {
    id: string;
    title: string;
  };
  mediaMimeType?: string;
  mediaFileId?: string;
  mediaHash?: string;
  mediaVoice?: boolean;
  locAddress?: string;
  locName?: string;
  locLatitude?: number;
  locLongitude?: number;
}

/**
 * Handler function types
 */
export type HandlerFunction = (
  update: Update,
  context?: UserContext
) => void | Promise<void>;
export type FilterFunction = (text: string) => boolean;

/**
 * Handler options
 */
export interface HandlerOptions {
  regex?: RegExp;
  filter?: FilterFunction;
  context?: boolean;
  persistent?: boolean;
}

/**
 * Interactive handler options
 */
export interface InteractiveHandlerOptions extends HandlerOptions {
  handleButton?: boolean;
  handleList?: boolean;
}

/**
 * Next step handler configuration
 */
export interface NextStepConfig {
  handler: UpdateHandler;
  fallbackHandler?: UpdateHandler;
}

/**
 * User context data storage
 */
export interface UserContextData {
  [key: string]: any;
}

/**
 * Reply markup types
 */
export type ReplyMarkupType = 'button' | 'list' | 'location_request_message';

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
}

/**
 * Send media options
 */
export interface SendMediaOptions {
  caption?: string;
  mediaProviderToken?: string;
}

/**
 * Update class - represents incoming message update
 */
export interface Update {
  bot: WhatsAppClient;
  value: WebhookValue;
  message: WhatsAppMessage;
  user: {
    profile: { name: string };
    wa_id: string;
  };
  userDisplayName: string;
  userPhoneNumber: string;
  messageId: string;
  messageText?: string;
  interactiveText?: any;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaFileId?: string;
  mediaHash?: string;
  mediaVoice?: boolean;
  locAddress?: string;
  locName?: string;
  locLatitude?: number;
  locLongitude?: number;

  replyMessage(
    text: string,
    options?: SendMessageOptions
  ): Promise<AxiosResponse>;

  replyMedia(
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<AxiosResponse>;
}

/**
 * User context for managing conversation state
 */
export interface UserContext {
  userData: UserContextData;
}

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

  processUpdate(update: WebhookPayload): Promise<void>;
  sendMessage(
    phoneNumber: string,
    text: string,
    options?: SendMessageOptions
  ): Promise<AxiosResponse>;
  sendTemplateMessage(
    phoneNumber: string,
    templateName: string,
    components?: TemplateComponent[],
    languageCode?: string
  ): Promise<AxiosResponse>;
  sendMediaMessage(
    phoneNumber: string,
    mediaPath: string,
    options?: SendMediaOptions
  ): Promise<AxiosResponse>;
  markAsRead(message: WhatsAppMessage): Promise<AxiosResponse>;
  getMediaUrl(mediaId: string): Promise<any>;
  downloadMedia(mediaId: string, filePath: string): Promise<string>;
}

/**
 * Dispatcher configuration
 */
export interface DispatcherConfig {
  markAsRead: boolean;
}
