/**
 * Handler Classes
 * Process different types of incoming messages
 */

import { DEFAULT_IGNORE_AFTER_MINUTES } from './config.js';
import type {
  UpdateData,
  WhatsAppMessage,
  HandlerFunction,
  FilterFunction,
  HandlerOptions,
  InteractiveHandlerOptions,
  InteractiveReplyType,
  MessageType,
} from './types/index.js';
import type { Update } from './Update.js';
import type { UserContext } from './context/UserContext.js';

/**
 * Decide whether a handler uses the persistent user context.
 *
 * Explicit `options.context` wins; otherwise a handler is context-aware when
 * its function declares a second parameter (`(update, context) => …`).
 * Note that `Function.length` stops counting at the first parameter with a
 * default value or a rest parameter — set `{ context: true }` explicitly in
 * those cases.
 */
export function handlerUsesContext(
  action: HandlerFunction,
  options: HandlerOptions = {}
): boolean {
  if (typeof options.context === 'boolean') {
    return options.context;
  }
  return typeof action === 'function' && action.length >= 2;
}

/**
 * Base Update Handler Class
 */
export abstract class UpdateHandler {
  public name: MessageType;
  public regex?: RegExp;
  public filter?: FilterFunction;
  public action: HandlerFunction;
  /**
   * Whether this handler receives the persistent user context. Resolved by
   * {@link handlerUsesContext}; when `true` the client must have a
   * `contextStore`, which the dispatcher enforces at registration time.
   */
  public context: boolean;
  public persistent: boolean;
  public ignoreAfterMinutes?: number;
  /** For interactive handlers: which reply sub-types this handler accepts. */
  public interactiveTypes?: InteractiveReplyType[];

  constructor(
    name: MessageType,
    action: HandlerFunction,
    options: HandlerOptions = {}
  ) {
    this.name = name;
    this.action = action;
    this.context = handlerUsesContext(action, options);
    this.persistent = options.persistent || false;
    this.ignoreAfterMinutes =
      options.ignoreAfterMinutes || DEFAULT_IGNORE_AFTER_MINUTES;

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
   * Run the handler action. `context` is passed through only for
   * context-aware handlers (see {@link UpdateHandler.context}).
   */
  async run(update: Update, context?: UserContext): Promise<void> {
    if (this.context && context) {
      await this.action(update, context);
    } else {
      await (this.action as (update: Update) => void | Promise<void>)(update);
    }
  }
}

/**
 * Text Handler
 * Handles plain text messages.
 */
export class TextHandler extends UpdateHandler {
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
 * @deprecated Use {@link TextHandler}.
 */
export class MessageHandler extends TextHandler {}

/**
 * Button Handler
 * Handles button and list replies
 */
export class ButtonHandler extends UpdateHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('button', action, options);
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const data: UpdateData = {
      messageText: '',
    };

    if (!message.button) {
      return data;
    }
    data.messageText = message.button.payload;
    data.button = message.button;

    return data;
  }
}

/**
 * Parse a Flow completion reply (`interactive.nfm_reply`) into UpdateData.
 */
function extractFlowReply(message: WhatsAppMessage): UpdateData {
  const data: UpdateData = { messageText: '' };
  const nfm = message.interactive?.nfm_reply;
  if (!nfm) {
    return data;
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(nfm.response_json);
  } catch {
    // Leave parsed empty if the response isn't valid JSON.
  }

  data.messageText = nfm.body || '';
  data.flowReply = {
    name: nfm.name,
    body: nfm.body,
    responseJson: nfm.response_json,
    data: parsed,
    flowToken:
      typeof parsed.flow_token === 'string' ? parsed.flow_token : undefined,
  };
  return data;
}

/**
 * Interactive Query Handler
 * Handles button **and** list replies. Prefer the dedicated
 * {@link ButtonReplyHandler} / {@link ListReplyHandler} / {@link FlowReplyHandler}
 * when you only care about one reply sub-type.
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
    this.interactiveTypes = [
      ...(this.handleButton ? (['button_reply'] as const) : []),
      ...(this.handleList ? (['list_reply'] as const) : []),
    ];
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
 * Button Reply Handler — handles only interactive **button** replies
 * (`interactive.type === 'button_reply'`).
 */
export class ButtonReplyHandler extends UpdateHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('interactive', action, options);
    this.interactiveTypes = ['button_reply'];
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const data: UpdateData = { messageText: '' };
    const reply = message.interactive?.button_reply;
    if (reply) {
      data.messageText = reply.id;
      data.buttonReply = reply;
    }
    return data;
  }
}

/**
 * List Reply Handler — handles only interactive **list** replies
 * (`interactive.type === 'list_reply'`).
 */
export class ListReplyHandler extends UpdateHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('interactive', action, options);
    this.interactiveTypes = ['list_reply'];
  }

  extractData(message: WhatsAppMessage): UpdateData {
    const data: UpdateData = { messageText: '' };
    const reply = message.interactive?.list_reply;
    if (reply) {
      data.messageText = reply.id;
      data.listReply = reply;
    }
    return data;
  }
}

/**
 * Flow Reply Handler — handles Flow completion replies
 * (`interactive.type === 'nfm_reply'`). The parsed Flow response is available
 * on `update.flowReply`.
 */
export class FlowReplyHandler extends UpdateHandler {
  constructor(action: HandlerFunction, options: HandlerOptions = {}) {
    super('interactive', action, options);
    this.interactiveTypes = ['nfm_reply'];
  }

  extractData(message: WhatsAppMessage): UpdateData {
    return extractFlowReply(message);
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
      mediaUrl: imageData?.url,
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
      mediaUrl: audioData?.url,
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
      mediaUrl: videoData?.url,
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
      mediaUrl: docData?.url,
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
      mediaUrl: stickerData?.url,
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
