/** Intake file helpers: validation, base64 encoding and image downscaling. Limits mirror src/domain/schema.ts. */

/** MIME types accepted by POST /api/analyze. Keep in sync with ALLOWED_MIME_TYPES in src/domain/schema.ts (not exposed via /api/config). */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];
/** Defaults, replaced by `limits` from GET /api/config. */
export const DEFAULT_LIMITS = Object.freeze({ maxFiles: 4, maxFileBytes: 5 * 1024 * 1024 });
/** Images over either bound are re-encoded as JPEG before upload. */
export const DOWNSCALE = Object.freeze({ maxEdge: 1600, maxBytes: 1.5 * 1024 * 1024, quality: 0.85 });

const ALIASES = { 'image/jpg': 'image/jpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/mp3': 'audio/mpeg', 'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4' };

/**
 * Canonical allowed MIME type (parameters like `;codecs=opus` stripped), or null if unsupported.
 * @param {string | null | undefined} type
 * @returns {string | null}
 */
export function normalizeMimeType(type) {
  const base = String(type ?? '').split(';')[0].trim().toLowerCase();
  const canonical = Object.hasOwn(ALIASES, base) ? ALIASES[base] : base;
  return ALLOWED_MIME_TYPES.includes(canonical) ? canonical : null;
}

/**
 * Human readable size, e.g. `1.5 MB`.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!(bytes >= 1024)) return `${Math.max(0, Math.round(bytes) || 0)} B`;
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${Number((bytes / 1024 ** unit).toFixed(1))} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

/**
 * Validates files against type, size and count limits.
 * @param {ArrayLike<File>} files Newly added files.
 * @param {number} [existingCount] Files already attached.
 * @param {{ maxFiles: number, maxFileBytes: number }} [limits]
 * @returns {{ accepted: { file: File, mimeType: string }[], errors: string[] }}
 */
export function validateFiles(files, existingCount = 0, limits = DEFAULT_LIMITS) {
  const accepted = [];
  const errors = [];
  for (const file of Array.from(files)) {
    const mimeType = normalizeMimeType(file.type);
    const problem =
      existingCount + accepted.length >= limits.maxFiles ? `you can attach up to ${limits.maxFiles} files`
        : !mimeType ? 'unsupported type. Use JPEG, PNG, WEBP, PDF or audio'
          : file.size > limits.maxFileBytes ? `${formatBytes(file.size)} is over the ${formatBytes(limits.maxFileBytes)} limit`
            : file.size === 0 ? 'the file is empty' : '';
    if (problem) errors.push(`${file.name}: ${problem}.`);
    else accepted.push({ file, mimeType });
  }
  return { accepted, errors };
}

/**
 * File name trimmed to the 120 characters the server accepts.
 * @param {string} name
 * @returns {string}
 */
export const safeFileName = (name) => (String(name ?? '').trim() || 'upload').slice(0, 120);

/**
 * Reads a Blob as base64 without the `data:…;base64,` prefix.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** @param {number} width @param {number} height @param {number} bytes @returns {boolean} */
export const shouldDownscale = (width, height, bytes) => Math.max(width, height) > DOWNSCALE.maxEdge || bytes > DOWNSCALE.maxBytes;

/**
 * Dimensions that keep the aspect ratio and fit within `maxEdge`.
 * @param {number} width @param {number} height @param {number} [maxEdge]
 * @returns {{ width: number, height: number }}
 */
export function scaledSize(width, height, maxEdge = DOWNSCALE.maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Re-encodes large images as JPEG (quality 0.85, long edge ≤ 1600 px).
 * Returns the original file when no change is needed or the browser cannot decode it.
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function downscaleImage(file) {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  try {
    if (!shouldDownscale(bitmap.width, bitmap.height, file.size)) return file;
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // JPEG has no alpha: flatten transparent PNGs onto white
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', DOWNSCALE.quality));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file;
  } finally {
    bitmap.close();
  }
}
