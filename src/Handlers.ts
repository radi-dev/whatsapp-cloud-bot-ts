/**
 * Handler Classes
 * Process different types of incoming messages
 */

import type {
  UpdateData,
  WhatsAppMessage,
  HandlerFunction,
  FilterFunction,
  HandlerOptions,
  InteractiveHandlerOptions,
  MessageType,
} from './types';
import type { Update } from './Update';
import type { UserContext } from './UserContext';

/**
 * Base Update Handler Class
 */
export abstract class UpdateHandler {
  public name: MessageType;
  public regex?: RegExp;
  public filter?: FilterFunction;
  public action: HandlerFunction;
  public context: boolean;
  public persistent: boolean;

  constructor(
    name: MessageType,
    action: HandlerFunction,
    options: HandlerOptions = {}
  ) {
    this.name = name;
    this.action = action;
    this.context = options.context !== false;
    this.persistent = options.persistent || false;

    if (options.regex) {
      this.regex =
        typeof options.regex === 'string'
          ? new RegExp(options.regex)
          : options.regex;
    }

    if (options.filter) {
      this.filter = options.filter;
    }
  }

  /**
   * Extract data from message
   */
  abstract extractData(message: WhatsAppMessage): UpdateData;

  /**
   * Check if message passes filter
   */
  filterCheck(text: string): boolean {
    if (this.regex) {
      return this.regex.test(text);
    }
    if (this.filter) {
      return this.filter(text);
    }
    return true;
  }

  /**
   * Run the handler action
   */
  async run(update: Update, context?: UserContext): Promise<void> {
    if (this.context && context) {
      await this.action(update, context);
    } else {
      await this.action(update);
    }
  }
}

/**
 * Message Handler
 * Handles text messages
 */
export class MessageHandler extends UpdateHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('text', action, options);
  }

  extractData(message: WhatsAppMessage): UpdateData {
    return {
      messageText: message.text?.body || '',
    };
  }
}

/**
 * Interactive Query Handler
 * Handles button and list replies
 */
export class InteractiveQueryHandler extends UpdateHandler {
  public handleButton: boolean;
  public handleList: boolean;

  constructor(
    action: HandlerFunction,
    options: InteractiveHandlerOptions = {}
  ) {
    super('interactive', action, options);
    this.handleButton = options.handleButton !== false;
    this.handleList = options.handleList !== false;
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const data: UpdateData = {
      messageText: '',
    };

    if (!message.interactive) {
      return data;
    }

    if (
      message.interactive.type === 'button_reply' &&
      this.handleButton &&
      message.interactive.button_reply
    ) {
      data.messageText = message.interactive.button_reply.id;
      data.buttonReply = message.interactive.button_reply;
    } else if (
      message.interactive.type === 'list_reply' &&
      this.handleList &&
      message.interactive.list_reply
    ) {
      data.messageText = message.interactive.list_reply.id;
      data.listReply = message.interactive.list_reply;
    }

    return data;
  }
}

/**
 * Base Media Handler
 */
export abstract class MediaHandler extends UpdateHandler {
  constructor(
    name: MessageType,
    action: HandlerFunction,
    options: HandlerOptions = {}
  ) {
    super(name, action, options);
  }
}

/**
 * Image Handler
 */
export class ImageHandler extends MediaHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('image', action, options);
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const imageData = message.image;
    return {
      messageText: imageData?.caption || '',
      mediaMimeType: imageData?.mime_type,
      mediaFileId: imageData?.id,
      mediaHash: imageData?.sha256,
    };
  }
}

/**
 * Audio Handler
 */
export class AudioHandler extends MediaHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('audio', action, options);
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const audioData = message.audio;
    return {
      messageText: '',
      mediaMimeType: audioData?.mime_type,
      mediaFileId: audioData?.id,
      mediaHash: audioData?.sha256,
      mediaVoice: audioData?.voice,
    };
  }
}

/**
 * Video Handler
 */
export class VideoHandler extends MediaHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('video', action, options);
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const videoData = message.video;
    return {
      messageText: videoData?.caption || '',
      mediaMimeType: videoData?.mime_type,
      mediaFileId: videoData?.id,
      mediaHash: videoData?.sha256,
    };
  }
}

/**
 * Document Handler
 */
export class DocumentHandler extends MediaHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('document', action, options);
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const docData = message.document;
    return {
      messageText: docData?.caption || '',
      mediaMimeType: docData?.mime_type,
      mediaFileId: docData?.id,
      mediaHash: docData?.sha256,
    };
  }
}

/**
 * Sticker Handler
 */
export class StickerHandler extends MediaHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('sticker', action, options);
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const stickerData = message.sticker;
    return {
      messageText: '',
      mediaMimeType: stickerData?.mime_type,
      mediaFileId: stickerData?.id,
      mediaHash: stickerData?.sha256,
    };
  }
}

/**
 * Location Handler
 */
export class LocationHandler extends UpdateHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('location', action, options);
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const locData = message.location;
    const locName = locData?.name || '';
    const locAddress = locData?.address || '';
    const latitude = locData?.latitude;
    const longitude = locData?.longitude;

    const messageText =
      locName || locAddress
        ? `${locName}\n${locAddress}`.trim()
        : `lat: ${latitude}, long: ${longitude}`;

    return {
      messageText,
      locAddress,
      locName,
      locLatitude: latitude,
      locLongitude: longitude,
    };
  }
}

/**
 * Unknown Message Handler
 */
export class UnknownHandler extends UpdateHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('unknown', action, options);
  }

  extractData(_message: WhatsAppMessage): UpdateData {
    return {
      messageText: '',
    };
  }
}

/**
 * Unsupported Message Handler
 */
export class UnsupportedHandler extends UpdateHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('unsupported', action, options);
  }

  extractData(_message: WhatsAppMessage): UpdateData {
    return {
      messageText: '',
    };
  }
}
