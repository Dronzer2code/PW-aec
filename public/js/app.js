/**
 * LifeBridge workspace controller: routing, the Intake composer, POST /api/analyze and card tools.
 * Markup for cards and pages comes from render.js and pages/views.js; this file owns state, events and focus.
 */
import { createRouter } from './router.js';
import {
  buildPlainText, directoryFor, elementFactory, formatDomain, icon, renderActionCard,
  renderEmergencyFallback, renderSummaryCard, severityLabel,
} from './render.js';
import {
  renderBreadcrumb, renderCallGrid, renderCardList, renderProgress, renderRecentItems, renderSampleGrid, renderSuggestions,
} from './pages/views.js';
import { createCardStore } from './pages/store.js';
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
/** Samples shown as suggestion cards under the composer. */
const SUGGESTED = ['road-accident', 'chest-pain', 'prescription-photo'];
const RECENT_LIMIT = 5;

const $ = (id) => document.getElementById(id);
const e = elementFactory(document);
const text = $('intake-text');
const region = $('card-region');
const submitBtn = $('submit-btn');
const recordBtn = $('record-btn');
const retryBtn = $('retry-btn');
const menuBtn = $('menu-btn');
const sidebar = $('sidebar');
const brandBtn = $('brand-btn');
const quick = $('quick-settings');
const search = $('search');
const COUNTRY_SELECTS = ['country-select', 'qs-country', 'emergency-country'];
const LANGUAGE_SELECTS = ['language-select', 'qs-language'];

let storage = null;
try {
  storage = window.sessionStorage;
} catch {
  storage = null; // blocked storage: cards live in memory only
}
const store = createCardStore(storage);

