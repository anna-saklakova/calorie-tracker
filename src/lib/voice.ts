import { useEffect, useRef, useState } from 'react';

// Minimal typing for the Web Speech API (Chrome on Android exposes webkitSpeechRecognition).
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type Ctor = new () => SpeechRecognitionLike;

const getCtor = (): Ctor | undefined =>
  typeof window === 'undefined' ? undefined : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);

export const voiceSupported = () => !!getCtor();

/**
 * Records speech and hands each final phrase to `onText`.
 * Interim text is exposed so the user sees what's being heard.
 */
export function useVoiceNote(onText: (t: string) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };

  useEffect(() => () => rec.current?.stop(), []);

  const start = () => {
    const C = getCtor();
    if (!C) {
      cb.current.onError('Voice notes aren’t supported in this browser');
      return;
    }
    const r = new C();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = e => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current.onText(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') cb.current.onError('Microphone access is off for this site');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') cb.current.onError('Couldn’t hear that. Try again');
    };
    r.onend = () => {
      setRecording(false);
      setInterim('');
      rec.current = null;
    };
    rec.current = r;
    r.start();
    setRecording(true);
  };

  const stop = () => rec.current?.stop();
  return { recording, interim, toggle: () => (recording ? stop() : start()), stop };
}
