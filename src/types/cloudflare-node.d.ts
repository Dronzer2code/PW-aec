/**
 * Minimal typing for the Cloudflare Workers `cloudflare:node` module (only what
 * `src/worker.ts` uses). Declared locally so the full Workers type set does not
 * clash with Node.js and DOM globals used by the rest of the project.
 */
declare module 'cloudflare:node' {
  /** Dispatches a Fetch API request to the Node `http.Server` listening on `port`. */
  export function handleAsNodeRequest(port: number, request: Request, env?: unknown, ctx?: unknown): Promise<Response>;
}