const state = {
  limits: { maxTextChars: 10_000, ...DEFAULT_LIMITS },
  timeoutMs: 75_000,
  countries: [DEFAULT_COUNTRY],
  /** @type {{ id: number, file: File, mimeType: string }[]} */
  files: [],
  nextId: 1,
  /** Card shown on the current /app/cards/<id> page (used by the card tools). */
  card: null,
  /** True while the microphone permission prompt is open. */
  starting: false,
  /** @type {{ stop: () => Promise<Blob>, attached: Promise<void> } | null} */
  recording: null,
  busy: false,
  retryTimer: 0,
  toastTimer: 0,
  stepTimer: 0,
  recentAll: false,
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

/** Inline error state on the composer. */
function setFieldError(msg) {
  $('intake-error').textContent = msg;
  $('intake-error').hidden = !msg;
  text.setAttribute('aria-invalid', String(Boolean(msg)));
}

const pressed = (id) => $(id).getAttribute('aria-pressed') === 'true';
const setPressed = (id, on) => $(id).setAttribute('aria-pressed', String(on));

/* ---------- config, language and country ---------- */

const selectedCountry = () => state.countries.find((c) => c.code === $('country-select').value) ?? DEFAULT_COUNTRY;

function setCountry(code) {
  for (const id of COUNTRY_SELECTS) $(id).value = code;
  const country = selectedCountry();
  $('sos-link').href = `tel:${country.emergency}`;
  $('sos-number').textContent = country.emergency;
  $('sos-country').textContent = ` (call, ${country.name})`;
  $('country-name').textContent = `${country.name}, emergency number ${country.emergency}`;
  $('call-slot').replaceChildren(renderCallGrid(directoryFor(country)));
}

function setLanguage(code) {
  for (const id of LANGUAGE_SELECTS) $(id).value = code;
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const { languages, countries, limits, aiAvailable, requestTimeoutMs } = await res.json();
    if (Array.isArray(languages) && languages.length) {
      for (const id of LANGUAGE_SELECTS) {
        $(id).replaceChildren(...languages.map((l) => {
          const option = new Option(l.name === l.nativeName ? l.name : `${l.nativeName} (${l.name})`, l.code, false, l.code === 'en');
          option.lang = l.code;
          return option;
        }));
      }
    }
    if (Array.isArray(countries) && countries.length) {
      state.countries = countries;
      for (const id of COUNTRY_SELECTS) {
        $(id).replaceChildren(...countries.map((c) => new Option(id === 'country-select' ? `${c.code} · ${c.emergency}` : `${c.name} · ${c.emergency}`, c.code)));
      }
      setCountry(countries[0].code);
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

/* ---------- routing ---------- */

const NAV_GROUP = { new: 'new', cards: 'cards', card: 'cards', samples: 'samples', emergency: 'emergency', verification: 'verification' };
const WORKSPACE = { label: 'Workspace', href: '/app' };
const CARDS = { label: 'Action Cards', href: '/app/cards' };

/** Shows the view for `route`; returns the page title and the heading that receives focus. */
function renderRoute(route) {
  stopSpeaking();
  setDrawer(false);
  setQuick(false);
  showError('');
  state.card = null;
  const view = Object.hasOwn(NAV_GROUP, route.name) ? route.name : 'not-found';
  for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== view;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === NAV_GROUP[route.name]) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  let title = route.title;
  let crumbs = [WORKSPACE, { label: route.title, href: route.path }];
  let heading = document.querySelector(`[data-view="${view}"] h1`);
  if (route.name === 'cards') {
    crumbs = [WORKSPACE, CARDS];
    $('card-list-slot').replaceChildren(renderCardList(store.list(), Date.now()));
  } else if (route.name === 'card') {
    ({ title, heading } = renderCardPage(route.params[0]));
    crumbs = [WORKSPACE, CARDS, { label: title, href: route.path }];
  }
  $('breadcrumb').hidden = route.name === 'new';
  $('breadcrumb').replaceChildren(renderBreadcrumb(crumbs));
  return { title, heading };
}

function renderCardPage(id) {
  const entry = store.get(id);
  if (!entry) {
    $('card-doc').replaceChildren(e('div', { class: 'empty' },
      e('h1', { id: 'card-title', class: 'display', tabindex: '-1', text: 'Action Card not found' }),
      e('p', { text: 'Cards are kept only in the browser tab that created them. It may have been closed.' }),
      e('a', { href: '/app/cards', 'data-link': '', class: 'btn btn-dark', text: 'See your Action Cards' })));
    $('summary-slot').replaceChildren();
    $('summary-slot').hidden = true;
    return { title: 'Action Card not found', heading: $('card-title') };
  }
  state.card = entry.card;
  $('card-doc').replaceChildren(renderActionCard(entry.card, document, { level: 1 }));
  $('summary-slot').replaceChildren(renderSummaryCard(entry.card));
  $('summary-slot').hidden = false;
  $('speak-btn').hidden = !('speechSynthesis' in window);
  return { title: formatDomain(entry.card.domain), heading: $('card-title') };
}

const router = createRouter({ render: renderRoute, announce });

/* ---------- sidebar: recent, search, quick settings, drawer ---------- */

function renderRecent() {
  const entries = store.list();
  const items = renderRecentItems(entries);
  items.forEach((li, n) => { li.dataset.overflow = String(n >= RECENT_LIMIT); });
  $('recent-list').replaceChildren(...items);
  $('recent-empty').hidden = entries.length > 0;
  applySearch();
}

/** Filters Recent, the suggestion cards and the samples grid by the sidebar search text. */
function applySearch() {
  const q = search.value.trim().toLowerCase();
  let recentShown = 0;
  for (const li of $('recent-list').children) {
    const match = !q || li.textContent.toLowerCase().includes(q);
    li.hidden = !match || (!q && !state.recentAll && li.dataset.overflow === 'true');
    recentShown += match ? 1 : 0;
  }
  for (const li of document.querySelectorAll('[data-search]')) {
    li.hidden = Boolean(q) && !li.dataset.search.toLowerCase().includes(q);
  }
  const extra = $('recent-list').children.length - RECENT_LIMIT;
  $('recent-more').hidden = Boolean(q) || extra <= 0;
  $('recent-more-label').textContent = state.recentAll ? 'Show less' : `Show ${extra} more`;
  $('search-empty').hidden = !q || recentShown > 0 || document.querySelector('[data-search]:not([hidden])') !== null;
}

function setQuick(open) {
  quick.hidden = !open;
  brandBtn.setAttribute('aria-expanded', String(open));
}

const drawerOpen = () => sidebar.classList.contains('is-open');

function setDrawer(open) {
  sidebar.classList.toggle('is-open', open);
  $('sidebar-backdrop').hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) sidebar.querySelector('button, a')?.focus();
}

/* ---------- intake ---------- */

function updateCounter() {
  const fmt = (n) => n.toLocaleString('en-US');
  $('char-count').textContent = `${fmt(text.value.length)} / ${fmt(state.limits.maxTextChars)} characters`;
}

async function loadSample(sample) {
  text.value = sample.text;
  setPressed('live-btn', Boolean(sample.liveCheck));
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

function useSample(id) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) return;
  if (router.current.name !== 'new') router.navigate('/app');
  loadSample(sample);
}

