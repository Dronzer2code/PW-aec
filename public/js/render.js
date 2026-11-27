/**
 * Pure DOM builders for the Action Card.
 * Security: data is written only via textContent or fixed attribute names (never innerHTML),
 * and links are limited to http(s) and plain `tel:` numbers, so model output cannot inject markup.
 * @typedef {import('../../src/domain/schema.js').ActionCard} ActionCard
 */

const TEL_RE = /^tel:\+?\d{2,15}$/;
const LANG_RE = /^[a-z]{2,3}(-[a-z\d]{2,8})*$/i;
const RTL_LANGS = new Set(['ar', 'ur', 'fa', 'he', 'ps', 'sd']);
const CIRCLE = 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z';
/** Static 24x24 stroke icons; never built from data. */
const ICONS = {
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  warn: `M12 8v4m0 4h.01${CIRCLE}`,
  info: `M12 16v-4m0-4h.01${CIRCLE}`,
  check: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
  cross: `m15 9-6 6m0-6 6 6${CIRCLE}`,
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2Z',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  chevron: 'm9 18 6-6-6-6',
  tick: 'M20 6 9 17l-5-5',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8Z',
  clipboard: 'M9 2h6v4H9zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2m1 8h6m-6 4h4',
  car: 'M5 17H3v-5l2-5h14l2 5v5h-2M3 12h18M7 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0m6 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  flame: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8a7 7 0 0 0 7 7Z',
  waves: 'M2 7c2 0 2-2 5-2s3 2 5 2 2-2 5-2 3 2 5 2M2 13c2 0 2-2 5-2s3 2 5 2 2-2 5-2 3 2 5 2M2 19c2 0 2-2 5-2s3 2 5 2 2-2 5-2 3 2 5 2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm9 14v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M12 3v12m0 0-5-5m5 5 5-5M4 21h16',
  volume: 'M11 5 6 9H2v6h4l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  globe: `M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z${CIRCLE}`,
  zap: 'M13 2 3 14h9l-1 8 10-12h-9Z',
  trash: 'M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  cloud: 'M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10ZM8 22l1-2m3 2 1-2m3 2 1-2',
  text: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  search: 'm21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6',
  lock: 'M5 11h14v11H5zM8 11V7a4 4 0 0 1 8 0v4',
  pill: 'm10.5 20.5 10-10a5 5 0 0 0-7-7l-10 10a5 5 0 0 0 7 7ZM8.5 8.5l7 7',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6M5 21h14M12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4M2 12h2M20 12h2',
  book: 'M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2ZM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7Z',
};
const DOMAIN_ICONS = {
  medical_emergency: 'heart', medical_history: 'clipboard', road_accident: 'car', fire: 'flame',
  natural_disaster: 'waves', crime_or_safety: 'shield', public_health: 'users', other: 'info',
};

/** [label, icon] */
const SEVERITY = { critical: ['Critical', 'alert'], high: ['High', 'warn'], moderate: ['Moderate', 'info'], low: ['Low', 'check'] };
const DOMAINS = {
  medical_emergency: 'Medical emergency',
  medical_history: 'Medical history summary',
  road_accident: 'Road accident',
  fire: 'Fire',
  natural_disaster: 'Natural disaster',
  crime_or_safety: 'Crime or personal safety',
  public_health: 'Public health',
  other: 'General situation',
};
const ACTORS = { caller: 'You', bystander: 'Bystander', caregiver: 'Caregiver', authority: 'Authorities' };
const TIMEFRAMES = { immediately: 'Immediately', within_1_hour: 'Within 1 hour', today: 'Today', ongoing: 'Ongoing' };
const FLAGS = {
  escalation_added: 'Added by safety check',
  dosage_removed: 'Dosage removed — follow your doctor',
  number_redacted: 'Unverified number removed',
};
/** [label, tone, icon] */
const FACT_STATUS = {
  grounded: ['Matched in your input', 'ok', 'check'],
  transcribed: ['Read from audio/image', 'info', 'info'],
  unverified: ['Not found in input — please confirm', 'warn', 'warn'],
};
const LIVE_STATUS = {
  corroborated: ['Corroborated by live web sources', 'ok', 'check'],
  contradicted: ['Contradicted by live web sources', 'danger', 'cross'],
  inconclusive: ['Inconclusive — no clear confirmation found', 'warn', 'warn'],
  error: ['Live web check unavailable', 'neutral', 'info'],
};
const CHECK_STATUS = { pass: ['Pass', 'ok', 'check'], warn: ['Warning', 'warn', 'warn'], fail: ['Fail', 'danger', 'cross'] };

