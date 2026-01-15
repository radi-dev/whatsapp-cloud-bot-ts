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
} from './types';
import { Dispatcher } from './Dispatcher';
import type { Update } from './Update';
import type { UpdateHandler } from './Handlers';
import {
  MessageHandler,
  InteractiveQueryHandler,
  ImageHandler,
  AudioHandler,
  VideoHandler,
  DocumentHandler,
  StickerHandler,
  LocationHandler,
} from './Handlers';
import {
  markAsRead as markMessageAsRead,
  sendTextMessage,
  sendInteractiveMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendLocationMessage,
  getMediaUrl,
  downloadMedia,
  downloadMediaData,
} from './Message';
import { formatPhoneNumber } from './utils/helpers';

/**
 * WhatsApp Client Configuration
 */
export interface WhatsAppConfig {
  numberId: string;
  token: string;
  markAsRead?: boolean;
  version?: number;
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
 * client.onMessage(async (update, context) => {
 *   await update.replyMessage('Hello!');
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

    this.dispatcher = new Dispatcher(this, config.markAsRead !== false);
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
  async markAsRead(message: WhatsAppMessage): Promise<AxiosResponse> {
    return markMessageAsRead(this.msgUrl, this.token, message.id);
  }

  /**
   * Send text message
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
        }
      );
    }

    return sendTextMessage(this.msgUrl, this.token, formattedPhone, text, {
      msgId: options.msgId,
      webPagePreview: options.webPagePreview,
      tagMessage: options.tagMessage,
    });
  }

  /**
   * Send template message
   */
  async sendTemplateMessage(
    phoneNumber: string,
    templateName: string,
    components: TemplateComponent[] = [],
    languageCode: string = 'en_US'
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);

    return sendTemplateMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      templateName,
      components,
      languageCode
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

    return sendMediaMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      mediaPath,
      'image',
      options.caption
    );
  }

  /**
   * Send image message
   */
  async sendImage(
    phoneNumber: string,
    imagePath: string,
    caption?: string
  ): Promise<AxiosResponse> {
    return this.sendMediaMessage(phoneNumber, imagePath, { caption });
  }

  /**
   * Send video message
   */
  async sendVideo(
    phoneNumber: string,
    videoPath: string,
    caption?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    return sendMediaMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      videoPath,
      'video',
      caption
    );
  }

  /**
   * Send audio message
   */
  async sendAudio(
    phoneNumber: string,
    audioPath: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    return sendMediaMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      audioPath,
      'audio'
    );
  }

  /**
   * Send document message
   */
  async sendDocument(
    phoneNumber: string,
    documentPath: string,
    caption?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    return sendMediaMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      documentPath,
      'document',
      caption
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
    address?: string
  ): Promise<AxiosResponse> {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    return sendLocationMessage(
      this.msgUrl,
      this.token,
      formattedPhone,
      latitude,
      longitude,
      name,
      address
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
   * Register text message handler
   */
  onMessage(action: HandlerFunction, options: HandlerOptions = {}): void {
    const handler = new MessageHandler(action, options);
    this.dispatcher.registerHandler(handler);
  }

  /**
   * Register interactive message handler (buttons and lists)
   */
  onInteractiveMessage(
    action: HandlerFunction,
    options: InteractiveHandlerOptions = {}
  ): void {
    const handler = new InteractiveQueryHandler(action, options);
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
   * Set next step handler for user
   */
  setNextStep(
    update: Update,
    handler: UpdateHandler,
    fallbackFunction?: () => void | Promise<void>,
    fallbackRegex?: string | RegExp
  ): void {
    this.dispatcher.setNextStep(
      update,
      handler,
      fallbackFunction,
      fallbackRegex
    );
  }

  /**
   * Clear next step handler for user
   */
  clearNextStep(phoneNumber: string): void {
    this.dispatcher.clearNextStep(phoneNumber);
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { size: number; isProcessing: boolean } {
    return this.dispatcher.getQueueStatus();
  }
}