function renderFiles() {
  $('file-list').replaceChildren(...state.files.map(({ id, file, mimeType }) => {
    const remove = e('button', { type: 'button', class: 'icon-btn file-remove', 'aria-label': `Remove ${file.name}` }, icon(document, 'cross'));
    remove.addEventListener('click', () => removeFile(id));
    const kind = mimeType.startsWith('image/') ? 'IMG' : mimeType.startsWith('audio/') ? 'AUD' : 'PDF';
    return e('li', { class: 'file-chip' },
      e('span', { class: 'file-icon', 'aria-hidden': 'true', text: kind }),
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
    liveCheck: pressed('live-btn'),
  };
  if (text.value.trim()) body.text = text.value.trim();
  if (pressed('location-btn')) {
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

const setStep = (n) => region.replaceChildren(renderProgress(n));

/** aria-disabled (not `disabled`) keeps focus on the button while busy; `state.busy` blocks re-submits. */
function setBusy(busy) {
  state.busy = busy;
  submitBtn.setAttribute('aria-disabled', String(busy));
  $('submit-label').textContent = busy ? 'Creating Action Card…' : 'Create Action Card';
  region.setAttribute('aria-busy', String(busy));
  $('suggestions').hidden = busy;
  clearTimeout(state.stepTimer);
}

function handleFailure({ code, message = '', details = [], requestId, retryAfterMs = 0 }) {
  const known = Object.hasOwn(ERRORS, code) ? code : 'INTERNAL';
  const info = known === 'VALIDATION_ERROR' ? (details.length ? details.join('; ') : message).slice(0, 200) : '';
  const msg = `${ERRORS[known]}${info ? ` (${info})` : ''}${requestId ? ` Reference: ${requestId}.` : ''}`;
  showError(msg, RETRY.has(known) ? (known === 'RATE_LIMITED' ? retryAfterMs : 0) : -1);
  announce('');
  region.replaceChildren(...(FALLBACK.has(known)
    ? [renderEmergencyFallback(selectedCountry(), 'We could not create an Action Card. If anyone is in danger, call now.', document, { level: 2 })]
    : []));
}

/** Stores the card, resets the composer and opens the card page. */
function finish(card) {
  const id = store.add(card);
  text.value = '';
  state.files = [];
  renderFiles();
  updateCounter();
  region.replaceChildren();
  renderRecent();
  if (router.current.name === 'new') router.navigate(`/app/cards/${id}`);
  announce(`Action Card ready. Severity ${severityLabel(card.severity)}. ${card.summary ?? ''}`);
}

async function submit() {
  if (state.busy) return;
  showError('');
  if (!text.value.trim() && !state.files.length && !state.recording) {
    setFieldError('Describe the situation, record a voice note, or attach a file first.');
    return text.focus();
  }
  setFieldError('');
  setBusy(true);
  setStep(0);
  if (state.recording) {
    state.recording.stop();
    await state.recording.attached;
  }
  announce('Analyzing your input. This usually takes 5–20 seconds…');
  try {
    const body = await buildRequest();
    setStep(1);
    state.stepTimer = setTimeout(() => setStep(2), 3500);
    const result = await postAnalyze(body);
    setBusy(false);
    if (result.card) finish(result.card);
    else handleFailure(result);
  } catch {
    setBusy(false);
    handleFailure({ code: 'INTERNAL' });
  }
}

/* ---------- card tools ---------- */

/** Toggle pattern: accessible name stays "Read aloud"; aria-pressed shows whether it is speaking. */
function stopSpeaking() {
  globalThis.speechSynthesis?.cancel();
  $('speak-btn')?.setAttribute('aria-pressed', 'false');
}

function toggleSpeaking() {
  if (!state.card || pressed('speak-btn')) return stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(buildPlainText(state.card));
  utterance.lang = state.card.meta?.outputLanguage ?? 'en';
  utterance.rate = 0.95;
  utterance.addEventListener('end', stopSpeaking);
  utterance.addEventListener('error', stopSpeaking);
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  setPressed('speak-btn', true);
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

/* ---------- init ---------- */

$('sample-list').replaceChildren(...renderSuggestions(SAMPLES.filter((s) => SUGGESTED.includes(s.id))));
$('sample-grid').replaceChildren(...renderSampleGrid(SAMPLES));
setCountry(DEFAULT_COUNTRY.code);
updateCounter();
renderRecent();
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
for (const id of ['location-btn', 'live-btn']) $(id).addEventListener('click', () => setPressed(id, !pressed(id)));
for (const id of COUNTRY_SELECTS) $(id).addEventListener('change', (event) => setCountry(event.target.value));
for (const id of LANGUAGE_SELECTS) $(id).addEventListener('change', (event) => setLanguage(event.target.value));
$('intake-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submit();
});
retryBtn.addEventListener('click', submit);
$('top-print').addEventListener('click', () => window.print());
$('summary-slot').addEventListener('click', (event) => {
  const id = event.target.closest?.('button')?.id;
  if (id && Object.hasOwn(TOOLS, id)) TOOLS[id]();
});

document.addEventListener('click', (event) => {
  const sampleBtn = event.target.closest?.('[data-sample]');
  if (sampleBtn) useSample(sampleBtn.dataset.sample);
  if (!quick.hidden && !event.target.closest?.('.brand-card')) setQuick(false);
});
brandBtn.addEventListener('click', () => setQuick(quick.hidden));
search.addEventListener('input', applySearch);
search.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !search.value) return;
  event.stopPropagation();
  search.value = '';
  applySearch();
});
$('recent-toggle').addEventListener('click', (event) => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  event.currentTarget.setAttribute('aria-expanded', String(open));
  $('recent-body').hidden = !open;
});
$('recent-more').addEventListener('click', () => {
  state.recentAll = !state.recentAll;
  applySearch();
});
menuBtn.addEventListener('click', () => setDrawer(!drawerOpen()));
$('sidebar-backdrop').addEventListener('click', () => setDrawer(false));

document.addEventListener('keydown', (event) => {
  const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (window.matchMedia?.('(max-width: 899px)').matches) setDrawer(true);
    search.focus();
  } else if (event.key === 'Escape' && !quick.hidden) {
    setQuick(false);
    brandBtn.focus();
  } else if (event.key === 'Escape' && drawerOpen()) {
    setDrawer(false);
    menuBtn.focus();
  }
});

window.addEventListener('beforeprint', () => document.querySelectorAll('#card-doc details').forEach((d) => { d.open = true; }));
router.start();
loadConfig();
