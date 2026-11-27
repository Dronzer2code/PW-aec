/**
 * LifeBridge workspace controller: wires the Intake form to POST /api/analyze and shows the Action Card.
 * All card markup is built by render.js; this file owns state, events and focus.
 */
import {
  buildPlainText, directoryFor, elementFactory, formatDomain, icon, renderActionCard, renderDirectoryCard,
  renderEmergencyFallback, renderSkeleton, renderSummaryCard, severityLabel,
} from './render.js';
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
const text = $('intake-text');
const region = $('card-region');
const submitBtn = $('submit-btn');
const recordBtn = $('record-btn');
const retryBtn = $('retry-btn');
const sampleBtn = $('sample-btn');
const menu = $('sample-list');
const menuBtn = $('menu-btn');
const sidebar = $('sidebar');
const dialog = $('verify-dialog');
const tabs = { card: $('tab-card'), intake: $('tab-intake') };

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
  toastTimer: 0,
  /** @type {Element | null} Element to refocus when the dialog closes. */
  opener: null,
};

/** Polite announcement; also shown briefly as a toast for sighted users. */
function announce(msg) {
  const status = $('status');
  status.textContent = msg;
  status.classList.toggle('is-shown', Boolean(msg));
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => status.classList.remove('is-shown'), 6000);
}

function showError(msg, retryAfterMs = -1) {
  clearTimeout(state.retryTimer);
  $('error-text').textContent = msg;
  $('error').classList.toggle('is-visible', Boolean(msg));
  retryBtn.hidden = true;
  if (retryAfterMs >= 0) state.retryTimer = setTimeout(() => { retryBtn.hidden = false; }, retryAfterMs);
}

/** Inline error state on the Situation field (Untitled-style error border + hint). */
function setFieldError(msg) {
  $('intake-error').textContent = msg;
  $('intake-error').hidden = !msg;
  text.setAttribute('aria-invalid', String(Boolean(msg)));
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
      $('country-select').replaceChildren(...countries.map((c) => new Option(c.name, c.code)));
      renderDirectory();
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

/* ---------- views: tabs, side panel, breadcrumb ---------- */

/** Shows the "card" or "intake" tab panel. */
function showView(name, focusTab = false) {
  for (const [key, tab] of Object.entries(tabs)) {
    const on = key === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`panel-${key}`).hidden = !on;
  }
  if (focusTab) tabs[name].focus();
}

function renderDirectory() {
  const country = selectedCountry();
  $('country-emergency').textContent = `Emergency ${country.emergency}`;
  $('directory-slot').replaceChildren(renderDirectoryCard(country, directoryFor(country)));
}

/**
 * Puts `content` (card, fallback, skeleton or nothing) in the card panel and syncs everything around it.
 * @param {HTMLElement | null} content
 * @param {object | null} card The Action Card behind `content`, if any.
 */
function setResult(content, card = null) {
  stopSpeaking();
  state.card = card;
  region.replaceChildren(...(content ? [content] : []));
  $('view-tabs').hidden = !content;
  showView(content ? 'card' : 'intake');
  $('crumb-current').textContent = card ? formatDomain(card.domain) : 'New';
  $('summary-slot').replaceChildren(...(card ? [renderSummaryCard(card)] : []));
  $('summary-slot').hidden = !card;
  $('directory-slot').hidden = Boolean(card);
  if (card) $('speak-btn').hidden = !('speechSynthesis' in window);
}

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
  setFieldError('');
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

/* Sample picker: WAI-ARIA menu button (arrows, Home/End, Esc returns focus, Tab closes). */
const menuItems = () => Array.from(menu.querySelectorAll('[role="menuitem"]'));

function setMenu(open, focusIndex = 0) {
  menu.hidden = !open;
  sampleBtn.setAttribute('aria-expanded', String(open));
  if (open) menuItems().at(focusIndex)?.focus();
}

function renderSamples() {
  menu.replaceChildren(...SAMPLES.map((sample) => {
    const item = e('button', { type: 'button', role: 'menuitem', tabindex: '-1', class: 'menu-item', text: sample.title });
    item.addEventListener('click', () => {
      setMenu(false);
      loadSample(sample);
    });
    return item;
  }));
}

