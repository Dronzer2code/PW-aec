/**
 * Pure DOM builders for the workspace pages (lists, grids, breadcrumb, progress).
 * Same safety rules as render.js: text via textContent only, tel links validated.
 */
import { elementFactory, formatDomain, icon, safeTel, severityLabel } from '../render.js';

const SEV_ICONS = { critical: 'alert', high: 'warn', moderate: 'info', low: 'check' };
const INPUT_LABELS = { text: ['Text', 'text'], photo: ['Photo', 'camera'], voice: ['Voice', 'mic'], live: ['Live web check', 'globe'] };
export const PROGRESS_STEPS = Object.freeze(['Reading input', 'Structuring with Gemini', 'Verifying']);

const own = (map, key) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : undefined);
const sevKey = (card) => (own(SEV_ICONS, card?.severity) ? card.severity : 'unknown');
const cardHref = (id) => `/app/cards/${encodeURIComponent(id)}`;

/**
 * Short relative time, e.g. `just now`, `5 min ago`, `2 h ago`.
 * @param {number} then @param {number} now
 * @returns {string}
 */
export function relativeTime(then, now) {
  const min = Math.floor(Math.max(0, now - then) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

function tools(doc) {
  const e = elementFactory(doc);
  const i = (name) => icon(doc, name);
  const sevIcon = (card) => e('span', { class: `sev-icon sev-${sevKey(card)}`, 'aria-hidden': 'true' }, i(own(SEV_ICONS, card?.severity) ?? 'info'));
  return { e, i, sevIcon };
}

/**
 * Sidebar "Recent" entries: links to cards created in this tab.
 * @param {{ id: string, card: any }[]} entries Newest first.
 * @param {Document} [doc]
 * @returns {HTMLLIElement[]}
 */
export function renderRecentItems(entries, doc = document) {
  const { e, sevIcon } = tools(doc);
  return entries.map(({ id, card }) => e('li', {},
    e('a', { href: cardHref(id), 'data-link': '', class: 'recent-item' }, sevIcon(card),
      e('span', { class: 'recent-text' },
        e('span', { class: 'visually-hidden', text: `${severityLabel(card?.severity)} severity: ` }),
        `${formatDomain(card?.domain)} — ${String(card?.summary ?? '')}`))));
}

/**
 * The /app/cards list, or an empty state with a call to action.
 * @param {{ id: string, createdAt: number, card: any }[]} entries
 * @param {number} now
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function renderCardList(entries, now, doc = document) {
  const { e, i, sevIcon } = tools(doc);
  if (!entries.length) {
    return e('div', { class: 'empty' },
      e('span', { class: 'empty-icon', 'aria-hidden': 'true' }, i('doc')),
      e('h2', { class: 'empty-title', text: 'No Action Cards yet' }),
      e('p', { text: 'Cards you create appear here until you close this tab.' }),
      e('a', { href: '/app', 'data-link': '', class: 'btn btn-dark' }, i('plus'), 'Create an Action Card'));
  }
  return e('ul', { class: 'card-list' }, ...entries.map(({ id, createdAt, card }) => {
    const verified = card?.verification?.status === 'verified';
    return e('li', {}, e('a', { href: cardHref(id), 'data-link': '', class: 'card-row' },
      sevIcon(card),
      e('span', { class: 'card-row-body' },
        e('span', { class: 'card-row-head' },
          e('h2', { class: 'card-row-title', text: formatDomain(card?.domain) }),
          e('span', { class: `badge badge-severity sev-${sevKey(card)}`, text: `Severity: ${severityLabel(card?.severity)}` })),
        e('span', { class: 'card-row-summary', dir: 'auto', text: String(card?.summary ?? '') }),
        e('span', { class: 'card-row-meta', text: `${relativeTime(createdAt, now)} · ${verified ? 'Verified' : 'Needs review'}` })),
      i('chevron')));
  }));
}

/**
 * Suggestion cards under the composer ("Try sample →").
 * @param {readonly { id: string, title: string, icon: string }[]} samples
 * @param {Document} [doc]
 * @returns {HTMLLIElement[]}
 */
export function renderSuggestions(samples, doc = document) {
  const { e, i } = tools(doc);
  return samples.map((s) => e('li', { class: 'suggest-item', 'data-search': s.title },
    e('button', { type: 'button', class: 'suggest', 'data-sample': s.id },
      e('span', { class: 'suggest-head' }, e('span', { class: `tile tile-${s.icon}`, 'aria-hidden': 'true' }, i(s.icon)), e('span', { class: 'suggest-title', text: s.title })),
      e('span', { class: 'suggest-foot' }, 'Try sample', i('arrow')))));
}

/**
 * The /app/samples grid.
 * @param {readonly { id: string, title: string, description: string, inputs: string[], icon: string }[]} samples
 * @param {Document} [doc]
 * @returns {HTMLLIElement[]}
 */
export function renderSampleGrid(samples, doc = document) {
  const { e, i } = tools(doc);
  return samples.map((s) => e('li', { class: 'sample-card', 'data-search': `${s.title} ${s.description}` },
    e('span', { class: `tile tile-${s.icon}`, 'aria-hidden': 'true' }, i(s.icon)),
    e('h2', { class: 'sample-title', text: s.title }),
    e('p', { class: 'sample-desc', text: s.description }),
    e('ul', { class: 'input-tags', 'aria-label': 'Inputs' }, ...s.inputs.map((k) => {
      const [label, iconName] = own(INPUT_LABELS, k) ?? INPUT_LABELS.text;
      return e('li', {}, i(iconName), label);
    })),
    e('button', { type: 'button', class: 'btn btn-light', 'data-sample': s.id },
      'Use this sample', e('span', { class: 'visually-hidden', text: `: ${s.title}` }), i('arrow'))));
}

/**
 * Large call cards for the verified directory of one country.
 * @param {{ label: string, number: string, tel: string }[]} contacts From `directoryFor`.
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function renderCallGrid(contacts, doc = document) {
  const { e, i } = tools(doc);
  return e('ul', { class: 'call-grid' }, ...contacts.filter((c) => safeTel(c.tel)).map((c, n) =>
    e('li', {}, e('a', { href: safeTel(c.tel), class: n === 0 ? 'call-card call-card-main' : 'call-card' },
      e('span', { class: 'call-icon', 'aria-hidden': 'true' }, i('phone')),
      e('span', { class: 'call-label' }, e('span', { class: 'visually-hidden', text: 'Call ' }), c.label),
      e('span', { class: 'call-number', text: c.number })))));
}

/**
 * Breadcrumb where every crumb is a real link; the last one is the current page.
 * @param {{ label: string, href: string }[]} crumbs
 * @param {Document} [doc]
 * @returns {HTMLOListElement}
 */
export function renderBreadcrumb(crumbs, doc = document) {
  const { e } = tools(doc);
  return e('ol', {}, ...crumbs.map((c, n) => e('li', {},
    e('a', { href: c.href, 'data-link': '', 'aria-current': n === crumbs.length - 1 ? 'page' : undefined, text: c.label }))));
}

/**
 * Submit progress: steps before `active` are done, `active` is in progress.
 * @param {number} active Index into PROGRESS_STEPS.
 * @param {Document} [doc]
 * @returns {HTMLOListElement}
 */
export function renderProgress(active, doc = document) {
  const { e, i } = tools(doc);
  return e('ol', { class: 'progress', 'aria-label': 'Progress' }, ...PROGRESS_STEPS.map((label, n) => {
    const stateName = n < active ? 'done' : n === active ? 'active' : 'pending';
    return e('li', { class: `step step-${stateName}`, 'aria-current': n === active ? 'step' : undefined },
      e('span', { class: 'step-dot', 'aria-hidden': 'true' }, n < active && i('tick')),
      label, e('span', { class: 'visually-hidden', text: { done: ' (done)', active: ' (in progress)', pending: '' }[stateName] }));
  }));
}
