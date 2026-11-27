// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LIMITS,
  downscaleImage,
  fileToBase64,
  formatBytes,
  normalizeMimeType,
  safeFileName,
  scaledSize,
  shouldDownscale,
  validateFiles,
} from '../../public/js/files.js';
import { SAMPLES } from '../../public/js/samples.js';
import { describeMicError, pickMimeType } from '../../public/js/recorder.js';

const MB = 1024 * 1024;

function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('formatBytes', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * MB)).toBe('5 MB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('normalizeMimeType', () => {
  it('accepts allowed types, strips codecs and maps aliases', () => {
    expect(normalizeMimeType('image/png')).toBe('image/png');
    expect(normalizeMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeMimeType('audio/x-wav')).toBe('audio/wav');
    expect(normalizeMimeType('IMAGE/JPG')).toBe('image/jpeg');
  });

  it('rejects unsupported or empty types', () => {
    expect(normalizeMimeType('text/html')).toBeNull();
    expect(normalizeMimeType('image/svg+xml')).toBeNull();
    expect(normalizeMimeType('')).toBeNull();
    expect(normalizeMimeType(undefined)).toBeNull();
    expect(normalizeMimeType('toString')).toBeNull();
  });
});

describe('validateFiles', () => {
  it('accepts valid files with their canonical MIME type', () => {
    const { accepted, errors } = validateFiles([fakeFile('scan.pdf', 'application/pdf', 2 * MB)]);
    expect(errors).toEqual([]);
    expect(accepted[0]?.mimeType).toBe('application/pdf');
  });

  it('rejects wrong type, oversize and empty files', () => {
    const { accepted, errors } = validateFiles([
      fakeFile('page.html', 'text/html', 10),
      fakeFile('huge.png', 'image/png', 6 * MB),
      fakeFile('empty.jpg', 'image/jpeg', 0),
    ]);
    expect(accepted).toHaveLength(0);
    expect(errors[0]).toContain('unsupported type');
    expect(errors[1]).toContain('over the 5 MB limit');
    expect(errors[2]).toContain('empty');
  });

  it('enforces the file count across existing attachments', () => {
    const files = [1, 2, 3].map((n) => fakeFile(`p${n}.jpg`, 'image/jpeg', 100));
    const { accepted, errors } = validateFiles(files, DEFAULT_LIMITS.maxFiles - 1);
    expect(accepted).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('up to 4 files');
  });

  it('honours limits supplied by the server config', () => {
    const { accepted, errors } = validateFiles([fakeFile('a.png', 'image/png', 2000)], 0, { maxFiles: 1, maxFileBytes: 1000 });
    expect(accepted).toHaveLength(0);
    expect(errors[0]).toContain('limit');
  });
});

describe('file encoding and downscaling helpers', () => {
  it('encodes a blob as base64 without the data URL prefix', async () => {
    await expect(fileToBase64(new Blob(['hello'], { type: 'text/plain' }))).resolves.toBe('aGVsbG8=');
  });

  it('decides when to downscale and keeps the aspect ratio', () => {
    expect(shouldDownscale(1200, 800, 500_000)).toBe(false);
    expect(shouldDownscale(4000, 3000, 500_000)).toBe(true);
    expect(shouldDownscale(800, 600, 2 * MB)).toBe(true);
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('returns non-images unchanged', async () => {
    const pdf = fakeFile('a.pdf', 'application/pdf', 100);
    await expect(downscaleImage(pdf)).resolves.toBe(pdf);
  });

  it('re-encodes large images as JPEG within 1600 px', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close })));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type) => cb(new Blob(['jpg'], { type })));
    const out = await downscaleImage(fakeFile('photo.png', 'image/png', 3 * MB));
    expect(out.name).toBe('photo.jpg');
    expect(out.type).toBe('image/jpeg');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(close).toHaveBeenCalled();

    const small = fakeFile('small.png', 'image/png', 1000);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 100, close })));
    await expect(downscaleImage(small)).resolves.toBe(small);
    vi.unstubAllGlobals();
  });

  it('trims long file names to the server limit', () => {
    expect(safeFileName('x'.repeat(200))).toHaveLength(120);
    expect(safeFileName('  ')).toBe('upload');
  });
});

describe('recorder helpers', () => {
  it('picks the first supported recording type', () => {
    expect(pickMimeType({ isTypeSupported: (t: string) => t === 'audio/mp4' })).toBe('audio/mp4');
    expect(pickMimeType({ isTypeSupported: () => false })).toBe('');
  });

  it('explains microphone errors in plain language', () => {
    expect(describeMicError({ name: 'NotAllowedError' })).toContain('blocked');
    expect(describeMicError({ name: 'NotFoundError' })).toContain('No microphone');
    expect(describeMicError(new Error('x'))).toContain('could not start');
  });
});

describe('SAMPLES', () => {
  it('provides four distinct, well-formed sample Intakes', () => {
    expect(SAMPLES).toHaveLength(4);
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(4);
    for (const sample of SAMPLES) {
      expect(sample.title.length).toBeGreaterThan(3);
      expect(sample.text.length).toBeGreaterThan(80);
      expect(sample.text.length).toBeLessThanOrEqual(10_000);
    }
    expect(SAMPLES.filter((s) => s.liveCheck)).toHaveLength(1);
  });
});
