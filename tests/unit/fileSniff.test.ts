import { describe, expect, it } from 'vitest';
import { matchesMagicBytes } from '../../src/domain/fileSniff.js';
import { ALLOWED_MIME_TYPES, type AllowedMimeType } from '../../src/domain/schema.js';
import { MAGIC_B64, MISMATCHED_B64 } from '../helpers/fixtures.js';

/** Every other allowed type (includes WAV vs WebP, which share the RIFF prefix). */
const otherTypes = (mime: AllowedMimeType): AllowedMimeType[] => ALLOWED_MIME_TYPES.filter((m) => m !== mime);

describe('matchesMagicBytes', () => {
  it.each(ALLOWED_MIME_TYPES)('accepts a genuine %s payload', (mime) => {
    expect(matchesMagicBytes(mime, MAGIC_B64[mime])).toBe(true);
  });

  it.each(ALLOWED_MIME_TYPES)('rejects a script disguised as %s', (mime) => {
    expect(matchesMagicBytes(mime, MISMATCHED_B64)).toBe(false);
  });

  it.each(ALLOWED_MIME_TYPES)('rejects payloads of every other type declared as %s', (mime) => {
    for (const other of otherTypes(mime)) {
      expect(matchesMagicBytes(mime, MAGIC_B64[other]), `${other} declared as ${mime}`).toBe(false);
    }
  });

  it('accepts an MPEG audio frame sync header without an ID3 tag', () => {
    const frame = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]).toString('base64');
    expect(matchesMagicBytes('audio/mpeg', frame)).toBe(true);
    const notFrame = Buffer.from([0xff, 0x1b, 0x90, 0x64, 0, 0, 0, 0]).toString('base64');
    expect(matchesMagicBytes('audio/mpeg', notFrame)).toBe(false);
  });

  it('rejects truncated payloads shorter than the signature', () => {
    expect(matchesMagicBytes('image/png', Buffer.from([0x89, 0x50]).toString('base64'))).toBe(false);
    expect(matchesMagicBytes('audio/mpeg', Buffer.from([0xff]).toString('base64'))).toBe(false);
  });

  it('only decodes the head of large payloads', () => {
    const big = MAGIC_B64['application/pdf'] + 'A'.repeat(1_000_000);
    expect(matchesMagicBytes('application/pdf', big)).toBe(true);
  });
});
