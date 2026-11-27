/**
 * LifeBridge UI controller: wires the Intake form to POST /api/analyze and shows the Action Card.
 * All card markup is built by render.js.
 */
import { buildPlainText, elementFactory, renderActionCard, renderEmergencyFallback, renderSkeleton, severityLabel } from './render.js';
import { SAMPLES, drawSampleImage } from './samples.js';
import { DEFAULT_LIMITS, downscaleImage, fileToBase64, formatBytes, normalizeMimeType, safeFileName, validateFiles } from './files.js';
import { MAX_RECORDING_MS, describeMicError, isRecordingSupported, startRecording } from './recorder.js';

const DEFAULT_COUNTRY = { code: 'IN', name: 'India', emergency: '112' };
const ERRORS = {
  VALIDATION_ERROR: 'Some of the input could not be accepted. Check the text and files, then try again.',
  PAYLOAD_TOO_LARGE: 'The attached files are too large to send. Remove a file or use smaller images.',
  RATE_LIMITED: 'Too many requests right now. Please wait a moment; the Try again button will appear.',
  AI_UNAVAILABLE: 'The AI service is not configured on this server. If anyone is in danger, call the emergency number shown.',
  AI_TIMEOUT: 'The AI took too long to respond. Please try again.',
  AI_BAD_OUTPUT: 'The AI returned an answer we could not verify. Please try again.',
  AI_UPSTREAM_ERROR: 'The AI service is busy right now. Please try again in a moment.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
  NETWORK: 'Could not reach LifeBridge. Check your connection and try again.',
  TIMEOUT: 'The request took too long and was cancelled. Please try again.',
};
/** Failures where the emergency number is shown immediately instead of an Action Card. */
const FALLBACK = new Set(['AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_BAD_OUTPUT', 'AI_UPSTREAM_ERROR', 'INTERNAL', 'NETWORK', 'TIMEOUT']);
/** Transient failures that offer a Try again button. */
const RETRY = new Set(['AI_TIMEOUT', 'AI_BAD_OUTPUT', 'AI_UPSTREAM_ERROR', 'INTERNAL', 'NETWORK', 'TIMEOUT', 'RATE_LIMITED']);

const $ = (id) => document.getElementById(id);
const e = elementFactory(document);
const form = $('intake-form');
const text = $('intake-text');
const region = $('card-region');
const emptyState = $('empty-state');
const toolbar = $('card-toolbar');
const submitBtn = $('submit-btn');
const recordBtn = $('record-btn');
const speakBtn = $('speak-btn');
const retryBtn = $('retry-btn');

const state = {
  limits: { maxTextChars: 10_000, ...DEFAULT_LIMITS },
  timeoutMs: 75_000,
  countries: [DEFAULT_COUNTRY],
  /** @type {{ id: number, file: File, mimeType: string }[]} */
  files: [],
  nextId: 1,
  card: null,
  /** True while the microphone permission prompt is open. */
  starting: false,
  /** @type {{ stop: () => Promise<Blob>, attached: Promise<void> } | null} */
  recording: null,
  busy: false,
  retryTimer: 0,
};

const announce = (msg) => { $('status').textContent = msg; };
function showError(msg, retryAfterMs = -1) {
  clearTimeout(state.retryTimer);
  $('error-text').textContent = msg;
  $('error').classList.toggle('is-visible', Boolean(msg));
  retryBtn.hidden = true;
  if (retryAfterMs >= 0) state.retryTimer = setTimeout(() => { retryBtn.hidden = false; }, retryAfterMs);
}

/* ---------- config ---------- */

async function loadConfig() {
  try {
    const res = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const { languages, countries, limits, aiAvailable, requestTimeoutMs } = await res.json();
    if (Array.isArray(languages) && languages.length) {
      $('language-select').replaceChildren(...languages.map((l) => {
        const option = new Option(l.name === l.nativeName ? l.name : `${l.nativeName} (${l.name})`, l.code, false, l.code === 'en');
        option.lang = l.code;
        return option;
      }));
    }
    if (Array.isArray(countries) && countries.length) {
      state.countries = countries;
      $('country-select').replaceChildren(...countries.map((c) => new Option(`${c.name} — emergency ${c.emergency}`, c.code)));
    }
    if (Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0) state.timeoutMs = requestTimeoutMs;
    state.limits = { ...state.limits, ...limits };
    text.maxLength = state.limits.maxTextChars;
    updateCounter();
    if (aiAvailable === false) announce('The AI service is not configured on this server. Emergency numbers are still available.');
  } catch {
    announce('Could not load settings. Using defaults: English output, India.');
  }
}

const selectedCountry = () => state.countries.find((c) => c.code === $('country-select').value) ?? DEFAULT_COUNTRY;

/* ---------- intake ---------- */

function updateCounter() {
  const fmt = (n) => n.toLocaleString('en-US');
  $('char-count').textContent = `${fmt(text.value.length)} / ${fmt(state.limits.maxTextChars)} characters`;
}