/** Labels and numbers mirrored from src/domain/contacts.ts (a test keeps them identical). Never from the AI. */
export const SERVICE_LABELS = Object.freeze({
  general_emergency: 'Emergency (all services)', ambulance: 'Ambulance', police: 'Police', fire: 'Fire brigade',
  disaster: 'Disaster helpline', child_helpline: 'Child helpline', women_helpline: 'Women helpline',
});
/** @type {Readonly<Record<string, [string, string][]>>} country code → [service, number], general emergency first. */
export const DIRECTORY = Object.freeze({
  IN: [['general_emergency', '112'], ['ambulance', '108'], ['police', '100'], ['fire', '101'], ['disaster', '1078'], ['child_helpline', '1098'], ['women_helpline', '181']],
  US: [['general_emergency', '911']],
  GB: [['general_emergency', '999']],
  EU: [['general_emergency', '112'], ['child_helpline', '116111']],
  AU: [['general_emergency', '000']],
});

/** Own-property lookup, so keys like `__proto__` from data never hit the prototype. */
const lookup = (map, key) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : undefined);
const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === undefined || v === null ? '' : String(v));
const pct = (v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 100);

/** @param {string} severity @returns {string} e.g. `Critical` */
export const severityLabel = (severity) => lookup(SEVERITY, severity)?.[0] ?? 'Unknown';
/** @param {string} timeframe @returns {string} e.g. `Within 1 hour` */
export const formatTimeframe = (timeframe) => lookup(TIMEFRAMES, timeframe) ?? 'When possible';
/** @param {string} actor @returns {string} */
export const formatActor = (actor) => lookup(ACTORS, actor) ?? 'Anyone';
/** @param {string} domain @returns {string} */
export const formatDomain = (domain) => lookup(DOMAINS, domain) ?? DOMAINS.other;

/**
 * Verified contacts for a country from GET /api/config. The full mirrored list is used only when its
 * general number matches the server's, so a stale mirror can never show a wrong number.
 * @param {{ code: string, emergency: string }} country
 * @returns {{ service: string, label: string, number: string, tel: string }[]}
 */
export function directoryFor(country) {
  const general = str(country?.emergency);
  const rows = lookup(DIRECTORY, country?.code) ?? [];
  return (rows[0]?.[1] === general ? rows : [['general_emergency', general]])
    .map(([service, number]) => ({ service, label: SERVICE_LABELS[service], number, tel: `tel:${number}` }));
}

const metaLine = (meta = {}) => [
  meta.model && `Model ${str(meta.model)}`,
  meta.cached ? 'Cached result' : 'Fresh result',
  Number.isFinite(meta.latencyMs) && `${Math.round(meta.latencyMs)} ms`,
  meta.requestId && `Ref ${str(meta.requestId)}`,
].filter(Boolean).join(' · ');
const langOf = (card) => {
  const raw = str(card.meta?.outputLanguage);
  return LANG_RE.test(raw) ? raw : 'en';
};

/**
 * Normalized URL if it is an absolute http(s) URL, else null (blocks `javascript:`, `data:`, …).
 * @param {unknown} url
 * @returns {string | null}
 */
export function safeHttpUrl(url) {
  try {
    const { protocol, href } = new URL(str(url));
    return protocol === 'https:' || protocol === 'http:' ? href : null;
  } catch {
    return null;
  }
}

