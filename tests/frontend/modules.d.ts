/**
 * Type declarations for the browser ES modules in public/js, which are plain
 * JavaScript (no build step). Only the surface used by the frontend tests is typed.
 */

declare module '*/public/js/render.js' {
  import type { ActionCard } from '../../src/domain/schema.js';
  export function renderActionCard(card: ActionCard, doc?: Document, options?: { level?: number }): HTMLElement;
  export function renderEmergencyFallback(
    country: { name: string; emergency: string },
    message: string,
    doc?: Document,
    options?: { level?: number },
  ): HTMLElement;
  export function renderSkeleton(doc?: Document): HTMLElement;
  export function elementFactory(
    doc?: Document,
  ): (tag: string, props?: Record<string, string | undefined>, ...children: (Node | string | null | false | undefined)[]) => HTMLElement;
  export function buildPlainText(card: ActionCard): string;
  export function severityLabel(severity: string): string;
  export function formatTimeframe(timeframe: string): string;
  export function formatActor(actor: string): string;
  export function formatDomain(domain: string): string;
  export function safeHttpUrl(url: unknown): string | null;
  export function safeTel(tel: unknown): string | null;
  export interface DirectoryContact {
    service: string;
    label: string;
    number: string;
    tel: string;
  }
  export const SERVICE_LABELS: Readonly<Record<string, string>>;
  export const DIRECTORY: Readonly<Record<string, [string, string][]>>;
  export function directoryFor(country: { code: string; emergency: string }): DirectoryContact[];
  export function renderSummaryCard(card: ActionCard, doc?: Document): HTMLElement;
  export function icon(doc: Document, name: string): SVGSVGElement;
}

declare module '*/public/js/router.js' {
  export interface Route {
    name: string;
    title: string;
    params: string[];
    path: string;
  }
  export const ROUTES: readonly { name: string; pattern: RegExp; title: string }[];
  export const NOT_FOUND: { name: string; title: string };
  export function matchRoute(path: string, routes?: readonly { name: string; pattern: RegExp; title: string }[]): Route;
  export function isInternalLink(event: MouseEvent, anchor: HTMLAnchorElement | null, origin: string): boolean;
  export function createRouter(options: {
    render: (route: Route) => { title?: string; heading?: HTMLElement | null } | undefined;
    announce?: (message: string) => void;
    routes?: readonly { name: string; pattern: RegExp; title: string }[];
    win?: Window;
  }): { navigate(path: string, options?: { replace?: boolean }): void; readonly current: Route; start(): void; stop(): void };
}

declare module '*/public/js/pages/store.js' {
  import type { ActionCard } from '../../src/domain/schema.js';
  export interface CardEntry {
    id: string;
    createdAt: number;
    card: ActionCard;
  }
  export function createCardStore(
    storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
    options?: { max?: number },
  ): { add(card: unknown, now?: number): string; get(id: string): CardEntry | null; list(): CardEntry[] };
}

declare module '*/public/js/pages/views.js' {
  type Entry = { id: string; createdAt: number; card: unknown };
  export const PROGRESS_STEPS: readonly string[];
  export function relativeTime(then: number, now: number): string;
  export function renderRecentItems(entries: Entry[], doc?: Document): HTMLLIElement[];
  export function renderCardList(entries: Entry[], now: number, doc?: Document): HTMLElement;
  export function renderSuggestions(samples: readonly { id: string; title: string; icon: string }[], doc?: Document): HTMLLIElement[];
  export function renderSampleGrid(
    samples: readonly { id: string; title: string; description: string; inputs: string[]; icon: string }[],
    doc?: Document,
  ): HTMLLIElement[];
  export function renderCallGrid(contacts: { label: string; number: string; tel: string }[], doc?: Document): HTMLElement;
  export function renderBreadcrumb(crumbs: { label: string; href: string }[], doc?: Document): HTMLOListElement;
  export function renderProgress(active: number, doc?: Document): HTMLOListElement;
}

declare module '*/public/js/files.js' {
  export const ALLOWED_MIME_TYPES: readonly string[];
  export const DEFAULT_LIMITS: Readonly<{ maxFiles: number; maxFileBytes: number }>;
  export const DOWNSCALE: Readonly<{ maxEdge: number; maxBytes: number; quality: number }>;
  export function normalizeMimeType(type: string | null | undefined): string | null;
  export function formatBytes(bytes: number): string;
  export function validateFiles(
    files: ArrayLike<File>,
    existingCount?: number,
    limits?: { maxFiles: number; maxFileBytes: number },
  ): { accepted: { file: File; mimeType: string }[]; errors: string[] };
  export function safeFileName(name: string): string;
  export function fileToBase64(blob: Blob): Promise<string>;
  export function shouldDownscale(width: number, height: number, bytes: number): boolean;
  export function scaledSize(width: number, height: number, maxEdge?: number): { width: number; height: number };
  export function downscaleImage(file: File): Promise<File>;
}

declare module '*/public/js/samples.js' {
  export interface SampleIntake {
    id: string;
    title: string;
    description: string;
    inputs: ('text' | 'photo' | 'voice' | 'live')[];
    icon: string;
    text: string;
    liveCheck?: boolean;
    image?: { name: string; lines: string[] };
  }
  export const SAMPLES: readonly SampleIntake[];
  export function drawSampleImage(lines: string[], doc?: Document): Promise<Blob | null>;
}

declare module '*/public/js/recorder.js' {
  export const MAX_RECORDING_MS: number;
  export function isRecordingSupported(): boolean;
  export function pickMimeType(Recorder?: { isTypeSupported(type: string): boolean }): string;
  export function describeMicError(err: unknown): string;
  export function startRecording(options?: {
    maxMs?: number;
    onTick?: (elapsedMs: number) => void;
  }): Promise<{ stop: () => Promise<Blob>; done: Promise<Blob> }>;
}

/** Side-effect module: boots the UI against the current document. */
declare module '*/public/js/app.js';