async function loadSample(sample) {
  text.value = sample.text;
  $('live-check').checked = Boolean(sample.liveCheck);
  updateCounter();
  showError('');
  text.focus();
  let note = sample.liveCheck ? ' Live web check turned on.' : '';
  if (sample.image) {
    const blob = await drawSampleImage(sample.image.lines);
    if (blob) {
      state.files = state.files.filter((f) => f.file.name !== sample.image.name);
      await addFiles([new File([blob], sample.image.name, { type: 'image/png' })]);
      note += ` Sample image ${sample.image.name} attached.`;
    }
  }
  announce(`Sample loaded: ${sample.title}.${note}`);
}

function renderSamples() {
  $('sample-list').replaceChildren(...SAMPLES.map((sample) => {
    const btn = e('button', { type: 'button', class: 'btn btn-chip', text: sample.title });
    btn.addEventListener('click', () => loadSample(sample));
    return btn;
  }));
}

function renderFiles() {
  $('file-list').replaceChildren(...state.files.map(({ id, file }) => {
    const remove = e('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `Remove ${file.name}`, text: '×' });
    remove.addEventListener('click', () => removeFile(id));
    return e('li', { class: 'file-chip' },
      e('span', { class: 'file-name', text: file.name }), e('span', { class: 'file-size', text: formatBytes(file.size) }), remove);
  }));
}

function removeFile(id) {
  const index = state.files.findIndex((f) => f.id === id);
  const [removed] = state.files.splice(index, 1);
  renderFiles();
  ($('file-list').querySelectorAll('button')[Math.min(index, state.files.length - 1)] ?? $('file-input')).focus();
  announce(`Removed ${removed.file.name}.`);
}

async function addFiles(fileList) {
  showError('');
  const prepared = await Promise.all(Array.from(fileList, (f) =>
    normalizeMimeType(f.type)?.startsWith('image/') ? downscaleImage(f).catch(() => f) : f));
  const { accepted, errors } = validateFiles(prepared, state.files.length, state.limits);
  for (const item of accepted) state.files.push({ id: state.nextId++, ...item });
  renderFiles();
  if (errors.length) showError(errors.join(' '));
  if (accepted.length) announce(`${accepted.length} file(s) attached. ${state.files.length} of ${state.limits.maxFiles} used.`);
}

/* ---------- voice ---------- */

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Toggle pattern: the accessible name stays "Record voice note"; state is exposed via aria-pressed. */
function setRecordingUi(active) {
  recordBtn.setAttribute('aria-pressed', String(active));
  $('record-timer').hidden = !active;
  $('record-timer').textContent = `Recording 0:00 / ${clock(MAX_RECORDING_MS)}`;
}

/** Waits for the recording to end and attaches it; resolves once it is in `state.files`. */
async function attachRecording(done) {
  try {
    const blob = await done;
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    await addFiles([new File([blob], `voice-note-${state.nextId}.${ext}`, { type: blob.type })]);
    announce('Recording stopped and attached as a voice note.');
  } catch (err) {
    showError(describeMicError(err));
  } finally {
    state.recording = null;
    setRecordingUi(false);
  }
}

async function toggleRecording() {
  if (state.recording) return void state.recording.stop();
  if (state.starting) return; // permission prompt still open: ignore repeated clicks
  state.starting = true;
  showError('');
  try {
    const { stop, done } = await startRecording({
      onTick: (ms) => { $('record-timer').textContent = `Recording ${clock(ms)} / ${clock(MAX_RECORDING_MS)}`; },
    });
    setRecordingUi(true);
    announce('Recording started. Press Record voice note again to stop.');
    state.recording = { stop, attached: attachRecording(done) };
  } catch (err) {
    showError(describeMicError(err));
  } finally {
    state.starting = false;
  }
}

/* ---------- submit ---------- */

/** Opt-in location, rounded to ~100 m. Resolves undefined when unavailable or denied. */
const getLocation = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(undefined);
  const round = (n) => Math.round(n * 1000) / 1000;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({ lat: round(coords.latitude), lng: round(coords.longitude) }),
    () => resolve(undefined),
    { timeout: 8000, maximumAge: 300_000 },
  );
});

async function buildRequest() {
  const body = {
    files: await Promise.all(state.files.map(async ({ file, mimeType }) =>
      ({ name: safeFileName(file.name), mimeType, data: await fileToBase64(file) }))),
    language: $('language-select').value,
    country: $('country-select').value,
    liveCheck: $('live-check').checked,
  };
  if (text.value.trim()) body.text = text.value.trim();
  if ($('share-location').checked) {
    const location = await getLocation();
    if (location) body.location = location;
    else announce('Location unavailable. Continuing without nearby services.');
  }
  return body;
}

