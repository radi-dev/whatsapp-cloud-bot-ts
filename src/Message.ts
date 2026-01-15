/**
 * WhatsApp Message API Functions
 * Handles sending different types of messages to WhatsApp Business API
 */

import type { AxiosResponse } from 'axios';
import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { ReplyMarkup } from './types';
import { isLink, getExtensionFromMimeType } from './utils/helpers';

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
  messageId: string
): Promise<AxiosResponse> {
  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  };

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
  } = {}
): Promise<AxiosResponse> {
  const { msgId, webPagePreview = true, tagMessage = true } = options;

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

  return axios.post(url, messageFrame, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });
}

/**
 * Send interactive message (with buttons or lists)
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
  } = {}
): Promise<AxiosResponse> {
  const { msgId, header, headerType = 'text', footer } = options;

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

  return axios.post(url, messageFrame, {
    headers: getHeaders(token),
    timeout: TIMEOUT,
  });
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
  languageCode: string = 'en_US'
): Promise<AxiosResponse> {
  const payload = {
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
  caption?: string
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
  address?: string
): Promise<AxiosResponse> {
  const locationData: any = {
    latitude: latitude.toString(),
    longitude: longitude.toString(),
  };

  if (name) locationData.name = name;
  if (address) locationData.address = address;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber,
    type: 'location',
    location: locationData,
  };

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