/**
 * Element factory bound to a document. Props: `class`, `text` (textContent), others → setAttribute.
 * Falsy children are skipped; string children become text nodes.
 * @param {Document} [doc]
 * @returns {(tag: string, props?: Record<string, string | undefined>, ...children: any[]) => HTMLElement}
 */
export function elementFactory(doc = document) {
  return (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  };
}

/**
 * Decorative stroke icon from the fixed ICONS set.
 * @param {Document} doc @param {string} name
 * @returns {SVGSVGElement}
 */
export function icon(doc, name) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  for (const [k, v] of [['class', 'icon'], ['viewBox', '0 0 24 24'], ['aria-hidden', 'true'], ['focusable', 'false']]) svg.setAttribute(k, v);
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

/**
 * `tel:` href if it is a plain phone number (`tel:` + optional `+` + 2-15 digits), else null.
 * @param {unknown} tel
 * @returns {string | null}
 */
export const safeTel = (tel) => (TEL_RE.test(str(tel)) ? str(tel) : null);

/** All builders share one context: `e` creates elements, `i` creates icons; `level` is the title heading level. */
function context(doc, level = 3) {
  const e = elementFactory(doc);
  const i = (name) => icon(doc, name);
  const badge = ([label, tone, iconName]) => e('span', { class: `badge tone-${tone}`, lang: 'en' }, iconName && i(iconName), label);
  const section = (key, title, ...content) =>
    e('section', { class: `card-section section-${key}`, 'aria-labelledby': `card-sec-${key}` },
      e(`h${Math.min(level + 1, 6)}`, { id: `card-sec-${key}`, class: 'section-title', lang: 'en', text: title }), ...content);
  const extLink = (href, text) =>
    e('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'ext-link' }, text, i('external'),
      e('span', { class: 'visually-hidden', lang: 'en', text: ' (opens in a new tab)' }));
  const callLink = (c) =>
    TEL_RE.test(str(c?.tel))
      ? e('a', { href: c.tel, class: 'call-btn' }, i('phone'), e('span', { lang: 'en', text: `Call ${str(c.number)} — ${str(c.label)}` }))
      : null;
  return { e, i, badge, section, extLink, callLink, level };
}

function header({ e, i, badge, level }, card) {
  const sev = lookup(SEVERITY, card.severity);
  const verified = card.verification?.status === 'verified';
  return e('header', { class: 'card-header' },
    e('p', { class: 'card-eyebrow', lang: 'en', text: 'Action Card' }),
    e(`h${level}`, { id: 'card-title', class: 'card-title', tabindex: '-1', lang: 'en', text: formatDomain(card.domain) }),
    e('p', { class: 'badge-row' },
      e('span', { class: `badge badge-severity sev-${sev ? card.severity : 'unknown'}`, lang: 'en' },
        i(sev?.[1] ?? 'info'), `Severity: ${severityLabel(card.severity)}`),
      badge(verified ? ['Verified', 'ok', 'check'] : ['Needs human review', 'warn', 'warn']),
      badge([`Evidence grounding ${pct(card.verification?.groundingScore)}%`, 'neutral'])),
    e('p', { class: 'summary', text: str(card.summary) }));
}

function actionItem({ e }, a) {
  const chip = (text, cls = '') => e('span', { class: `chip ${cls}`, lang: 'en', text });
  return e('li', { class: 'action' },
    e('p', { class: 'action-text', text: str(a.instruction) }),
    e('p', { class: 'chip-row' },
      chip(`Who: ${formatActor(a.actor)}`),
      chip(`When: ${formatTimeframe(a.timeframe)}`, a.timeframe === 'immediately' ? 'chip-urgent' : ''),
      ...list(a.flags).map((f) => chip(lookup(FLAGS, f) ?? 'Adjusted by safety check', 'chip-flag'))),
    a.rationale && e('p', { class: 'action-why', text: str(a.rationale) }));
}

