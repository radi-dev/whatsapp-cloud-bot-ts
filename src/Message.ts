/**
 * WhatsApp Message API Functions
 * Handles sending different types of messages to WhatsApp Business API
 */

import fs from 'fs';
import mime from 'mime-types';

import type { AxiosResponse } from 'axios';
import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type {
  ReplyMarkup,
  CtaUrlAction,
  QuickReplyAction,
  CarouselCard,
  FlowParameters,
} from './types/index.js';
import type { InlineButton, ListItem, ListSection } from './Markup.js';
import { InlineKeyboard, InlineList, InlineFlow } from './Markup.js';
import { isLink, getExtensionFromMimeType } from './utils/helpers.js';
import { DEBUG } from './config.js';

/** Options shared by the interactive convenience senders. */
export interface InteractiveSendOptions {
  msgId?: string;
  header?: string;
  headerType?: 'text' | 'image' | 'video' | 'document';
  footer?: string;
  bizOpaqueCallbackData?: string;
}

const TIMEOUT = 30000; // 30 seconds

/**
 * Create headers for WhatsApp API requests
 */
function getHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Mark message as read
 */
export async function markAsRead(
  url: string,
  token: string,
  messageId: string,
  alwaysShowTyping: boolean
): Promise<AxiosResponse> {
  const payload: any = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  };

  if (alwaysShowTyping) {
    payload['typing_indicator'] = {
      type: 'text',
    };
  }

  return axios.post(url, payload, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });
}

/**
 * Send typing indicator
 */
export async function sendTypingIndicator(
  url: string,
  token: string,
  messageId: string,
  markAsRead: boolean
): Promise<AxiosResponse> {
  const payload: any = {
    messaging_product: 'whatsapp',
    message_id: messageId,
  };

  if (markAsRead) {
    payload['typing_indicator'] = {
      type: 'text',
    };
  }

  return axios.post(url, payload, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });
}

/**
 * Send text message
 */
export async function sendTextMessage(
  url: string,
  token: string,
  phoneNumber: string,
  text: string,
  options: {
    msgId?: string;
    webPagePreview?: boolean;
    tagMessage?: boolean;
    bizOpaqueCallbackData?: string;
  } = {}
): Promise<AxiosResponse> {
  const {
    msgId,
    webPagePreview = true,
    tagMessage = true,
    bizOpaqueCallbackData,
  } = options;

  const messageFrame: any = {
    messaging_product: 'whatsapp',
    to: phoneNumber,
    recipient_type: 'individual',
    type: 'text',
    text: {
      body: text,
      preview_url: webPagePreview,
    },
  };

  if (msgId && tagMessage) {
    messageFrame.context = { message_id: msgId };
  }

  if (bizOpaqueCallbackData) {
    messageFrame.biz_opaque_callback_data = bizOpaqueCallbackData;
  }

  return axios.post(url, messageFrame, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });
}

/**
 * Send interactive message (with buttons, lists, carousel, or Flow). Use the convenience wrappers
 * {@link sendButtonMessage}, {@link sendListMessage}, {@link sendFlowMessage},
 * {@link sendCarouselUrlMessage}, or {@link sendCarouselButtonMessage} instead
 * of calling this directly.
 */
export async function sendInteractiveMessage(
  url: string,
  token: string,
  phoneNumber: string,
  text: string,
  replyMarkup: ReplyMarkup,
  options: {
    msgId?: string;
    header?: string;
    headerType?: 'text' | 'image' | 'video' | 'document';
    footer?: string;
    bizOpaqueCallbackData?: string;
  } = {}
): Promise<AxiosResponse> {
  const {
    msgId,
    header,
    headerType = 'text',
    footer,
    bizOpaqueCallbackData,
  } = options;

  const messageFrame: any = {
    messaging_product: 'whatsapp',
    to: phoneNumber,
    recipient_type: 'individual',
    type: 'interactive',
    interactive: {
      type: replyMarkup.type,
      body: { text },
      action: replyMarkup.markup,
    },
  };

  if (msgId) {
    messageFrame.context = { message_id: msgId };
  }

  if (header) {
    if (headerType === 'text') {
      messageFrame.interactive.header = {
        type: 'text',
        text: header,
      };
    } else if (['image', 'video', 'document'].includes(headerType)) {
      const headerObject = isLink(header) ? { link: header } : { id: header };

      messageFrame.interactive.header = {
        type: headerType,
        [headerType]: headerObject,
      };
    }
  }

  if (footer) {
    messageFrame.interactive.footer = { text: footer };
  }

  if (bizOpaqueCallbackData) {
    messageFrame.biz_opaque_callback_data = bizOpaqueCallbackData;
  }

  if (DEBUG) {
    console.log(
      'Sending interactive message:',
      JSON.stringify(messageFrame, null, 2)
    );
  }

  return axios.post(url, messageFrame, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });
}

