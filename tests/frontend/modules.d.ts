/**
 * Type declarations for the browser ES modules in public/js, which are plain
 * JavaScript (no build step). Only the surface used by the frontend tests is typed.
 */

declare module '*/public/js/render.js' {
  import type { ActionCard } from '../../src/domain/schema.js';
  export function renderActionCard(card: ActionCard, doc?: Document): HTMLElement;
  export function renderEmergencyFallback(
    country: { name: string; emergency: string },
    message: string,
    doc?: Document,
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
    text: string;
    liveCheck?: boolean;
  }
  export const SAMPLES: readonly SampleIntake[];
}

declare module '*/public/js/recorder.js' {
  export const MAX_RECORDING_MS: number;
  export function isRecordingSupported(): boolean;
  export function pickMimeType(Recorder?: { isTypeSupported(type: string): boolean }): string;
  export function describeMicError(err: unknown): string;
}

/** Side-effect module: boots the UI against the current document. */
declare module '*/public/js/app.js';