/** POSTs the Intake. Never throws: returns `{ card }` or `{ code, message, details, requestId, retryAfterMs }`. */
async function postAnalyze(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), state.timeoutMs);
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && !data.error) return { card: data };
    const err = data?.error ?? {};
    const code = err.code ?? ({ 413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED' }[res.status] || 'INTERNAL');
    const retryAfter = Number(res.headers.get('Retry-After') ?? Number.NaN);
    return {
      code: String(code),
      message: String(err.message ?? ''),
      details: Array.isArray(err.details) ? err.details.map(String) : [],
      requestId: err.requestId,
      retryAfterMs: Number.isFinite(retryAfter) ? Math.min(retryAfter, 60) * 1000 : 20_000,
    };
  } catch (err) {
    return { code: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}

/** aria-disabled (not `disabled`) keeps focus on the button while busy; `state.busy` blocks re-submits. */
function setBusy(busy) {
  state.busy = busy;
  submitBtn.setAttribute('aria-disabled', String(busy));
  submitBtn.textContent = busy ? 'Creating Action Card…' : 'Create Action Card';
  region.setAttribute('aria-busy', String(busy));
}

function showCard(card) {
  stopSpeaking();
  state.card = card;
  region.replaceChildren(card ? renderActionCard(card) : emptyState);
  toolbar.hidden = !card;
}

function handleFailure({ code, message = '', details = [], requestId, retryAfterMs = 0 }) {
  const known = Object.hasOwn(ERRORS, code) ? code : 'INTERNAL';
  const info = known === 'VALIDATION_ERROR' ? (details.length ? details.join('; ') : message).slice(0, 200) : '';
  const msg = `${ERRORS[known]}${info ? ` (${info})` : ''}${requestId ? ` Reference: ${requestId}.` : ''}`;
  showError(msg, RETRY.has(known) ? (known === 'RATE_LIMITED' ? retryAfterMs : 0) : -1);
  announce('');
  if (!FALLBACK.has(known)) return showCard(state.card);
  showCard(null);
  region.replaceChildren(renderEmergencyFallback(selectedCountry(), 'We could not create an Action Card. If anyone is in danger, call now.'));
}

async function submit() {
  if (state.busy) return;
  showError('');
  if (!text.value.trim() && !state.files.length && !state.recording) {
    showError('Describe the situation, record a voice note, or attach a file first.');
    return text.focus();
  }
  setBusy(true);
  if (state.recording) {
    state.recording.stop();
    await state.recording.attached;
  }
  announce('Analyzing your input. This usually takes 5–20 seconds…');
  toolbar.hidden = true;
  region.replaceChildren(renderSkeleton());
  try {
    const result = await postAnalyze(await buildRequest());
    if (!result.card) return handleFailure(result);
    showCard(result.card);
    $('card-title')?.focus();
    announce(`Action Card ready. Severity ${severityLabel(result.card.severity)}. ${result.card.summary ?? ''}`);
  } catch {
    handleFailure({ code: 'INTERNAL' });
  } finally {
    setBusy(false);
  }
}

/* ---------- toolbar ---------- */

/** Toggle pattern: accessible name stays "Read aloud"; aria-pressed shows whether it is speaking. */
function stopSpeaking() {
  globalThis.speechSynthesis?.cancel();
  speakBtn.setAttribute('aria-pressed', 'false');
}

function toggleSpeaking() {
  if (!state.card || speakBtn.getAttribute('aria-pressed') === 'true') return stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(buildPlainText(state.card));
  utterance.lang = state.card.meta?.outputLanguage ?? 'en';
  utterance.rate = 0.95;
  utterance.addEventListener('end', stopSpeaking);
  utterance.addEventListener('error', stopSpeaking);
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  speakBtn.setAttribute('aria-pressed', 'true');
}

async function copySms() {
  try {
    await navigator.clipboard.writeText(String(state.card?.smsText ?? ''));
    announce('SMS text copied to the clipboard.');
  } catch {
    showError('Copy failed: your browser blocked clipboard access.');
  }
}

function downloadJson() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.card, null, 2)], { type: 'application/json' }));
  const id = String(state.card?.meta?.requestId ?? 'lifebridge').replace(/[^\w-]/g, '');
  const link = e('a', { href: url, download: `action-card-${id}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('Action Card downloaded as JSON.');
}

/* ---------- init ---------- */

renderSamples();
updateCounter();
if (!isRecordingSupported()) {
  recordBtn.disabled = true;
  $('record-label').textContent = 'Voice recording not supported in this browser';
}
speakBtn.hidden = !('speechSynthesis' in window);
text.addEventListener('input', updateCounter);
recordBtn.addEventListener('click', toggleRecording);
$('file-input').addEventListener('change', async (event) => {
  await addFiles(event.target.files ?? []);
  event.target.value = '';
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  submit();
});
retryBtn.addEventListener('click', submit);
speakBtn.addEventListener('click', toggleSpeaking);
$('copy-btn').addEventListener('click', copySms);
$('download-btn').addEventListener('click', downloadJson);
$('print-btn').addEventListener('click', () => window.print());
window.addEventListener('beforeprint', () => region.querySelectorAll('details').forEach((d) => { d.open = true; }));
loadConfig();
