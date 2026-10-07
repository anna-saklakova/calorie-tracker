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

/**
 * Records a voice note; when it stops, the audio is transcribed and handed to `onText`.
 * Problems with the recording itself (no mic, nothing recorded, transcription failed) go to `onError` at once.
 * `cancel` stops without transcribing (e.g. when leaving the screen). `finish` stops a recording if one is
 * running and resolves once the transcript has been handed over (null if there is none), so Recognize can
 * be pressed before the voice note is ready.
 */
export function useVoiceNote(onText: (t: string) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);
  const pending = useRef<Promise<string | null> | null>(null);
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };

  useEffect(() => () => cancel(), []);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const started = Date.now();
    const iv = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 500);
    return () => clearInterval(iv);
  }, [recording]);

  const start = async () => {
    if (!voiceSupported()) {
      cb.current.onError('Voice notes aren’t supported in this browser');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      cb.current.onError('Microphone access is off for this site');
      return;
    }
    const mimeType = MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t));
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach(t => t.stop());
      cb.current.onError('Couldn’t start recording in this browser');
      return;
    }
    const chunks: Blob[] = [];
    let resolve: (t: string | null) => void = () => {};
    const done = new Promise<string | null>(res => (resolve = res));
    const settle = (t: string | null) => {
      if (pending.current === done) pending.current = null;
      resolve(t);
    };
    discard.current = false;
    r.ondataavailable = e => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      setRecording(false);
      rec.current = null;
      if (discard.current) return settle(null);
      const blob = new Blob(chunks, { type: r.mimeType || mimeType || 'audio/webm' });
      if (!blob.size) {
        cb.current.onError('Nothing was recorded. Try again');
        return settle(null);
      }
      setTranscribing(true);
      let text: string | null = null;
      try {
        text = (await transcribe(blob)) || null;
        if (text) cb.current.onText(text);
        else cb.current.onError('Couldn’t hear anything. Try again closer to the mic');
      } catch (e) {
        cb.current.onError((e as Error).message);
      } finally {
        setTranscribing(false);
        settle(text);
      }
    };
    rec.current = r;
    pending.current = done;
    r.start();
    setRecording(true);
  };

  const stop = () => {
    if (rec.current?.state === 'recording') rec.current.stop();
  };
  const cancel = () => {
    discard.current = true;
    stop();
  };

  const finish = (): Promise<string | null> => {
    const p = pending.current;
    if (!p) return Promise.resolve(null);
    stop();
    return p;
  };

  return { recording, transcribing, seconds, toggle: () => (recording ? stop() : start()), stop, cancel, finish };
}

export type VoiceNote = ReturnType<typeof useVoiceNote>;
