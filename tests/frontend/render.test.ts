// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DIRECTORY as SERVER_DIRECTORY, SERVICE_LABELS as SERVER_LABELS } from '../../src/domain/contacts.js';
import {
  DIRECTORY,
  SERVICE_LABELS,
  buildPlainText,
  directoryFor,
  formatActor,
  formatDomain,
  formatTimeframe,
  renderActionCard,
  renderDirectoryCard,
  renderEmergencyFallback,
  renderSkeleton,
  renderSummaryCard,
  safeHttpUrl,
  severityLabel,
} from '../../public/js/render.js';
import { makeCard } from './fixtures.js';

const XSS = '<img src=x onerror=alert(1)>';

function sectionByTitle(root: HTMLElement, title: string): HTMLElement {
  const heading = Array.from(root.querySelectorAll('h4')).find((h) => h.textContent?.startsWith(title));
  if (!heading) throw new Error(`Section "${title}" not rendered`);
  return heading.parentElement as HTMLElement;
}

describe('label helpers', () => {
  it('maps enum values to readable labels with safe fallbacks', () => {
    expect(severityLabel('critical')).toBe('Critical');
    expect(severityLabel('low')).toBe('Low');
    expect(severityLabel('constructor')).toBe('Unknown');
    expect(formatTimeframe('within_1_hour')).toBe('Within 1 hour');
    expect(formatTimeframe('bogus')).toBe('When possible');
    expect(formatActor('bystander')).toBe('Bystander');
    expect(formatActor('__proto__')).toBe('Anyone');
    expect(formatDomain('road_accident')).toBe('Road accident');
    expect(formatDomain('nope')).toBe('General situation');
  });

  it('only accepts absolute http(s) URLs', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeHttpUrl('/relative')).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe('renderActionCard', () => {
  it('renders every section of the Action Card', () => {
    const root = renderActionCard(makeCard());
    expect(root.tagName).toBe('ARTICLE');
    expect(root.querySelector('#card-title')?.textContent).toBe('Road accident');
    expect(root.querySelector('#card-title')?.getAttribute('tabindex')).toBe('-1');
    expect(root.querySelector('.summary')?.textContent).toContain('unconscious');
    for (const title of [
      'Emergency contacts',
      'What to do now',
      'Red flags',
      'Facts extracted',
      'Missing information',
      'Live web check',
      'Nearby services',
    ]) {
      expect(sectionByTitle(root, title)).toBeTruthy();
    }
    expect(root.querySelectorAll('ol.action-list > li')).toHaveLength(3);
    expect(root.querySelectorAll('.fact')).toHaveLength(3);
    expect(root.querySelectorAll('details')).toHaveLength(2);
    expect(root.querySelector('.disclaimer')?.textContent).toContain('not a substitute');
    expect(root.querySelector('.card-meta')?.textContent).toBe('Model gemini-flash-latest · Fresh result · 2140 ms · Ref req-123');
  });

  it('conveys severity and verification with text, not colour alone', () => {
    const root = renderActionCard(makeCard());
    const severity = root.querySelector('.badge-severity');
    expect(severity?.textContent).toBe('Severity: Critical');
    expect(severity?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.textContent).toContain('Needs human review');
    expect(root.textContent).toContain('Evidence grounding 67%');
    expect(root.querySelector('.review-banner')).not.toBeNull();

    const verified = renderActionCard(
      makeCard({ severity: 'low', verification: { status: 'verified', groundingScore: 1, checks: [] } }),
    );
    expect(verified.textContent).toContain('Verified');
    expect(verified.textContent).toContain('Severity: Low');
    expect(verified.querySelector('.review-banner')).toBeNull();
  });

  it('renders emergency contacts as tel: links with clear labels', () => {
    const links = Array.from(renderActionCard(makeCard()).querySelectorAll<HTMLAnchorElement>('a.call-btn'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['tel:112', 'tel:108']);
    expect(links[0]?.textContent).toBe('Call 112 — Emergency (all services)');
  });

  it('drops contacts whose tel value is not a plain phone number', () => {
    const card = makeCard({
      contacts: [{ service: 'police', label: 'Police', number: '100', tel: 'javascript:alert(1)' }],
    });
    const root = renderActionCard(card);
    expect(root.querySelector('a.call-btn')).toBeNull();
    expect(root.textContent).not.toContain('Emergency contacts');
  });

  it('shows actor, timeframe and safety flags for each action', () => {
    const root = renderActionCard(makeCard());
    const [first, , third] = Array.from(root.querySelectorAll('.action'));
    expect(first?.textContent).toContain('Who: You');
    expect(first?.textContent).toContain('When: Immediately');
    expect(first?.textContent).toContain('Added by safety check');
    expect(first?.querySelector('.chip-urgent')).not.toBeNull();
    expect(third?.textContent).toContain('Dosage removed');
    expect(third?.textContent).toContain('Unverified number removed');
    expect(third?.querySelector('.action-why')).toBeNull();
  });

  it('labels fact verification status and quotes evidence', () => {
    const facts = Array.from(renderActionCard(makeCard()).querySelectorAll('.fact'));
    expect(facts[0]?.textContent).toContain('Matched in your input');
    expect(facts[0]?.querySelector('q')?.textContent).toBe('sir se bahut khoon beh raha hai');
    expect(facts[1]?.classList.contains('fact-review')).toBe(true);
    expect(facts[1]?.textContent).toContain('Not found in input — please confirm');
    expect(facts[1]?.textContent).toContain('Needs review');
    expect(facts[2]?.textContent).toContain('Read from audio/image');
    expect(facts[2]?.textContent).toContain('Confidence 80%');
  });

  it('renders malicious model text as inert text', () => {
    const card = makeCard({
      summary: XSS,
      sourceText: XSS,
      redFlags: [XSS],
      facts: [{ label: XSS, value: XSS, evidence: XSS, confidence: 0.9, status: 'grounded', needsReview: false }],
      actions: [{ instruction: XSS, rationale: XSS, actor: 'caller', timeframe: 'immediately', flags: [] }],
      liveCheck: { status: 'inconclusive', note: XSS, sources: [{ title: XSS, url: 'https://ok.example.com' }] },
    });
    const root = renderActionCard(card);
    document.body.replaceChildren(root);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelectorAll('[onerror]')).toHaveLength(0);
    expect(root.querySelector('.summary')?.textContent).toBe(XSS);
    expect(root.querySelector('.action-text')?.textContent).toBe(XSS);
    expect(root.querySelector('.fact-label')?.textContent).toBe(XSS);
    expect(root.querySelector('.ext-link')?.textContent).toContain(XSS);
  });

  it('never links non-http(s) live check sources or maps links', () => {
    const card = makeCard({
      liveCheck: {
        status: 'contradicted',
        note: 'Official sources say otherwise.',
        sources: [
          { title: 'Evil', url: 'javascript:alert(document.cookie)' },
          { title: 'Data', url: 'data:text/html,<script>alert(1)</script>' },
          { title: 'Official', url: 'https://gov.example.org/advisory' },
        ],
      },
      mapsLinks: [{ label: 'Bad', url: 'javascript:alert(1)' }],
    });
    const root = renderActionCard(card);
    const live = sectionByTitle(root, 'Live web check');
    const anchors = Array.from(live.querySelectorAll('a'));
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute('href')).toBe('https://gov.example.org/advisory');
    expect(anchors[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchors[0]?.getAttribute('target')).toBe('_blank');
    expect(live.textContent).toContain('Contradicted by live web sources');
    expect(root.querySelectorAll('a[href^="javascript"], a[href^="data"]')).toHaveLength(0);
    expect(root.textContent).not.toContain('Nearby services');
  });

  it('omits the live check section when it was skipped', () => {
    const root = renderActionCard(makeCard({ liveCheck: { status: 'skipped', note: '', sources: [] } }));
    expect(root.textContent).not.toContain('Live web check');
  });

  it('sets lang to the output language and falls back for invalid tags', () => {
    const base = makeCard();
    const hindi = renderActionCard(makeCard({ meta: { ...base.meta, outputLanguage: 'hi' } }));
    expect(hindi.lang).toBe('hi');
    expect(hindi.dir).toBe('ltr');
    for (const rtl of ['ar', 'ur']) {
      expect(renderActionCard(makeCard({ meta: { ...base.meta, outputLanguage: rtl } })).dir).toBe('rtl');
    }
    expect(renderActionCard(makeCard({ meta: { ...base.meta, outputLanguage: '"><x' } })).lang).toBe('en');
  });

  it('tolerates missing optional arrays', () => {
    const partial = { ...makeCard(), facts: undefined, redFlags: null } as unknown as ReturnType<typeof makeCard>;
    const root = renderActionCard(partial);
    expect(root.querySelector('.fact')).toBeNull();
    expect(root.textContent).not.toContain('Red flags');
  });
});

describe('buildPlainText', () => {
  it('produces a read-aloud script with severity, steps and spelled-out numbers', () => {
    const text = buildPlainText(makeCard());
    expect(text).toContain('Road accident. Severity: Critical.');
    expect(text).toContain('Emergency (all services): 1 1 2');
    expect(text).toContain('Step 1. Call 112');
    expect(text).toContain('Step 2. Press a clean cloth');
    expect(text).toContain('Red flags. Breathing stops');
    expect(text).toContain('Missing information.');
    expect(text).toContain('not a substitute');
    expect(text).not.toContain('<');
  });
});

describe('fallback and skeleton', () => {
  it('renders the country emergency number when the AI is unavailable', () => {
    const el = renderEmergencyFallback({ name: 'United States', emergency: '911' }, 'AI unavailable.');
    expect(el.querySelector('#card-title')?.textContent).toBe('Emergency number for United States');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('tel:911');
    expect(el.querySelector('a')?.textContent).toContain('Call 911');
  });

  it('hides the skeleton from assistive technology', () => {
    expect(renderSkeleton().getAttribute('aria-hidden')).toBe('true');
  });
});

describe('verified directory mirror', () => {
  it('matches the server directory exactly (numbers, order and labels)', () => {
    expect(Object.keys(DIRECTORY)).toEqual(Object.keys(SERVER_DIRECTORY));
    for (const [code, info] of Object.entries(SERVER_DIRECTORY)) {
      expect(DIRECTORY[code]).toEqual(Object.entries(info.numbers));
    }
    expect(SERVICE_LABELS).toEqual(SERVER_LABELS);
  });

  it('uses the full list only when the general number agrees with /api/config', () => {
    expect(directoryFor({ code: 'IN', emergency: '112' }).map((c) => c.number)).toEqual(['112', '108', '100', '101', '1078', '1098', '181']);
    expect(directoryFor({ code: 'IN', emergency: '999' })).toEqual([
      { service: 'general_emergency', label: 'Emergency (all services)', number: '999', tel: 'tel:999' },
    ]);
    expect(directoryFor({ code: '__proto__', emergency: '911' })).toHaveLength(1);
  });
});

describe('renderDirectoryCard', () => {
  it('lists verified numbers as tel links and states their source', () => {
    const el = renderDirectoryCard({ name: 'India' }, directoryFor({ code: 'IN', emergency: '112' }));
    expect(el.querySelector('#directory-title')?.textContent).toBe('Emergency numbers');
    expect(el.querySelector('.pc-sub')?.textContent).toBe('India · Verified directory');
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.pc-row'));
    expect(links).toHaveLength(7);
    expect(links[0]?.getAttribute('href')).toBe('tel:112');
    expect(links[0]?.textContent).toBe('Call Emergency (all services)112');
    expect(el.textContent).toContain('never from the AI');
  });

  it('drops rows whose tel value is not a plain number', () => {
    const el = renderDirectoryCard({ name: 'X' }, [{ label: 'Bad', number: '1', tel: 'javascript:alert(1)' }]);
    expect(el.querySelector('a')).toBeNull();
  });
});

describe('renderSummaryCard', () => {
  it('summarises severity, stats, contacts and tools', () => {
    const el = renderSummaryCard(makeCard());
    expect(el.className).toBe('profile-card sev-critical');
    expect(el.querySelector('#summary-title')?.textContent).toBe('Road accident');
    expect(el.querySelector('.sev-pill')?.textContent).toBe('Critical severity');
    expect(el.querySelector('.pc-sub')?.textContent).toBe('Severity: Critical · Needs human review');
    expect(Array.from(el.querySelectorAll('.pc-stat')).map((s) => s.textContent)).toEqual(['Facts3', 'Actions3', 'Grounding67%']);
    expect(Array.from(el.querySelectorAll('a.pc-row')).map((a) => a.getAttribute('href'))).toEqual(['tel:112', 'tel:108']);
    expect(Array.from(el.querySelectorAll('.pc-tags li')).map((l) => l.textContent)).toEqual(['Emergency (all services)', 'Ambulance']);
    for (const id of ['copy-btn', 'download-btn', 'speak-btn', 'print-btn']) expect(el.querySelector(`#${id}`)?.tagName).toBe('BUTTON');
    expect(el.querySelector('#speak-btn')?.getAttribute('aria-pressed')).toBe('false');
    expect(el.textContent).toContain('Detected language: Hindi + English');
    expect(el.textContent).toContain('Corroborated by live web sources');
    expect(el.querySelector('.pc-about')?.getAttribute('lang')).toBe('en');
  });

  it('handles verified, unknown and sparse cards safely', () => {
    const verified = renderSummaryCard(
      makeCard({ severity: 'low', domain: 'fire', verification: { status: 'verified', groundingScore: 1, checks: [] } }),
    );
    expect(verified.className).toBe('profile-card sev-low');
    expect(verified.textContent).toContain('Verified');
    const sparse = renderSummaryCard({
      ...makeCard(),
      severity: 'bogus',
      domain: 'nope',
      detectedLanguage: '',
      contacts: [{ service: 'police', label: XSS, number: '1', tel: 'javascript:alert(1)' }],
      liveCheck: { status: 'skipped', note: '', sources: [] },
      meta: undefined,
    } as unknown as ReturnType<typeof makeCard>);
    expect(sparse.className).toBe('profile-card sev-unknown');
    expect(sparse.querySelector('#summary-title')?.textContent).toBe('General situation');
    expect(sparse.querySelector('a[href^="javascript"]')).toBeNull();
    expect(sparse.querySelector('img')).toBeNull();
    expect(sparse.textContent).not.toContain('Live web check');
    expect(sparse.textContent).not.toContain('Detected language');
  });
});
