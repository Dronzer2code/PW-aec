/** Minimal MediaRecorder wrapper for voice Intakes. */

/** Hard limit for one voice note. */
export const MAX_RECORDING_MS = 120_000;
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

/** @returns {boolean} Whether the browser can record audio. */
export const isRecordingSupported = () => typeof MediaRecorder === 'function' && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * First supported recording MIME type, or '' to let the browser choose.
 * @param {{ isTypeSupported(type: string): boolean }} [Recorder]
 * @returns {string}
 */
export const pickMimeType = (Recorder = globalThis.MediaRecorder) => TYPES.find((t) => Recorder?.isTypeSupported?.(t)) ?? '';

/**
 * Plain-language message for a microphone failure.
 * @param {unknown} err
 * @returns {string}
 */
export function describeMicError(err) {
  const name = /** @type {{ name?: string }} */ (err)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow it in your browser settings, or type the situation instead.';
  if (name === 'NotFoundError') return 'No microphone was found. Connect one, or type the situation instead.';
  return 'Recording could not start. Please type the situation or upload an audio file.';
}

/**
 * Starts recording; stops automatically after `maxMs`. Microphone permission errors reject.
 * @param {{ maxMs?: number, onTick?: (elapsedMs: number) => void }} [options]
 * @returns {Promise<{ stop: () => Promise<Blob>, done: Promise<Blob> }>} `done` resolves with the audio Blob.
 */
export async function startRecording({ maxMs = MAX_RECORDING_MS, onTick } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const releaseMic = () => stream.getTracks().forEach((track) => track.stop());
  const mimeType = pickMimeType();
  const chunks = [];
  let recorder;
  let ticker = 0;
  let limit = 0;
  /** @type {Promise<Blob>} */
  let done;
  const stop = () => {
    if (recorder.state !== 'inactive') recorder.stop();
    return done;
  };
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    done = new Promise((resolve, reject) => {
      const finish = () => {
        clearInterval(ticker);
        clearTimeout(limit);
        releaseMic();
      };
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = () => {
        finish();
        resolve(new Blob(chunks, { type: (recorder.mimeType || mimeType || 'audio/webm').split(';')[0] }));
      };
      recorder.onerror = (event) => {
        finish();
        reject(event.error ?? new Error('Recording failed'));
      };
    });
    recorder.start(1000);
  } catch (err) {
    releaseMic(); // never leave the microphone on when recording could not start
    throw err;
  }
  const startedAt = Date.now();
  ticker = setInterval(() => onTick?.(Date.now() - startedAt), 500);
  limit = setTimeout(stop, maxMs);
  return { stop, done };
}
