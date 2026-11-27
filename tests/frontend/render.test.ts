// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildPlainText,
  formatActor,
  formatDomain,
  formatTimeframe,
  renderActionCard,
  renderEmergencyFallback,
  renderSkeleton,
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