function factItem({ e, badge }, f) {
  return e('li', { class: f.needsReview ? 'fact fact-review' : 'fact' },
    e('p', { class: 'fact-main' }, e('span', { class: 'fact-label', text: str(f.label) }), e('span', { text: str(f.value) })),
    e('p', { class: 'badge-row' },
      badge(lookup(FACT_STATUS, f.status) ?? FACT_STATUS.unverified),
      badge([`Confidence ${pct(f.confidence)}%`, 'neutral']),
      f.needsReview && badge(['Needs review', 'warn', 'warn'])),
    f.evidence && e('p', { class: 'fact-evidence' }, e('span', { lang: 'en', text: 'Evidence: ' }), e('q', { dir: 'auto', text: str(f.evidence) })));
}

function liveCheck({ e, badge, section, extLink }, live) {
  const status = lookup(LIVE_STATUS, live?.status);
  if (!status) return null; // `skipped` or unknown → nothing to show
  return section('live', 'Live web check (Google Search)',
    e('p', { class: 'badge-row' }, badge(status)),
    live.note && e('p', { class: 'live-note', text: str(live.note) }),
    sourceList({ e, extLink }, live));
}

function sourceList({ e, extLink }, live) {
  const sources = list(live?.sources).map((s) => [safeHttpUrl(s?.url), str(s?.title)]).filter(([href]) => href);
  return sources.length ? e('ul', { class: 'link-list' }, ...sources.map(([href, title]) => e('li', {}, extLink(href, title || new URL(href).hostname)))) : null;
}

function textList({ e, section }, key, title, items) {
  const values = list(items).map(str).filter(Boolean);
  return values.length ? section(key, title, e('ul', { class: 'text-list' }, ...values.map((v) => e('li', { text: v })))) : null;
}

function details({ e }, summary, ...content) {
  return e('details', { class: 'card-details' }, e('summary', { lang: 'en', text: summary }), ...content);
}

/**
 * Builds the full Action Card element. Pure: no globals besides `doc`, no side effects.
 * @param {ActionCard} card API response from POST /api/analyze.
 * @param {Document} [doc]
 * @param {{ level?: number }} [options] Heading level of the card title (sections use level + 1).
 * @returns {HTMLElement}
 */
