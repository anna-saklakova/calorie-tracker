import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const MAX_SECONDS = 120;

/** Recording formats the transcription API accepts, best first. */
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export const voiceSupported = () =>
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Sends a recording to /api/transcribe (the server holds the API key) and returns the text. */
async function transcribe(blob: Blob): Promise<string> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new Error('Your session expired. Sign in again');
  let res: Response;
  try {
    res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'content-type': blob.type.split(';')[0], authorization: `Bearer ${token}` },
      body: blob
    });
  } catch {
    throw new Error('No connection, the voice note wasn’t transcribed. Try again or type the note');
  }
  const data = (await res.json().catch(() => null)) as { status: string; text?: string; message?: string } | null;
  if (!data || data.status !== 'ok') throw new Error(data?.message || 'Couldn’t transcribe that. Try again or type the note');
  return data.text ?? '';
}

/** What `finish` found: the voice notes are all in the text, or one couldn't be transcribed (kept for another try). */
export type VoiceOutcome = { ok: true } | { ok: false; message: string };

export interface VoiceState {
  recording: boolean;
  transcribing: boolean;
  /** recordings whose transcription failed; the next `finish` tries them again */
  failed: number;
}

/** The browser parts, swappable in tests. */
export interface VoiceDeps {
  getStream: () => Promise<MediaStream>;
  createRecorder: (stream: MediaStream) => MediaRecorder;
  transcribe: (blob: Blob) => Promise<string>;
}

const browserDeps: VoiceDeps = {
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  createRecorder: stream => {
    const mimeType = MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t));
    return new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  },
  transcribe
};

/**
 * Records voice notes; each one, once stopped, is transcribed and handed to `onText`. Nothing said is
 * dropped: `finish` (called by Recognize) stops a recording that is starting or running, waits for its
 * transcript, and retries recordings whose transcription failed, so Recognize can be pressed at any moment.
 * Only `cancel` (leaving the screen) throws a recording away.
 */
export class VoiceRecorder {
  state: VoiceState = { recording: false, transcribing: false, failed: 0 };
  /** settles once the current recording (from the mic tap until its transcript) is done */
  private active: Promise<void> | null = null;
  private rec: MediaRecorder | null = null;
  private stopWanted = false;
  private discard = false;
  private failed: Blob[] = [];
  private lastError = '';

  constructor(
    private on: { text: (t: string) => void; error: (msg: string) => void; change: (s: VoiceState) => void },
    private deps: VoiceDeps = browserDeps
  ) {}

  private set(s: Partial<VoiceState>) {
    this.state = { ...this.state, ...s, failed: this.failed.length };
    this.on.change(this.state);
  }

  /** Transcribes one recording, trying once more if it fails; a recording that still fails is kept. */
  private async transcribeBlob(blob: Blob): Promise<boolean> {
    this.set({ transcribing: true });
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const text = (await this.deps.transcribe(blob)).trim();
          if (text) this.on.text(text);
          else this.on.error('Couldn’t hear anything in the voice note. Try again closer to the mic');
          return true;
        } catch (e) {
          if (attempt < 1) continue;
          this.lastError = (e as Error).message || 'Couldn’t transcribe the voice note';
          this.failed.push(blob);
          this.on.error(`${this.lastError}. The recording is kept: Recognize will try it again`);
          return false;
        }
      }
    } finally {
      this.set({ transcribing: false });
    }
  }

  start(): void {
    if (this.active) return;
    this.stopWanted = false;
    this.discard = false;
    this.active = this.record().finally(() => (this.active = null));
  }

  private async record(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await this.deps.getStream();
    } catch {
      return this.on.error('Microphone access is off for this site');
    }
    const release = () => stream.getTracks().forEach(t => t.stop());
    // Recognize or leaving the screen came while the mic was still opening: nothing was said yet
    if (this.stopWanted || this.discard) return release();
    let r: MediaRecorder;
    try {
      r = this.deps.createRecorder(stream);
    } catch {
      release();
      return this.on.error('Couldn’t start recording in this browser');
    }
    const chunks: Blob[] = [];
    const stopped = new Promise<void>(resolve => {
      r.ondataavailable = e => void (e.data.size && chunks.push(e.data));
      r.onstop = () => resolve();
    });
    this.rec = r;
    r.start();
    this.set({ recording: true });
    await stopped;
    release();
    this.rec = null;
    this.set({ recording: false });
    if (this.discard) return;
    const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
    if (!blob.size) return this.on.error('Nothing was recorded. Try again');
    await this.transcribeBlob(blob);
  }

  /** The mic button: a second tap stops, even while the mic is still opening. */
  toggle(): void {
    if (this.active && !this.state.transcribing) this.stop();
    else this.start();
  }

  stop(): void {
    this.stopWanted = true;
    if (this.rec?.state === 'recording') this.rec.stop();
  }

  cancel(): void {
    this.discard = true;
    this.failed = [];
    this.stop();
    this.set({});
  }

  /** Everything said so far ends up in the text before this resolves, or the outcome says why not. */
  async finish(): Promise<VoiceOutcome> {
    // recordings that failed before this press get another try; the one stopped now has had its retry already
    const earlier = this.failed.splice(0);
    this.stop();
    await this.active;
    for (const blob of earlier) await this.transcribeBlob(blob);
    this.set({});
    return this.failed.length ? { ok: false, message: this.lastError } : { ok: true };
  }
}

/** The recorder for a React screen, with a seconds counter that stops recording after MAX_SECONDS. */
export function useVoiceNote(onText: (t: string) => void, onError: (msg: string) => void) {
  const [state, setState] = useState<VoiceState>({ recording: false, transcribing: false, failed: 0 });
  const [seconds, setSeconds] = useState(0);
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };
  const ref = useRef<VoiceRecorder | null>(null);
  if (!ref.current) ref.current = new VoiceRecorder({ text: t => cb.current.onText(t), error: m => cb.current.onError(m), change: setState });
  const r = ref.current;

  useEffect(() => () => r.cancel(), []);

  useEffect(() => {
    if (!state.recording) return;
    setSeconds(0);
    const started = Date.now();
    const iv = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) r.stop();
    }, 500);
    return () => clearInterval(iv);
  }, [state.recording]);

  const toggle = () => {
    if (!state.recording && !voiceSupported()) return cb.current.onError('Voice notes aren’t supported in this browser');
    r.toggle();
  };

  return { ...state, seconds, toggle, stop: () => r.stop(), cancel: () => r.cancel(), finish: () => r.finish() };
}

export type VoiceNote = ReturnType<typeof useVoiceNote>;
