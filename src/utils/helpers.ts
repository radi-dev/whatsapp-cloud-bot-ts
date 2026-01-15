/**
 * Utility functions for error handling and data validation
 */

/**
 * Check if nested keys exist in an object
 * @param element - The object to check
 * @param keys - Nested keys to check for existence
 * @returns true if all keys exist, false otherwise
 *
 * @example
 * const data = { spam: { egg: { bacon: "Well.." } } };
 * keysExist(data, "spam"); // true
 * keysExist(data, "spam", "egg"); // true
 * keysExist(data, "spam", "egg", "bacon"); // true
 * keysExist(data, "spam", "bacon"); // false
 */
export function keysExist(element: any, ...keys: (string | number)[]): boolean {
  if (typeof element !== 'object' || element === null) {
    return false;
  }

  if (keys.length === 0) {
    throw new Error('keysExist() expects at least one key argument');
  }

  let current = element;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null || !(key in current)) {
      return false;
    }
    current = current[key];
  }

  return true;
}

/**
 * Validate phone number format
 * @param phoneNumber - Phone number to validate
 * @returns true if valid
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  // Remove all non-digit characters
  const digits = phoneNumber.replace(/\D/g, '');
  // Should be at least 10 digits
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Format phone number to WhatsApp format (remove + and spaces)
 * @param phoneNumber - Phone number to format
 * @returns Formatted phone number
 */
export function formatPhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, '');
}

/**
 * Check if string starts with http:// or https:// or www.
 * @param str - String to check
 * @returns true if string is a link
 */
export function isLink(str: string): boolean {
  return /^((http[s]?:\/\/)|(www\.))/.test(str);
}

/**
 * Validate media MIME type
 * @param mimeType - MIME type to validate
 * @param allowedTypes - Array of allowed MIME type prefixes
 * @returns true if valid
 */
export function isValidMimeType(
  mimeType: string,
  allowedTypes: string[]
): boolean {
  return allowedTypes.some((type) => mimeType.startsWith(type));
}

/**
 * File extension to MIME type mapping
 */
export const KNOWN_MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mp3',
  '.mpeg': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Get MIME type from file extension
 * @param extension - File extension (with or without dot)
 * @returns MIME type or 'application/octet-stream' as fallback
 */
export function getMimeTypeFromExtension(extension: string): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return KNOWN_MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Get file extension from MIME type
 * @param mimeType - MIME type
 * @returns File extension or '.bin' as fallback
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const entry = Object.entries(KNOWN_MIME_TYPES).find(
    ([, mime]) => mime === mimeType
  );
  return entry ? entry[0] : '.bin';
}
