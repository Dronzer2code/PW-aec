# PRD.md — LifeBridge

## PURPOSE

Defines WHAT LifeBridge is, WHY it exists, and WHAT it must do.
Read this first. Related documents:

- `docs/MVP.md` → minimum scope that must ship for the hackathon submission.
- `docs/TRD.md` → technical implementation (stack, APIs, schemas, security).
- `docs/PROCESS_FLOW.md` → request pipeline and user journey.
- `AGENT.md` → rules for how these documents are written.

## CONTEXT

- Event: Hack2skill "PromptWars x Hoollow" hackathon.
- Challenge statement (verbatim): "Build a Gemini-powered App that solves for societal benefit by acting as a universal bridge between human intent and complex systems. Participants must create a functional interface that takes unstructured, messy, real-world inputs that can be anything (voice, traffic, weather, news, photos or a messy stack of medical history) and instantly converts them into structured, verified, and life-saving actions."
- Submission: public GitHub repository + deployed Google Cloud Run URL + LinkedIn post.
- Submission is scored by an AI evaluator on: Code Quality, Security, Efficiency, Testing, Accessibility, Problem Statement Alignment. Each parameter is a design requirement for this project.
- Submission attempts allowed: 2. Closing date: 2026-12-09 17:00 IST.

## PROBLEM

In an emergency or health crisis, the information people have is messy: a panicked voice note, a photo of a prescription, a forwarded flood warning, a pile of old lab reports. Emergency services, hospitals, and caregivers need structured facts: what happened, how severe it is, which actions to take, and whom to call. That translation is slow and error-prone exactly when time matters most. Generic chatbots answer in free text, invent facts, and give no indication of which statements are grounded in the input.

## PRODUCT

LifeBridge is a web app. The user drops in any messy input (text in any language, voice recording, photos, PDF documents), and LifeBridge returns an **Action Card**: a structured, verified, prioritized action plan.

Core concept terms (use these exact names everywhere):

| Term | Meaning |
|---|---|
| Intake | The set of raw user inputs for one request (text, audio, images, PDFs). |
| Action Card | The structured result object shown to the user. |
| Fact | One extracted piece of information with an `evidence` quote from the Intake. |
| Action | One prioritized step the user/bystander/authority should take. |
| Verification Report | Server-side deterministic checks applied to Gemini output. |
| Emergency Contact | A phone number resolved from the server's verified directory, never from the model. |

## TARGET USERS

1. Citizens and bystanders reporting an incident (accident, fire, flood, medical emergency).
2. Caregivers consolidating a patient's messy medical history into an emergency summary.
3. Community health workers and volunteers with low connectivity and mixed languages.

## OBJECTIVES

1. Convert any Intake into an Action Card in a single request.
2. Make every extracted Fact traceable to evidence in the Intake.
3. Never let the model invent emergency phone numbers.
4. Clearly separate verified content from content that needs human review.
5. Be usable by people with disabilities, low literacy, or a non-English language.

## FUNCTIONAL REQUIREMENTS

- FR-1: The app MUST accept free text (up to 10,000 characters) in any language.
- FR-2: The app MUST accept a voice recording made in the browser (MediaRecorder) or uploaded audio.
- FR-3: The app MUST accept images (JPEG, PNG, WEBP) and PDF files, max 4 files, max 5 MB each.
- FR-4: The app MUST send the Intake to Gemini and receive JSON that matches a strict schema (structured output).
- FR-5: The Action Card MUST contain: domain, severity, plain-language summary, Facts with evidence, ordered Actions, red flags, missing information questions, Emergency Contacts, and a Verification Report.
- FR-6: The server MUST run the Verification Report checks (defined in `docs/TRD.md` § VERIFICATION ENGINE) on every Gemini response before it reaches the user.
- FR-7: Emergency Contacts MUST come from a server-side verified directory keyed by country and service type.
- FR-8: The user MUST be able to choose the output language.
- FR-9: The user MUST be able to: read the Action Card aloud (text-to-speech), copy a short SMS-ready text (≤ 300 chars), download the Action Card as JSON, and print it.
- FR-10: The user SHOULD be able to share location (opt-in) so the Action Card includes a Google Maps link to nearby relevant services (hospital, police, fire station).
- FR-11: The app MUST show which Facts were verified against the Intake and which need human confirmation.
- FR-12: The app MUST provide one-click sample Intakes so the app can be demonstrated without the user's own data.

## NON-FUNCTIONAL REQUIREMENTS

- NFR-1 Security: API key server-side only; strict CSP; rate limiting; input validation; no storage of user data; prompt-injection resistance.
- NFR-2 Accessibility: WCAG 2.2 AA target; full keyboard operation; screen-reader announcements; reduced motion support.
- NFR-3 Efficiency: no frontend framework or build step; response cache for identical Intakes; compressed responses; p50 server overhead < 50 ms excluding Gemini latency.
- NFR-4 Testing: automated unit + integration tests with mocked Gemini; coverage ≥ 80% lines for `src/`.
- NFR-5 Code Quality: TypeScript strict mode, ESLint, small single-purpose modules, documented public functions.
- NFR-6 Privacy: Intake data is processed in memory only; logs never contain Intake content.

## OUT OF SCOPE

- User accounts, authentication, or persistent history.
- Actually placing calls or dispatching emergency services (the app provides `tel:` links only).
- Medical diagnosis or medication dosing. The app MUST state it is not a substitute for professional help.
- Native mobile apps.

## SUCCESS CRITERIA

- Deployed Cloud Run URL works end-to-end with each sample Intake.
- All tests pass in CI; coverage threshold met.
- Lighthouse accessibility score ≥ 95 on the deployed page.
- Every criterion of the AI evaluator is addressed by a concrete feature listed in `docs/TRD.md` § EVALUATION CRITERIA MAPPING.

## UNRESOLVED

- Exact weighting the AI evaluator gives each criterion: UNKNOWN.
- Gemini model ID available on the deployer's API key: configured via `GEMINI_MODEL` env var; default `gemini-flash-latest`.