export function renderActionCard(card, doc = document, { level = 3 } = {}) {
  const ctx = context(doc, level);
  const { e, i, badge, section, extLink, callLink } = ctx;
  const lang = langOf(card);
  const contacts = list(card.contacts).map(callLink).filter(Boolean);
  const actions = list(card.actions);
  const facts = list(card.facts);
  const maps = list(card.mapsLinks).map((l) => [safeHttpUrl(l?.url), str(l?.label) || 'Open in Google Maps']).filter(([href]) => href);
  const checks = list(card.verification?.checks);

  return e('article', {
    class: `action-card sev-${lookup(SEVERITY, card.severity) ? card.severity : 'unknown'}`,
    lang,
    dir: RTL_LANGS.has(lang.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr',
    'aria-labelledby': 'card-title',
  },
    header(ctx, card),
    card.verification?.status !== 'verified' && e('p', { class: 'review-banner', lang: 'en' }, i('warn'),
      'Some details could not be confirmed against your input. Check items marked “please confirm” before relying on them.'),
    contacts.length && section('contacts', 'Emergency contacts', e('ul', { class: 'contact-list' }, ...contacts.map((a) => e('li', {}, a)))),
    actions.length && section('actions', 'What to do now', e('ol', { class: 'action-list' }, ...actions.map((a) => actionItem(ctx, a)))),
    textList(ctx, 'redflags', 'Red flags — get help faster if you notice', card.redFlags),
    facts.length && section('facts', 'Facts extracted from your input', e('ul', { class: 'fact-list' }, ...facts.map((f) => factItem(ctx, f)))),
    textList(ctx, 'missing', 'Missing information that could change the plan', card.missingInformation),
    liveCheck(ctx, card.liveCheck),
    maps.length && section('maps', 'Nearby services', e('ul', { class: 'link-list' }, ...maps.map(([href, label]) => e('li', {}, extLink(href, label))))),
    checks.length && details(ctx, `Verification checks (${checks.length})`,
      e('ul', { class: 'check-list' }, ...checks.map((c) => e('li', { class: 'check-item' },
        badge(lookup(CHECK_STATUS, c.status) ?? CHECK_STATUS.warn),
        e('span', { class: 'check-id', text: str(c.id).replace(/_/g, ' ') }),
        e('span', { class: 'check-msg', text: str(c.message) }))))),
    card.sourceText && details(ctx,
      `What Gemini read from your input${card.detectedLanguage ? ` — detected language: ${str(card.detectedLanguage)}` : ''}`,
      e('p', { class: 'source-text', dir: 'auto', text: str(card.sourceText) })),
    card.disclaimer && e('p', { class: 'disclaimer', text: str(card.disclaimer) }),
    e('p', { class: 'card-meta', lang: 'en', text: metaLine(card.meta ?? {}) }));
}

/**
 * Plain-text version of the card for read-aloud. Phone numbers are spelled digit by digit.
 * @param {ActionCard} card
 * @returns {string}
 */
export function buildPlainText(card) {
  const lines = [`${formatDomain(card.domain)}. Severity: ${severityLabel(card.severity)}.`, str(card.summary)];
  const contacts = list(card.contacts).map((c) => `${str(c.label)}: ${str(c.number).split('').join(' ')}`);
  if (contacts.length) lines.push(`Emergency contacts. ${contacts.join('. ')}.`);
  const actions = list(card.actions);
  if (actions.length) lines.push('What to do now.', ...actions.map((a, n) => `Step ${n + 1}. ${str(a.instruction)}`));
  if (list(card.redFlags).length) lines.push(`Red flags. ${card.redFlags.join('. ')}`);
  if (list(card.missingInformation).length) lines.push(`Missing information. ${card.missingInformation.join(' ')}`);
  lines.push(str(card.disclaimer));
  return lines.filter((l) => l.trim()).join('\n');
}

/**
 * Fallback shown when no Action Card could be produced: the country's emergency number.
 * @param {{ name: string, emergency: string }} country
 * @param {string} message
 * @param {Document} [doc]
 * @param {{ level?: number }} [options] Heading level of the title.
 * @returns {HTMLElement}
 */
export function renderEmergencyFallback(country, message, doc = document, { level = 3 } = {}) {
  const { e, callLink } = context(doc);
  const number = str(country.emergency);
  return e('article', { class: 'action-card fallback-card', 'aria-labelledby': 'card-title' },
    e(`h${level}`, { id: 'card-title', class: 'card-title', tabindex: '-1', text: `Emergency number for ${str(country.name)}` }),
    e('p', { class: 'summary', text: message }),
    e('p', {}, callLink({ tel: `tel:${number}`, number, label: 'Emergency (all services)' })));
}

/**
 * Decorative loading placeholder, hidden from assistive technology (status is announced separately).
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function renderSkeleton(doc = document) {
  const e = elementFactory(doc);
  return e('div', { class: 'skeleton', 'aria-hidden': 'true' }, ...['40', '70', '100', 'block', '80', '60'].map((w) => e('span', { class: `sk sk-${w}` })));
}

/* ---------- summary side card (profile-card style) ---------- */

function profile({ e, i }, { key, tone, title, sub, avatar, banner }, ...body) {
  return e('section', { class: `profile-card ${tone}`, 'aria-labelledby': `${key}-title` },
    e('div', { class: 'pc-banner' }, banner),
    e('div', { class: 'pc-head' },
      e('span', { class: 'pc-avatar', 'aria-hidden': 'true' }, i(avatar), e('span', { class: 'pc-badge' }, i('tick'))),
      e('h2', { id: `${key}-title`, class: 'pc-title', tabindex: '-1', text: title }),
      e('p', { class: 'pc-sub', text: sub })),
    ...body);
}

/** Tel link row ("notable works" style); null unless the tel value is a plain number. */
function telRow({ e, i }, c) {
  return TEL_RE.test(str(c?.tel))
    ? e('li', {}, e('a', { href: c.tel, class: 'pc-row' },
      e('span', { class: 'pc-tile', 'aria-hidden': 'true' }, i('phone')),
      e('span', { class: 'pc-row-text' },
        e('span', { class: 'pc-row-title' }, e('span', { class: 'visually-hidden', text: 'Call ' }), str(c.label)),
        e('span', { class: 'pc-row-sub', text: str(c.number) })),
      i('chevron')))
    : null;
}

const toolButton = ({ e, i }, id, iconName, label, extra = {}) =>
  e('button', { type: 'button', id, class: 'btn btn-secondary btn-sm', ...extra }, i(iconName), e('span', { text: label }));

/**
 * Compact summary of an Action Card with its tools (copy, download, read aloud, print).
 * Buttons carry fixed ids; the controller handles their clicks.
 * @param {ActionCard} card
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function renderSummaryCard(card, doc = document) {
  const ctx = context(doc);
  const { e, i, badge } = ctx;
  const sev = lookup(SEVERITY, card.severity);
  const contacts = list(card.contacts).map((c) => telRow(ctx, c)).filter(Boolean);
  const services = list(card.contacts).map((c) => str(c?.label)).filter(Boolean);
  const live = lookup(LIVE_STATUS, card.liveCheck?.status);
  const heading = (text) => e('h3', { class: 'pc-heading', text });
  const stat = (label, iconName, value) => e('div', { class: 'pc-stat' }, e('dt', { text: label }), e('dd', {}, i(iconName), value));
  return profile(ctx, {
    key: 'summary',
    tone: `sev-${sev ? card.severity : 'unknown'}`,
    title: formatDomain(card.domain),
    sub: `Severity: ${severityLabel(card.severity)} · ${card.verification?.status === 'verified' ? 'Verified' : 'Needs human review'}`,
    avatar: lookup(DOMAIN_ICONS, card.domain) ?? 'info',
    banner: e('span', { class: 'sev-pill' }, i(sev?.[1] ?? 'info'), `${severityLabel(card.severity)} severity`),
  },
  e('dl', { class: 'pc-stats' },
    stat('Facts', 'clipboard', String(list(card.facts).length)),
    stat('Actions', 'check', String(list(card.actions).length)),
    stat('Grounding', 'shield', `${pct(card.verification?.groundingScore)}%`)),
  e('div', { id: 'card-toolbar', class: 'pc-actions', role: 'group', 'aria-label': 'Share this Action Card' },
    toolButton(ctx, 'copy-btn', 'copy', 'Copy SMS'), toolButton(ctx, 'download-btn', 'download', 'Download JSON')),
  e('div', { class: 'pc-section' }, heading('About'),
    e('p', { class: 'pc-about', lang: langOf(card), dir: 'auto', text: str(card.summary) }),
    e('ul', { class: 'pc-meta' },
      card.detectedLanguage && e('li', {}, i('globe'), `Detected language: ${str(card.detectedLanguage)}`),
      e('li', {}, i('zap'), metaLine(card.meta ?? {}))),
    services.length && e('ul', { class: 'pc-tags', 'aria-label': 'Services' }, ...services.map((s) => e('li', { text: s })))),
  contacts.length && e('div', { class: 'pc-section' }, heading('Emergency contacts'), e('ul', { class: 'pc-list' }, ...contacts)),
  live && e('div', { class: 'pc-section' }, heading('Live web check'), e('p', { class: 'badge-row' }, badge(live)), sourceList(ctx, card.liveCheck)),
  e('div', { class: 'pc-actions', role: 'group', 'aria-label': 'Listen or print' },
    toolButton(ctx, 'speak-btn', 'volume', 'Read aloud', { 'aria-pressed': 'false' }), toolButton(ctx, 'print-btn', 'printer', 'Print')));
}
