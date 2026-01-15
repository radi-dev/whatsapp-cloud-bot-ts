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
} from './types';

/**
 * Update class - encapsulates an incoming WhatsApp message
 */
export class Update {
  public bot: any; // WhatsAppClient - using any to avoid circular dependency
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
  public mediaUrl?: string;
  public mediaMimeType?: string;
  public mediaFileId?: string;
  public mediaHash?: string;
  public mediaVoice?: boolean;
  public locAddress?: string;
  public locName?: string;
  public locLatitude?: number;
  public locLongitude?: number;

  constructor(bot: any, value: WebhookValue) {
    this.bot = bot;
    this.value = value;
    this.message = value.messages?.[0] || ({} as WhatsAppMessage);
    this.user = value.contacts?.[0] || { profile: { name: '' }, wa_id: '' };
    this.userDisplayName = this.user.profile?.name || '';
    this.userPhoneNumber = this.user.wa_id || '';
    this.messageId = this.message.id || '';
  }

  /**
   * Reply to the current message
   */
  async replyMessage(
    text: string,
    options: SendMessageOptions = {}
  ): Promise<AxiosResponse> {
    return this.bot.sendMessage(this.userPhoneNumber, text, {
      ...options,
      msgId: options.msgId || this.messageId,
    });
  }

  /**
   * Reply with media
   */
  async replyMedia(
    mediaPath: string,
    options: SendMediaOptions = {}
  ): Promise<AxiosResponse> {
    return this.bot.sendMediaMessage(this.userPhoneNumber, mediaPath, options);
  }

  /**
   * Reply with template message
   */
  async replyTemplate(
    templateName: string,
    components?: any[],
    languageCode?: string
  ): Promise<AxiosResponse> {
    return this.bot.sendTemplateMessage(
      this.userPhoneNumber,
      templateName,
      components,
      languageCode
    );
  }
}
