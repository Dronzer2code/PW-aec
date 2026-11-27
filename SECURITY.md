# Security Policy

## Reporting a vulnerability

Please open a private security advisory on this GitHub repository rather than a public issue. Include steps to reproduce and the `X-Request-Id` of any affected request.

## Security model

- No user accounts, no database: Intake data is processed in memory and is never persisted or logged.
- The Gemini API key is only available server-side (Secret Manager on Cloud Run).
- All user input and all model output are untrusted. See the Security section of `README.md` for the controls.
