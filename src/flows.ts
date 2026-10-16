/**
 * WhatsApp Flows — Endpoint helpers
 *
 * Utilities for implementing a Flow **data-exchange endpoint**: decrypting the
 * incoming (RSA + AES-GCM) request, encrypting the response, and validating the
 * webhook signature.
 *
 * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint
 */

import crypto from 'crypto';

/**
 * The encrypted request body WhatsApp POSTs to your Flow endpoint.
 */
export interface EncryptedFlowRequest {
  /** Base64 AES-GCM ciphertext (payload + 16-byte auth tag appended). */
  encrypted_flow_data: string;
  /** Base64 RSA-OAEP(SHA-256) encrypted AES key. */
  encrypted_aes_key: string;
  /** Base64 AES-GCM initialization vector. */
  initial_vector: string;
}

/**
 * The decrypted data-exchange body sent by WhatsApp. `action` is `INIT` on
 * open, `data_exchange` on submit, `BACK` on back-navigation, and `ping` for
 * health checks.
 */
export interface FlowDataExchangeBody<TData = Record<string, unknown>> {
  version: string;
  // eslint-disable-next-line @typescript-eslint/ban-types -- `string & {}` keeps literal autocomplete while allowing any string
  action: 'INIT' | 'BACK' | 'data_exchange' | 'ping' | (string & {});
  screen?: string;
  data?: TData;
  flow_token?: string;
}

/**
 * Result of {@link decryptFlowRequest} — the decrypted body plus the key and IV
 * needed to encrypt the matching response.
 */
export interface DecryptedFlowRequest<TBody = FlowDataExchangeBody> {
  decryptedBody: TBody;
  aesKeyBuffer: Buffer;
  initialVectorBuffer: Buffer;
}

/**
 * Error carrying an HTTP status code to return from the Flow endpoint. WhatsApp
 * treats `421` as "refresh the public key and retry".
 */
export class FlowEndpointException extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'FlowEndpointException';
    this.statusCode = statusCode;
  }
}

function gcmAlgorithm(keyLength: number): 'aes-128-gcm' | 'aes-256-gcm' {
  if (keyLength === 16) return 'aes-128-gcm';
  if (keyLength === 32) return 'aes-256-gcm';
  throw new FlowEndpointException(
    500,
    `Unexpected AES key length: ${keyLength} bytes (expected 16 or 32)`
  );
}

const AUTH_TAG_LENGTH = 16;

/**
 * Decrypt an incoming Flow endpoint request.
 *
 * 1. RSA-OAEP(SHA-256) decrypt `encrypted_aes_key` with your private key.
 * 2. AES-GCM decrypt `encrypted_flow_data` (last 16 bytes are the auth tag).
 *
 * @param body - The raw `{ encrypted_flow_data, encrypted_aes_key, initial_vector }`
 * @param privatePem - Your RSA private key in PEM format
 * @param passphrase - Passphrase for the private key, if it is encrypted
 * @throws {FlowEndpointException} 421 if the AES key cannot be decrypted
 *         (signals WhatsApp to refresh the public key)
 *
 * @example
 * ```typescript
 * const { decryptedBody, aesKeyBuffer, initialVectorBuffer } =
 *   decryptFlowRequest(req.body, process.env.FLOW_PRIVATE_KEY!);
 * ```
 */
export function decryptFlowRequest<TBody = FlowDataExchangeBody>(
  body: EncryptedFlowRequest,
  privatePem: string,
  passphrase: string = ''
): DecryptedFlowRequest<TBody> {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  let aesKeyBuffer: Buffer;
  try {
    aesKeyBuffer = crypto.privateDecrypt(
      {
        key: crypto.createPrivateKey({ key: privatePem, passphrase }),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(encrypted_aes_key, 'base64')
    );
  } catch {
    // Returning 421 tells WhatsApp to re-fetch your public key and retry.
    throw new FlowEndpointException(
      421,
      'Failed to decrypt the request. Verify your private key matches the uploaded public key.'
    );
  }

  const initialVectorBuffer = Buffer.from(initial_vector, 'base64');
  const flowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');
  const ciphertext = flowDataBuffer.subarray(0, -AUTH_TAG_LENGTH);
  const authTag = flowDataBuffer.subarray(-AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(
    gcmAlgorithm(aesKeyBuffer.length),
    aesKeyBuffer,
    initialVectorBuffer
  );
  decipher.setAuthTag(authTag);

  const decryptedJSON = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf-8');

  return {
    decryptedBody: JSON.parse(decryptedJSON) as TBody,
    aesKeyBuffer,
    initialVectorBuffer,
  };
}

/**
 * Encrypt a Flow endpoint response. Uses the same AES key as the request, with
 * the initialization vector **bit-flipped** (as required by WhatsApp), and
 * returns base64 `ciphertext || authTag`.
 *
 * @param response - The plain JSON response object (e.g. `{ screen, data }`)
 * @param aesKeyBuffer - The AES key from {@link decryptFlowRequest}
 * @param initialVectorBuffer - The IV from {@link decryptFlowRequest}
 * @returns Base64 string to send back as the raw HTTP 200 response body
 *
 * @example
 * ```typescript
 * res.type('text/plain').send(
 *   encryptFlowResponse({ screen: 'SUCCESS', data: {} }, aesKeyBuffer, initialVectorBuffer)
 * );
 * ```
 */
export function encryptFlowResponse(
  response: unknown,
  aesKeyBuffer: Buffer,
  initialVectorBuffer: Buffer
): string {
  // Flip every bit of the IV.
  const flippedIv = Buffer.from(initialVectorBuffer.map((byte) => ~byte));

  const cipher = crypto.createCipheriv(
    gcmAlgorithm(aesKeyBuffer.length),
    aesKeyBuffer,
    flippedIv
  );

  return Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf-8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}

/**
 * Validate the `x-hub-signature-256` header against the raw request body using
 * your Meta App Secret (HMAC-SHA256), in constant time.
 *
 * @param rawBody - The **raw** request body bytes/string (not the parsed JSON)
 * @param signatureHeader - The `x-hub-signature-256` header value
 * @param appSecret - Your Meta App Secret
 * @returns true if the signature is valid
 *
 * @example
 * ```typescript
 * if (!isFlowSignatureValid(req.rawBody, req.get('x-hub-signature-256'), APP_SECRET)) {
 *   return res.sendStatus(432); // signature mismatch
 * }
 * ```
 */
export function isFlowSignatureValid(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!appSecret || !signatureHeader) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const provided = signatureHeader.replace(/^sha256=/, '');

  const expectedBuffer = Buffer.from(expected, 'utf-8');
  const providedBuffer = Buffer.from(provided, 'utf-8');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
