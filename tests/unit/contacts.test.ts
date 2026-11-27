import { describe, expect, it } from 'vitest';
import {
  allowedNumbers,
  COUNTRY_CODES,
  DIRECTORY,
  listCountries,
  numberFor,
  resolveContacts,
  SERVICE_LABELS,
} from '../../src/domain/contacts.js';
import { SERVICES } from '../../src/domain/schema.js';

describe('numberFor', () => {
  it('returns the service-specific number when the country has one', () => {
    expect(numberFor('IN', 'ambulance')).toBe('108');
    expect(numberFor('IN', 'women_helpline')).toBe('181');
    expect(numberFor('EU', 'child_helpline')).toBe('116111');
  });

  it('falls back to the general emergency number', () => {
    expect(numberFor('US', 'ambulance')).toBe('911');
    expect(numberFor('GB', 'fire')).toBe('999');
    expect(numberFor('AU', 'police')).toBe('000');
    expect(numberFor('EU', 'police')).toBe('112');
  });
});

describe('resolveContacts', () => {
  it('always puts general_emergency first, even when not requested', () => {
    const contacts = resolveContacts('IN', ['police', 'ambulance']);
    expect(contacts.map((c) => c.service)).toEqual(['general_emergency', 'police', 'ambulance']);
    expect(contacts[0]).toEqual({
      service: 'general_emergency',
      label: SERVICE_LABELS.general_emergency,
      number: '112',
      tel: 'tel:112',
    });
  });

  it('does not duplicate general_emergency when it is requested explicitly', () => {
    const contacts = resolveContacts('IN', ['ambulance', 'general_emergency', 'ambulance']);
    expect(contacts.map((c) => c.service)).toEqual(['general_emergency', 'ambulance']);
  });

  it('merges services that share a number (US: one 911 entry)', () => {
    const contacts = resolveContacts('US', ['ambulance', 'police', 'fire']);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.number).toBe('911');
  });

  it('returns only the general emergency contact for an empty service list', () => {
    expect(resolveContacts('GB', [])).toEqual([
      { service: 'general_emergency', label: 'Emergency (all services)', number: '999', tel: 'tel:999' },
    ]);
  });

  it('builds tel: links that match the number for every country and service', () => {
    for (const country of COUNTRY_CODES) {
      for (const c of resolveContacts(country, SERVICES)) {
        expect(c.tel).toBe(`tel:${c.number}`);
        expect(c.number).toMatch(/^\d{3,6}$/);
      }
    }
  });
});

describe('allowedNumbers', () => {
  it('contains every directory number of the country and nothing else', () => {
    expect([...allowedNumbers('IN')].sort()).toEqual(['100', '101', '1078', '108', '1098', '112', '181']);
    expect([...allowedNumbers('US')]).toEqual(['911']);
    expect(allowedNumbers('US').has('112')).toBe(false);
  });
});

describe('listCountries', () => {
  it('lists every supported country with its general emergency number', () => {
    const countries = listCountries();
    expect(countries.map((c) => c.code)).toEqual([...COUNTRY_CODES]);
    expect(countries).toContainEqual({ code: 'IN', name: 'India', emergency: '112' });
    expect(countries).toContainEqual({ code: 'US', name: 'United States', emergency: '911' });
  });

  it('has a directory entry for every listed country', () => {
    for (const code of COUNTRY_CODES) expect(DIRECTORY[code].code).toBe(code);
  });
});
