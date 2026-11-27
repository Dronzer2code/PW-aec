/** Output languages offered in the UI. `code` is a BCP-47 tag used for `lang` and speech synthesis. */
export interface Language {
  readonly code: string;
  readonly name: string;
  readonly nativeName: string;
}

export const LANGUAGES: readonly Language[] = Object.freeze([
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
]);

export const LANGUAGE_CODES = ['en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur', 'es', 'fr', 'ar'] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/** English name of a supported language code; falls back to English. */
export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? 'English';
}
