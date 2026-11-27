# MVP.md — LifeBridge

## PURPOSE

Defines the minimum version of LifeBridge that MUST be built and deployed for the hackathon submission. Product definition lives in `docs/PRD.md`; implementation details live in `docs/TRD.md`.

## MVP GOAL

A deployed Cloud Run web app where a user submits a messy Intake (text, voice, image, or PDF) and receives a verified Action Card within one request, backed by a public GitHub repo with passing tests and CI.

## MUST HAVE (MVP)

| ID | Feature | PRD ref |
|---|---|---|
| M-1 | Text Intake (any language) | FR-1 |
| M-2 | Voice recording via MediaRecorder → sent as audio to Gemini | FR-2 |
| M-3 | Image + PDF upload (max 4 files, 5 MB each) | FR-3 |
| M-4 | `POST /api/analyze` calling Gemini with JSON schema output | FR-4 |
| M-5 | Action Card rendering (domain, severity, summary, Facts, Actions, red flags, missing info, contacts) | FR-5 |
| M-6 | Verification Engine (schema, evidence grounding, safety rules, contact resolution, injection flag) | FR-6, FR-7, FR-11 |
| M-7 | Output language selector | FR-8 |
| M-8 | Read aloud, copy SMS text, download JSON, print | FR-9 |
| M-9 | Sample Intakes (4 buttons) | FR-12 |
| M-10 | Security middleware: helmet CSP, rate limit, body size limit, validation | NFR-1 |
| M-11 | Accessible UI (semantic HTML, labels, live regions, keyboard, focus, contrast) | NFR-2 |
| M-12 | Response cache (LRU, SHA-256 key) + compression | NFR-3 |
| M-13 | Vitest unit + integration tests, coverage ≥ 80% | NFR-4 |
| M-14 | Dockerfile (non-root) + Cloud Run deploy instructions | — |
| M-15 | GitHub Actions CI: lint, typecheck, test | NFR-4, NFR-5 |
| M-16 | `GET /healthz` health endpoint | — |

## SHOULD HAVE (after MVP is deployed)

- S-1: Opt-in geolocation → Google Maps "nearby" links (FR-10).
- S-2: Human confirmation checkboxes per Fact flagged `needs_review`.
- S-3: Frontend unit tests for pure rendering helpers.

## WON'T HAVE

See `docs/PRD.md` § OUT OF SCOPE.

## SAMPLE INTAKES (exact content defined in `public/js/samples.js`)

1. Roadside accident (text, mixed Hindi-English, panicked).
2. Messy medical history (text with medication list, allergies, conditions, inconsistent formatting).
3. Flood warning forwarded message + personal situation (text).
4. Elderly person chest pain report (text).

## DONE DEFINITION

- `npm run lint`, `npm run typecheck`, `npm test` all pass locally and in CI.
- Container builds and runs with `GEMINI_API_KEY` set.
- Deployed URL renders, all four samples return Action Cards.
- README explains problem, solution, architecture, criteria mapping, run, test, deploy.
