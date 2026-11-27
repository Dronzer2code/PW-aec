import { Router } from 'express';
import { listCountries } from '../domain/contacts.js';
import { LANGUAGES } from '../domain/languages.js';
import { MAX_FILE_BYTES, MAX_FILES, MAX_TEXT_CHARS } from '../domain/schema.js';

/** `GET /api/config` — public UI configuration (no secrets). */
export function configRouter(options: { aiAvailable: boolean }): Router {
  const router = Router();
  const payload = Object.freeze({
    languages: LANGUAGES,
    countries: listCountries(),
    aiAvailable: options.aiAvailable,
    limits: { maxTextChars: MAX_TEXT_CHARS, maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES },
  });

  router.get('/config', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(payload);
  });
  return router;
}
