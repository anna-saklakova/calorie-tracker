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
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': blob.type.split(';')[0], authorization: `Bearer ${token}` },
    body: blob
  });
  const data = (await res.json().catch(() => null)) as { status: string; text?: string; message?: string } | null;
  if (!data || data.status !== 'ok') throw new Error(data?.message || 'Couldn’t transcribe that. Try again or type the note');
  return data.text ?? '';
}

/**
 * Records a voice note; when it stops, the audio is transcribed and handed to `onText`.
 * `cancel` stops without transcribing (e.g. when leaving the screen).
 */
export function useVoiceNote(onText: (t: string) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);
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
    const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    discard.current = false;
    r.ondataavailable = e => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      setRecording(false);
      rec.current = null;
      if (discard.current) return;
      const blob = new Blob(chunks, { type: r.mimeType || mimeType || 'audio/webm' });
      setTranscribing(true);
      try {
        const text = await transcribe(blob);
        if (text) cb.current.onText(text);
        else cb.current.onError('Couldn’t hear anything. Try again closer to the mic');
      } catch (e) {
        cb.current.onError((e as Error).message);
      } finally {
        setTranscribing(false);
      }
    };
    rec.current = r;
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

  return { recording, transcribing, seconds, toggle: () => (recording ? stop() : start()), stop, cancel };
}