/**
 * Send an interactive **button** message (1–3 quick-reply buttons).
 * Convenience wrapper that builds the markup and calls
 * {@link sendInteractiveMessage} under the hood.
 */
export async function sendButtonMessage(
  url: string,
  token: string,
  phoneNumber: string,
  text: string,
  buttons: (string | InlineButton)[],
  options: InteractiveSendOptions = {}
): Promise<AxiosResponse> {
  const markup = new InlineKeyboard(buttons);
  return sendInteractiveMessage(url, token, phoneNumber, text, markup, options);
}

/**
 * Send an interactive **list** message.
 * Convenience wrapper that builds the markup and calls
 * {@link sendInteractiveMessage} under the hood.
 */
export async function sendListMessage(
  url: string,
  token: string,
  phoneNumber: string,
  text: string,
  buttonText: string,
  items: (ListItem | ListSection)[],
  options: InteractiveSendOptions = {}
): Promise<AxiosResponse> {
  const markup = new InlineList(buttonText, items);
  return sendInteractiveMessage(url, token, phoneNumber, text, markup, options);
}

/**
 * Send an interactive **Flow** message.
 * Convenience wrapper that builds the Flow markup (applying defaults) and calls
 * {@link sendInteractiveMessage} under the hood.
 */
export async function sendFlowMessage(
  url: string,
  token: string,
  phoneNumber: string,
  text: string,
  flow: FlowParameters,
  options: InteractiveSendOptions = {}
): Promise<AxiosResponse> {
  const markup = new InlineFlow(flow);
  return sendInteractiveMessage(url, token, phoneNumber, text, markup, options);
}

/**
 * Send interactive media carousel message
 */
export async function sendCarouselUrlMessage(
  url: string,
  token: string,
  phoneNumber: string,
  text: string,
  cards: CarouselCard<CtaUrlAction>[],
  bizOpaqueCallbackData?: string
): Promise<AxiosResponse> {
  if (!cards || cards.length < 2 || cards.length > 10) {
    throw new Error('Carousel must have between 2 and 10 cards.');
  }

  cards.forEach((card, index) => {
    card.action.name = 'cta_url';
    card.type = 'cta_url';
    if ('video' in card.header) {
      card.header.type = 'video';
    } else {
      card.header.type = 'image';
    }
    card.card_index = index;
  });

  return await sendInteractiveMessage(
    url,
    token,
    phoneNumber,
    text,
    {
      type: 'carousel',
      markup: { cards },
    },
    { bizOpaqueCallbackData }
  );
}

export async function sendCarouselButtonMessage(
  url: string,
  token: string,
  phoneNumber: string,
  text: string,
  cards: CarouselCard<QuickReplyAction>[],
  bizOpaqueCallbackData?: string
): Promise<AxiosResponse> {
  if (!cards || cards.length < 2 || cards.length > 10) {
    throw new Error('Carousel must have between 2 and 10 cards.');
  }

  cards.forEach((card, index) => {
    card.type = 'cta_url';
    card.action.buttons.forEach((btn) => {
      btn.type = 'quick_reply';
    });
    if ('video' in card.header) {
      card.header.type = 'video';
    } else {
      card.header.type = 'image';
    }
    card.card_index = index;
  });

  return await sendInteractiveMessage(
    url,
    token,
    phoneNumber,
    text,
    {
      type: 'carousel',
      markup: { cards },
    },
    { bizOpaqueCallbackData }
  );
}

/**
 * Send template message
 */
export async function sendTemplateMessage(
  url: string,
  token: string,
  phoneNumber: string,
  templateName: string,
  components: any[] = [],
  languageCode: string = 'en_US',
  bizOpaqueCallbackData?: string
): Promise<AxiosResponse> {
  const payload: any = {
    messaging_product: 'whatsapp',
    to: phoneNumber,
    recipient_type: 'individual',
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: components,
    },
  };

  if (bizOpaqueCallbackData) {
    payload.biz_opaque_callback_data = bizOpaqueCallbackData;
  }

  return axios.post(url, payload, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });
}

/**
 * Send media message (image, video, audio, document, sticker)
 */
