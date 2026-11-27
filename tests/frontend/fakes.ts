import { vi } from 'vitest';

/** Minimal stand-in for the browser MediaRecorder used by public/js/recorder.js. */
export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static failOn: 'construct' | 'start' | null = null;
  static isTypeSupported(type: string): boolean {
    return type === 'audio/webm';
  }

  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { error?: Error }) => void) | null = null;

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    if (FakeMediaRecorder.failOn === 'construct') throw new Error('construct failed');
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    if (FakeMediaRecorder.failOn === 'start') throw new Error('start failed');
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm;codecs=opus' }) });
    this.onstop?.();
  }

  static reset(): void {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.failOn = null;
  }
}

/** Installs a fake microphone; returns the track spy and the getUserMedia mock. */
export function installFakeMic(getUserMedia?: () => Promise<unknown>) {
  const track = { stop: vi.fn() };
  const gum = vi.fn(getUserMedia ?? (async () => ({ getTracks: () => [track] })));
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: gum }, configurable: true });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  return { track, gum };
}

/** Removes navigator properties defined by tests. */
export function cleanNavigator(): void {
  for (const key of ['mediaDevices', 'clipboard', 'geolocation']) {
    Reflect.deleteProperty(navigator, key);
  }
}
