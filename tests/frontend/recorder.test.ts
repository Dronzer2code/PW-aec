// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECORDING_MS, isRecordingSupported, startRecording } from '../../public/js/recorder.js';
import { FakeMediaRecorder, cleanNavigator, installFakeMic } from './fakes.js';

describe('recorder.js', () => {
  beforeEach(() => FakeMediaRecorder.reset());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanNavigator();
  });

  it('detects support', () => {
    expect(isRecordingSupported()).toBe(false);
    installFakeMic();
    expect(isRecordingSupported()).toBe(true);
  });

  it('records, reports elapsed time and releases the microphone on stop', async () => {
    vi.useFakeTimers();
    const { track } = installFakeMic();
    const onTick = vi.fn();
    const session = await startRecording({ onTick });
    expect(FakeMediaRecorder.instances[0]?.mimeType).toBe('audio/webm');
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalled();
    const blob = await session.stop();
    expect(blob.type).toBe('audio/webm');
    expect(blob.size).toBeGreaterThan(0);
    expect(track.stop).toHaveBeenCalled();
    await expect(session.stop()).resolves.toBe(blob);
  });

  it('stops automatically at the maximum duration', async () => {
    vi.useFakeTimers();
    const { track } = installFakeMic();
    const session = await startRecording({ maxMs: 1000 });
    vi.advanceTimersByTime(1000);
    await expect(session.done).resolves.toBeInstanceOf(Blob);
    expect(track.stop).toHaveBeenCalled();
    expect(MAX_RECORDING_MS).toBe(120_000);
  });

  it.each(['construct', 'start'] as const)('releases the microphone when MediaRecorder fails to %s', async (step) => {
    const { track } = installFakeMic();
    FakeMediaRecorder.failOn = step;
    await expect(startRecording()).rejects.toThrow(`${step} failed`);
    expect(track.stop).toHaveBeenCalled();
  });

  it('rejects and releases the microphone on recorder errors', async () => {
    const { track } = installFakeMic();
    const session = await startRecording();
    FakeMediaRecorder.instances[0]?.onerror?.({ error: new Error('device lost') });
    await expect(session.done).rejects.toThrow('device lost');
    expect(track.stop).toHaveBeenCalled();
  });

  it('propagates permission denial', async () => {
    installFakeMic(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    await expect(startRecording()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});
