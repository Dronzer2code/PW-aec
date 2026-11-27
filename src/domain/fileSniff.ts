import type { AllowedMimeType } from './schema.js';

/**
 * Magic-byte sniffing: confirms an uploaded file really is the type it claims,
 * so a script or executable cannot be smuggled in with a fake MIME type.
 */
const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

const startsWith = (bytes: Uint8Array, sig: readonly number[]): boolean => sig.every((b, i) => bytes[i] === b);

const SNIFFERS: Readonly<Record<AllowedMimeType, (b: Uint8Array) => boolean>> = {
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  'application/pdf': (b) => ascii(b, 0, 5) === '%PDF-',
  'audio/webm': (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
  'audio/ogg': (b) => ascii(b, 0, 4) === 'OggS',
  'audio/wav': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE',
  'audio/mp4': (b) => ascii(b, 4, 8) === 'ftyp',
  'audio/mpeg': (b) => ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
};

/** True when the first bytes of the base64 payload match the declared MIME type. */
export function matchesMagicBytes(mimeType: AllowedMimeType, base64: string): boolean {
  const head = Buffer.from(base64.slice(0, 24), 'base64');
  return SNIFFERS[mimeType](new Uint8Array(head));
}
