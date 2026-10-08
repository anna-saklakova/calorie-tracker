import { useRef } from 'react';
import { CameraIcon, ChevronDown, GalleryIcon, MicIcon } from '../components/icons';
import { DateStrip, MealPicker, SubHeader, snackOptions, targetName } from '../components/ui';
import { fullDayLabel } from '../lib/dates';
import type { VoiceNote } from '../lib/voice';
import type { Draft } from '../App';
import type { Day, PhotoKind } from '../lib/types';

interface Props {
  draft: Draft;
  /** the logged days, to offer the draft day's snacks */
  days: Record<string, Day>;
  today: string;
  datePick: boolean;
  toggleDatePick: () => void;
  setDraft: (fn: (d: Draft) => Draft) => void;
  voice: VoiceNote;
  /** photos picked and still being read in */
  photosLoading: number;
  addPhotos: (files: File[], kind: PhotoKind) => void;
  removePhoto: (id: string) => void;
  onBack: () => void;
  onManual: () => void;
  onRecognize: () => void;
}

export function AddMeal({ draft, days, today, datePick, toggleDatePick, setDraft, voice, photosLoading, addPhotos, removePhoto, onBack, onManual, onRecognize }: Props) {
  const snacks = snackOptions(days[draft.date]);
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const busyVoice = voice.recording || voice.transcribing || voice.failed > 0;
  // a voice note still recording or transcribing (or kept after a failed transcription), or photos still loading,
  // are finished after Recognize is pressed
  const cantRecognize = !busyVoice && !photosLoading && !draft.text.trim() && !draft.photos.length;

  const clock = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`;
  const recHint = voice.recording
    ? `Recording · ${clock} · tap to stop`
    : voice.transcribing ? 'Turning your voice note into text…'
    : voice.failed ? 'Voice note not transcribed yet · Recognize will retry'
    : draft.text ? 'Transcript is editable' : 'Hold a thought? Tap the mic';

  return (
    <div className="screen rise">
      <SubHeader title="Add meal" onBack={onBack} />
      <div className="scroll pad-sub">
        <button onClick={toggleDatePick} aria-expanded={datePick} style={{ border: 'none', background: 'transparent', padding: '6px 4px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--muted)' }}>
          {fullDayLabel(draft.date, today)} · {targetName(draft.meal, draft.snackId, snacks).replace(/^a new/, 'New')}
          <ChevronDown />
        </button>
        {datePick && <DateStrip today={today} value={draft.date} onPick={d => setDraft(x => ({ ...x, date: d, snackId: undefined }))} style={{ padding: '6px 0 8px' }} />}
        <div style={{ marginTop: 8 }}>
          <MealPicker value={draft.meal} snackId={draft.snackId} snacks={snacks} onChange={(meal, snackId) => setDraft(d => ({ ...d, meal, snackId }))} />
        </div>

        <div className="label" style={{ marginTop: 28 }}>Photos</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10, overflowX: 'auto', paddingBottom: 4 }}>
          <PhotoButton label="Camera" icon={<CameraIcon />} onClick={() => cam.current?.click()} />
          <PhotoButton label="Gallery" icon={<GalleryIcon />} onClick={() => gal.current?.click()} />
          {draft.photos.map(ph => (
            <div key={ph.id} style={{ flex: 'none', width: 96, height: 96, borderRadius: 18, position: 'relative', overflow: 'hidden', background: `var(--surface-2) url(${ph.url}) center/cover` }}>
              <button
                onClick={() => setDraft(d => ({ ...d, photos: d.photos.map(x => (x.id === ph.id ? { ...x, kind: x.kind === 'plate' ? 'label' : 'plate' } : x)) }))}
                aria-label={`Photo of ${ph.kind}, tap to switch`}
                style={{ position: 'absolute', left: 8, bottom: 8, height: 22, padding: '0 8px', borderRadius: 999, border: 'none', background: 'rgba(31,29,26,.78)', color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: 'ui-monospace,Menlo,monospace' }}
              >
                {ph.kind}
              </button>
              <button
                onClick={() => removePhoto(ph.id)}
                aria-label="Remove photo"
                style={{ position: 'absolute', right: 6, top: 6, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(31,29,26,.78)', color: '#fff', fontSize: 14, lineHeight: 1, display: 'grid', placeItems: 'center' }}
              >
                ×
              </button>
            </div>
          ))}
          {Array.from({ length: photosLoading }, (_, i) => (
            <div key={`loading-${i}`} role="status" aria-label="Adding photo" style={{ flex: 'none', width: 96, height: 96, borderRadius: 18, background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid transparent', borderTopColor: 'var(--accent)', animation: 'ctSpin 1.1s linear infinite' }} />
            </div>
          ))}
        </div>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => { if (e.target.files?.length) addPhotos(Array.from(e.target.files), 'plate'); e.target.value = ''; }} />
        <input ref={gal} type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files?.length) addPhotos(Array.from(e.target.files), 'label'); e.target.value = ''; }} />
        <div className="hint" style={{ marginTop: 8 }}>Plate, nutrition label, or both. Add as many as you need.</div>

        <div className="label" style={{ marginTop: 24 }}>Note</div>
        <div style={{ marginTop: 10, background: '#fff', borderRadius: 20, padding: '14px 14px 10px' }}>
          <textarea
            value={draft.text}
            onChange={e => setDraft(d => ({ ...d, text: e.target.value }))}
            rows={4}
            aria-label="Note"
            placeholder="What's on the plate? e.g. about 150 g pasta, the sauce is from the jar in the second photo, broccoli is steamed"
            style={{ width: '100%', border: 'none', background: 'transparent', resize: 'none', fontSize: 16, lineHeight: 1.45, color: 'var(--ink)', display: 'block' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 10 }}>
            <span style={{ fontSize: 12, color: voice.recording ? 'var(--danger)' : 'var(--faint)', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {voice.recording && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', flex: 'none', animation: 'ctRec 1s infinite' }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recHint}</span>
            </span>
            <button
              onClick={voice.toggle}
              disabled={voice.transcribing}
              aria-label={voice.recording ? 'Stop voice note' : 'Voice note'}
              aria-pressed={voice.recording}
              style={{ flex: 'none', width: 44, height: 44, borderRadius: '50%', border: 'none', background: voice.recording ? '#F4E3DD' : 'var(--bg)', display: 'grid', placeItems: 'center', transition: 'background .2s' }}
            >
              <MicIcon color={voice.recording ? 'var(--danger)' : 'var(--ink)'} />
            </button>
          </div>
        </div>

        <button className="btn-outline" style={{ marginTop: 18 }} onClick={onManual}>
          Add by hand or from library
        </button>
      </div>
      <div className="footer">
        <button className="btn-primary" disabled={cantRecognize} onClick={onRecognize}>
          Recognize
        </button>
      </div>
    </div>
  );
}

function PhotoButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ flex: 'none', width: 96, height: 96, borderRadius: 18, border: '1.5px dashed var(--dash)', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--ink)' }}>
      {icon}
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
    </button>
  );
}