export async function sendMediaMessage(
  url: string,
  token: string,
  phoneNumber: string,
  mediaPath: string,
  mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker' = 'image',
  caption?: string,
  bizOpaqueCallbackData?: string
): Promise<AxiosResponse> {
  const payload: any = {
    messaging_product: 'whatsapp',
    to: phoneNumber,
    recipient_type: 'individual',
    type: mediaType,
    [mediaType]: isLink(mediaPath)
      ? { link: mediaPath, caption }
      : { id: mediaPath, caption },
  };

  if (bizOpaqueCallbackData) {
    payload.biz_opaque_callback_data = bizOpaqueCallbackData;
  }

  return axios.post(url, payload, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });
}

/**
 * Send location message
 */
export async function sendLocationMessage(
  url: string,
  token: string,
  phoneNumber: string,
  latitude: number,
  longitude: number,
  name?: string,
  address?: string,
  bizOpaqueCallbackData?: string
): Promise<AxiosResponse> {
  const locationData: any = {
    latitude: latitude.toString(),
    longitude: longitude.toString(),
  };

  if (name) locationData.name = name;
  if (address) locationData.address = address;

  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber,
    type: 'location',
    location: locationData,
  };

  if (bizOpaqueCallbackData) {
    payload.biz_opaque_callback_data = bizOpaqueCallbackData;
  }

  return axios.post(url, payload, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });
}

/**
 * Upload media file
 */
export async function uploadMedia(
  url: string,
  token: string,
  filePath: string,
  mimeType: string
): Promise<AxiosResponse> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', createReadStream(filePath));
  form.append('type', mimeType);

  return axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${token}`,
    },
    timeout: TIMEOUT,
  });
}

/**
 * Get media URL from media ID
 */
export async function getMediaUrl(
  baseUrl: string,
  mediaId: string,
  token: string
): Promise<any> {
  const url = `${baseUrl}/${mediaId}`;
  const response = await axios.get(url, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });

  return response.data;
}

/**
 * Download media file
 */
export async function downloadMedia(
  baseUrl: string,
  mediaId: string,
  token: string,
  filePath: string = '/media'
): Promise<string> {
  if (!mediaId) {
    throw new Error('Media ID is required');
  }

  // Get media URL and metadata
  const mediaData = await getMediaUrl(baseUrl, mediaId, token);
  const mediaUrl = mediaData.url;
  const mimeType = mediaData.mime_type;

  // Determine file extension
  const extension = getExtensionFromMimeType(mimeType);

  // Construct full file path
  const fullPath = join(
    process.cwd(),
    'tmp',
    filePath,
    `${mediaId}${extension}`
  );

  // Ensure directory exists
  await mkdir(dirname(fullPath), { recursive: true });

  // Download the file
  const response = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
    timeout: TIMEOUT,
  });

  // Write file to disk
  await writeFile(fullPath, response.data);

  return fullPath;
}

/**
 * Download media data (returns buffer instead of saving to file)
 */
export async function downloadMediaData(
  baseUrl: string,
  mediaId: string,
  token: string
): Promise<Buffer> {
  if (!mediaId) {
    throw new Error('Media ID is required');
  }

  // Get media URL
  const mediaData = await getMediaUrl(baseUrl, mediaId, token);
  const mediaUrl = mediaData.url;

  // Download the file
  const response = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
    timeout: TIMEOUT,
  });

  return Buffer.from(response.data);
}

export interface MediaToDataUrlOptions {
  /**
   * Override detected MIME type
   * e.g. "image/jpeg"
   */
  mimeTypeOverride?: string;

  /**
   * Max file size in bytes
   * Prevents accidentally base64-ing huge files
   * Default: 20MB
   */
  maxSizeBytes?: number;

  /**
   * If true, returns raw base64 instead of data URL
   * Default: false
   */
  rawBase64?: boolean;
}

export function mediaPathToData(
  mediaPath: string,
  options: MediaToDataUrlOptions = {}
): {
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
} {
  const {
    mimeTypeOverride,
    maxSizeBytes = 20 * 1024 * 1024, // 20MB
    rawBase64 = false,
  } = options;

  if (!fs.existsSync(mediaPath)) {
    throw new Error(`Media file not found: ${mediaPath}`);
  }

  const stats = fs.statSync(mediaPath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${mediaPath}`);
  }

  if (stats.size > maxSizeBytes) {
    throw new Error(
      `File too large (${stats.size} bytes). Max allowed is ${maxSizeBytes} bytes`
    );
  }

  // Detect MIME type
  const detectedMime =
    mimeTypeOverride || mime.lookup(mediaPath) || 'application/octet-stream';

  // Read file
  const buffer = fs.readFileSync(mediaPath);
  const base64 = buffer.toString('base64');

  const dataUrl = rawBase64 ? base64 : `data:${detectedMime};base64,${base64}`;

  return {
    dataUrl,
    mimeType: detectedMime,
    sizeBytes: stats.size,
  };
}