function onMenuKey(event) {
  const items = menuItems();
  const index = items.indexOf(document.activeElement);
  const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: -1 }[event.key];
  if (move !== undefined) {
    event.preventDefault();
    items.at(move % items.length)?.focus();
  } else if (event.key === 'Escape') {
    event.stopPropagation();
    setMenu(false);
    sampleBtn.focus();
  } else if (event.key === 'Tab') {
    setMenu(false);
  }
}

function renderFiles() {
  $('file-list').replaceChildren(...state.files.map(({ id, file, mimeType }) => {
    const remove = e('button', { type: 'button', class: 'tool-btn file-remove', 'aria-label': `Remove ${file.name}` });
    remove.append(icon(document, 'trash'));
    remove.addEventListener('click', () => removeFile(id));
    const kind = mimeType.split('/')[0] === 'application' ? 'PDF' : mimeType.split('/')[0];
    return e('li', { class: 'file-chip' },
      e('span', { class: 'file-icon', 'aria-hidden': 'true' }, e('span', { text: kind === 'PDF' ? 'PDF' : kind === 'image' ? 'IMG' : 'AUD' })),
      e('span', { class: 'file-text' }, e('span', { class: 'file-name', text: file.name }), e('span', { class: 'file-size', text: formatBytes(file.size) })),
      remove);
  }));
}

function removeFile(id) {
  const index = state.files.findIndex((f) => f.id === id);
  const [removed] = state.files.splice(index, 1);
  renderFiles();
  ($('file-list').querySelectorAll('button')[Math.min(index, state.files.length - 1)] ?? $('attach-btn')).focus();
  announce(`Removed ${removed.file.name}.`);
}

async function addFiles(fileList) {
  showError('');
  setFieldError('');
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

function handleFailure({ code, message = '', details = [], requestId, retryAfterMs = 0 }, previous) {
  const known = Object.hasOwn(ERRORS, code) ? code : 'INTERNAL';
  const info = known === 'VALIDATION_ERROR' ? (details.length ? details.join('; ') : message).slice(0, 200) : '';
  const msg = `${ERRORS[known]}${info ? ` (${info})` : ''}${requestId ? ` Reference: ${requestId}.` : ''}`;
  showError(msg, RETRY.has(known) ? (known === 'RATE_LIMITED' ? retryAfterMs : 0) : -1);
  announce('');
  if (FALLBACK.has(known)) {
    setResult(renderEmergencyFallback(selectedCountry(), 'We could not create an Action Card. If anyone is in danger, call now.'));
  } else {
    setResult(previous && renderActionCard(previous), previous);
  }
}

async function submit() {
  if (state.busy) return;
  showError('');
  if (!text.value.trim() && !state.files.length && !state.recording) {
    showView('intake');
    setFieldError('Describe the situation, record a voice note, or attach a file first.');
    return text.focus();
  }
  setFieldError('');
  setBusy(true);
  const previous = state.card;
  if (state.recording) {
    state.recording.stop();
    await state.recording.attached;
  }
  announce('Analyzing your input. This usually takes 5–20 seconds…');
  setResult(renderSkeleton());
  try {
    const result = await postAnalyze(await buildRequest());
    if (!result.card) return handleFailure(result, previous);
    setResult(renderActionCard(result.card), result.card);
    $('card-title')?.focus();
    announce(`Action Card ready. Severity ${severityLabel(result.card.severity)}. ${result.card.summary ?? ''}`);
  } catch {
    handleFailure({ code: 'INTERNAL' }, previous);
  } finally {
    setBusy(false);
  }
}

/** Resets the workspace to a blank Intake (language and country are kept). */
async function clearAll() {
  if (state.busy) return;
  if (state.recording) {
    state.recording.stop();
    await state.recording.attached;
  }
  text.value = '';
  state.files = [];
  $('live-check').checked = false;
  $('share-location').checked = false;
  renderFiles();
  updateCounter();
  showError('');
  setFieldError('');
  setResult(null);
  text.focus();
  announce('Cleared. Start a new Action Card.');
}

/* ---------- card tools ---------- */

/** Toggle pattern: accessible name stays "Read aloud"; aria-pressed shows whether it is speaking. */
function stopSpeaking() {
  globalThis.speechSynthesis?.cancel();
  $('speak-btn')?.setAttribute('aria-pressed', 'false');
}

function toggleSpeaking() {
  if (!state.card || $('speak-btn').getAttribute('aria-pressed') === 'true') return stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(buildPlainText(state.card));
  utterance.lang = state.card.meta?.outputLanguage ?? 'en';
  utterance.rate = 0.95;
  utterance.addEventListener('end', stopSpeaking);
  utterance.addEventListener('error', stopSpeaking);
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  $('speak-btn').setAttribute('aria-pressed', 'true');
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

const TOOLS = { 'speak-btn': toggleSpeaking, 'copy-btn': copySms, 'download-btn': downloadJson, 'print-btn': () => window.print() };

/* ---------- sidebar drawer and dialog ---------- */

const drawerOpen = () => sidebar.classList.contains('is-open');

function setDrawer(open) {
  sidebar.classList.toggle('is-open', open);
  $('sidebar-backdrop').hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) sidebar.querySelector('a, button')?.focus();
}

function openDialog() {
  state.opener = document.activeElement;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  dialog.querySelector('[data-close]')?.focus();
}

function closeDialog() {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  /** @type {HTMLElement | null} */ (state.opener)?.focus?.();
}

/* ---------- init ---------- */

renderSamples();
renderDirectory();
updateCounter();
if (!isRecordingSupported()) {
  recordBtn.disabled = true;
  $('record-label').textContent = 'Voice recording not supported in this browser';
}
text.addEventListener('input', () => {
  updateCounter();
  if (text.value.trim()) setFieldError('');
});
recordBtn.addEventListener('click', toggleRecording);
$('attach-btn').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (event) => {
  await addFiles(event.target.files ?? []);
  event.target.value = '';
});
$('country-select').addEventListener('change', renderDirectory);
$('intake-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submit();
});
retryBtn.addEventListener('click', submit);
$('clear-btn').addEventListener('click', clearAll);

