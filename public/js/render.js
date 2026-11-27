/**
 * Pure DOM builders for the Action Card.
 * Security: data is written only via textContent or fixed attribute names (never innerHTML),
 * and links are limited to http(s) and plain `tel:` numbers, so model output cannot inject markup.
 * @typedef {import('../../src/domain/schema.js').ActionCard} ActionCard
 */

const TEL_RE = /^tel:\+?\d{2,15}$/;
const LANG_RE = /^[a-z]{2,3}(-[a-z\d]{2,8})*$/i;
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

function icon(doc, name) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  for (const [k, v] of [['class', 'icon'], ['viewBox', '0 0 24 24'], ['aria-hidden', 'true'], ['focusable', 'false']]) svg.setAttribute(k, v);
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

/** All builders share one context: `e` creates elements, `i` creates icons. */
function context(doc) {
  const e = elementFactory(doc);
  const i = (name) => icon(doc, name);
  const badge = ([label, tone, iconName]) => e('span', { class: `badge tone-${tone}`, lang: 'en' }, iconName && i(iconName), label);
  const section = (key, title, ...content) =>
    e('section', { class: `card-section section-${key}`, 'aria-labelledby': `card-sec-${key}` },
      e('h4', { id: `card-sec-${key}`, class: 'section-title', lang: 'en', text: title }), ...content);
  const extLink = (href, text) =>
    e('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'ext-link' }, text, i('external'),
      e('span', { class: 'visually-hidden', lang: 'en', text: ' (opens in a new tab)' }));
  const callLink = (c) =>
    TEL_RE.test(str(c?.tel))
      ? e('a', { href: c.tel, class: 'call-btn' }, i('phone'), e('span', { lang: 'en', text: `Call ${str(c.number)} — ${str(c.label)}` }))
      : null;
  return { e, i, badge, section, extLink, callLink };
}

function header({ e, i, badge }, card) {
  const sev = lookup(SEVERITY, card.severity);
  const verified = card.verification?.status === 'verified';
  return e('header', { class: 'card-header' },
    e('p', { class: 'card-eyebrow', lang: 'en', text: 'Action Card' }),
    e('h3', { id: 'card-title', class: 'card-title', tabindex: '-1', lang: 'en', text: formatDomain(card.domain) }),
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
  const sources = list(live.sources).map((s) => [safeHttpUrl(s?.url), str(s?.title)]).filter(([href]) => href);
  return section('live', 'Live web check (Google Search)',
    e('p', { class: 'badge-row' }, badge(status)),
    live.note && e('p', { class: 'live-note', text: str(live.note) }),
    sources.length && e('ul', { class: 'link-list' }, ...sources.map(([href, title]) => e('li', {}, extLink(href, title || new URL(href).hostname)))));
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
 * @returns {HTMLElement}
 */
export function renderActionCard(card, doc = document) {
  const ctx = context(doc);
  const { e, i, badge, section, extLink, callLink } = ctx;
  const lang = str(card.meta?.outputLanguage);
  const contacts = list(card.contacts).map(callLink).filter(Boolean);
  const actions = list(card.actions);
  const facts = list(card.facts);
  const maps = list(card.mapsLinks).map((l) => [safeHttpUrl(l?.url), str(l?.label) || 'Open in Google Maps']).filter(([href]) => href);
  const checks = list(card.verification?.checks);
  const meta = card.meta ?? {};
  const metaText = [
    meta.model && `Model ${str(meta.model)}`,
    meta.cached ? 'Cached result' : 'Fresh result',
    Number.isFinite(meta.latencyMs) && `${Math.round(meta.latencyMs)} ms`,
    meta.requestId && `Ref ${str(meta.requestId)}`,
  ].filter(Boolean).join(' · ');

  return e('article', {
    class: `action-card sev-${lookup(SEVERITY, card.severity) ? card.severity : 'unknown'}`,
    lang: LANG_RE.test(lang) ? lang : 'en',
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
    e('p', { class: 'card-meta', lang: 'en', text: metaText }));
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
 * @returns {HTMLElement}
 */
export function renderEmergencyFallback(country, message, doc = document) {
  const { e, callLink } = context(doc);
  const number = str(country.emergency);
  return e('article', { class: 'action-card fallback-card', 'aria-labelledby': 'card-title' },
    e('h3', { id: 'card-title', class: 'card-title', tabindex: '-1', text: `Emergency number for ${str(country.name)}` }),
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
