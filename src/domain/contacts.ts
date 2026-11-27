import type { EmergencyContact, Service } from './schema.js';

/**
 * Verified Emergency Contact directory.
 *
 * This table is the ONLY source of phone numbers in LifeBridge. The model is
 * never allowed to supply a number; it only names the services it needs and
 * the server resolves them here. Review this data when adding a country.
 */
export const COUNTRY_CODES = ['IN', 'US', 'GB', 'EU', 'AU'] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

export interface CountryInfo {
  readonly code: CountryCode;
  readonly name: string;
  readonly numbers: Readonly<Partial<Record<Service, string>>> & { readonly general_emergency: string };
}

export const SERVICE_LABELS: Readonly<Record<Service, string>> = Object.freeze({
  general_emergency: 'Emergency (all services)',
  ambulance: 'Ambulance',
  police: 'Police',
  fire: 'Fire brigade',
  disaster: 'Disaster helpline',
  child_helpline: 'Child helpline',
  women_helpline: 'Women helpline',
});

export const DIRECTORY: Readonly<Record<CountryCode, CountryInfo>> = Object.freeze({
  IN: {
    code: 'IN',
    name: 'India',
    numbers: {
      general_emergency: '112',
      ambulance: '108',
      police: '100',
      fire: '101',
      disaster: '1078',
      child_helpline: '1098',
      women_helpline: '181',
    },
  },
  US: { code: 'US', name: 'United States', numbers: { general_emergency: '911' } },
  GB: { code: 'GB', name: 'United Kingdom', numbers: { general_emergency: '999' } },
  EU: { code: 'EU', name: 'European Union', numbers: { general_emergency: '112', child_helpline: '116111' } },
  AU: { code: 'AU', name: 'Australia', numbers: { general_emergency: '000' } },
});

/** Number for a service in a country, falling back to the general emergency number. */
export function numberFor(country: CountryCode, service: Service): string {
  const info = DIRECTORY[country];
  return info.numbers[service] ?? info.numbers.general_emergency;
}

/** Every number LifeBridge considers legitimate for a country (used by the phone number guard). */
export function allowedNumbers(country: CountryCode): ReadonlySet<string> {
  return new Set(Object.values(DIRECTORY[country].numbers));
}

/**
 * Resolves requested services into de-duplicated Emergency Contacts.
 * `general_emergency` is always first. Services whose number equals one already
 * listed (e.g. 911 for every US service) are merged to keep the list short.
 */
export function resolveContacts(country: CountryCode, services: readonly Service[]): EmergencyContact[] {
  const ordered: Service[] = ['general_emergency', ...services.filter((s) => s !== 'general_emergency')];
  const seenNumbers = new Set<string>();
  const contacts: EmergencyContact[] = [];
  for (const service of ordered) {
    const number = numberFor(country, service);
    if (seenNumbers.has(number)) continue;
    seenNumbers.add(number);
    contacts.push({ service, label: SERVICE_LABELS[service], number, tel: `tel:${number}` });
  }
  return contacts;
}

export function listCountries(): { code: CountryCode; name: string; emergency: string }[] {
  return COUNTRY_CODES.map((code) => ({
    code,
    name: DIRECTORY[code].name,
    emergency: DIRECTORY[code].numbers.general_emergency,
  }));
}