sampleBtn.addEventListener('click', () => setMenu(menu.hidden));
sampleBtn.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    setMenu(true, event.key === 'ArrowDown' ? 0 : -1);
  }
});
menu.addEventListener('keydown', onMenuKey);
document.addEventListener('click', (event) => {
  if (!menu.hidden && !event.target.closest?.('.menu-wrap, #nav-samples')) setMenu(false);
});

for (const [key, tab] of Object.entries(tabs)) tab.addEventListener('click', () => showView(key));
$('view-tabs').addEventListener('keydown', (event) => {
  const next = { ArrowLeft: null, ArrowRight: null, Home: 'card', End: 'intake' }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  showView(next ?? (tabs.card.getAttribute('aria-selected') === 'true' ? 'intake' : 'card'), true);
});

$('summary-slot').addEventListener('click', (event) => {
  const id = event.target.closest?.('button')?.id;
  if (id && Object.hasOwn(TOOLS, id)) TOOLS[id]();
});

menuBtn.addEventListener('click', () => setDrawer(!drawerOpen()));
$('sidebar-backdrop').addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!menu.hidden) {
    setMenu(false);
    sampleBtn.focus();
  } else if (drawerOpen()) {
    setDrawer(false);
    menuBtn.focus();
  }
});
$('nav-samples').addEventListener('click', () => {
  setDrawer(false);
  showView('intake');
  setMenu(true);
});
$('nav-emergency').addEventListener('click', () => {
  setDrawer(false);
  $('directory-slot').hidden = false;
  $('directory-title').focus();
});
$('nav-verify').addEventListener('click', openDialog);
dialog.addEventListener('click', (event) => {
  if (event.target === dialog || event.target.closest?.('[data-close]')) closeDialog();
});
dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeDialog();
});

window.addEventListener('beforeprint', () => {
  if (state.card) showView('card');
  region.querySelectorAll('details').forEach((d) => { d.open = true; });
});
loadConfig();
