import { describe, expect, it } from 'vitest';
import { VoiceRecorder } from '../voice';
import type { VoiceDeps } from '../voice';

/** A MediaRecorder that hands over one chunk of "audio" when stopped, like the browser's. */
class FakeRecorder {
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(['x'.repeat(1000)]) });
      this.onstop?.();
    });
  }
}

const tick = () => new Promise(r => setTimeout(r));

function setup(transcribe: VoiceDeps['transcribe'], getStream: VoiceDeps['getStream'] = async () => ({ getTracks: () => [] }) as unknown as MediaStream) {
  const texts: string[] = [];
  const errors: string[] = [];
  const rec = new VoiceRecorder(
    { text: t => texts.push(t), error: m => errors.push(m), change: () => {} },
    { getStream, createRecorder: () => new FakeRecorder() as unknown as MediaRecorder, transcribe }
  );
  return { rec, texts, errors };
}

describe('voice notes and Recognize', () => {
  it('Recognize pressed while recording stops it and waits for the transcript', async () => {
    const { rec, texts } = setup(async () => 'съела протеиновое печенье и выпила сливок');
    rec.start();
    await tick();
    expect(rec.state.recording).toBe(true);
    const out = await rec.finish();
    expect(out).toEqual({ ok: true });
    expect(texts).toEqual(['съела протеиновое печенье и выпила сливок']);
    expect(rec.state).toMatchObject({ recording: false, transcribing: false });
  });

  it('Recognize pressed while the transcript is on its way waits for it', async () => {
    let answer: (t: string) => void = () => {};
    const { rec, texts } = setup(() => new Promise(r => (answer = r)));
    rec.start();
    await tick();
    rec.stop();
    await tick();
    await tick();
    expect(rec.state.transcribing).toBe(true);
    const done = rec.finish();
    answer('и сливки');
    expect(await done).toEqual({ ok: true });
    expect(texts).toEqual(['и сливки']);
  });

  it('Recognize pressed while the mic is still opening: nothing is left running afterwards', async () => {
    let open: (s: MediaStream) => void = () => {};
    const { rec, texts } = setup(async () => 'late', () => new Promise(r => (open = r)));
    rec.start();
    const done = rec.finish();
    open({ getTracks: () => [] } as unknown as MediaStream);
    expect(await done).toEqual({ ok: true });
    expect(rec.state.recording).toBe(false);
    expect(texts).toEqual([]);
  });

  it('a failed transcription is retried once, then kept and tried again by Recognize', async () => {
    let calls = 0;
    let down = true;
    const { rec, texts, errors } = setup(async () => {
      calls++;
      if (down) throw new Error('No connection');
      return 'сливки';
    });
    rec.start();
    await tick();
    expect(await rec.finish()).toEqual({ ok: false, message: 'No connection' });
    expect(calls).toBe(2);
    expect(rec.state.failed).toBe(1);
    expect(errors[0]).toContain('Recognize will try it again');

    down = false;
    expect(await rec.finish()).toEqual({ ok: true });
    expect(texts).toEqual(['сливки']);
    expect(rec.state.failed).toBe(0);
  });

  it('leaving the screen throws the recording away', async () => {
    const { rec, texts } = setup(async () => 'x');
    rec.start();
    await tick();
    rec.cancel();
    expect(await rec.finish()).toEqual({ ok: true });
    expect(texts).toEqual([]);
  });
});
