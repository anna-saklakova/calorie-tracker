import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from './components/icons';
import { Sheet } from './components/Sheet';
import type { SheetState } from './components/Sheet';
import { fullDayLabel, todayIso, weekStartOf } from './lib/dates';
import { defaultMeal, r1, scaleItem } from './lib/nutrition';
import { recognize } from './lib/recognize';
import * as store from './lib/store';
import { useData } from './lib/store';
import { authAvailable, signOut, urlAuthError } from './lib/supabase';
import { endRecovery, fetchLatest, flush, reload, useSync } from './lib/sync';
import { uid } from './lib/types';
import type { Item, Meal, MealType, Photo, PhotoKind, Product, ReviewItem } from './lib/types';
import { AddMeal } from './screens/AddMeal';
import { Analyzing, emptyManual, Failed, Manual, Review } from './screens/Flow';
import type { ManualForm } from './screens/Flow';
import { Library } from './screens/Library';
import { Settings } from './screens/Settings';
import { AuthState, SetPassword, SignIn } from './screens/SignIn';
import { Today } from './screens/Today';
import { Week } from './screens/Week';

type Screen = 'today' | 'add' | 'analyzing' | 'review' | 'failed' | 'manual' | 'library' | 'week' | 'settings' | 'password';
const TABS: [Screen, string][] = [['today', 'Today'], ['week', 'Week'], ['library', 'Library']];

export interface Draft {
  date: string;
  meal: MealType;
  text: string;
  photos: Photo[];
}

/** A logged or recognized item as a library product, per 100 g. */
const productFromItem = (it: Item): Product => {
  const a = +it.amount || 100;
  return { id: uid(), name: it.name.trim(), basis: '100', portion: 100, updatedAt: 0, kcal: Math.round(((+it.kcal || 0) / a) * 100), p: r1((+it.p / a) * 100), f: r1((+it.f / a) * 100), c: r1((+it.c / a) * 100) };
};

interface Toast {
  msg: string;
  undo?: () => void;
}

export default function App() {
  const data = useData();
  const sync = useSync();
  const today = todayIso();
  const library = store.liveLibrary(data);
  const inLibrary = (name: string) => library.some(p => p.name.toLowerCase() === name.trim().toLowerCase());

  const [screen, setScreen] = useState<Screen>('today');
  const [date, setDate] = useState(today);
  const [datePick, setDatePick] = useState(false);
  const [draft, setDraft] = useState<Draft>({ date: today, meal: defaultMeal(), text: '', photos: [] });
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [reviewNotes, setReviewNotes] = useState<string[]>([]);
  const [failMsg, setFailMsg] = useState('');
  const [man, setMan] = useState<ManualForm>(emptyManual);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [weekStart, setWeekStart] = useState(weekStartOf(today));
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abort = useRef<AbortController | null>(null);

  const go = (s: Screen) => {
    setScreen(s);
    setDatePick(false);
  };
  const showToast = useCallback((msg: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 4000 : 2400);
  }, []);

  // A new account starts on Today, with nothing left over from the previous one.
  useEffect(() => {
    go('today');
    setDate(todayIso());
    setSheet(null);
    setPicking(false);
    setReview([]);
    setDraft(d => (clearPhotos(d.photos), { date: todayIso(), meal: defaultMeal(), text: '', photos: [] }));
  }, [sync.user?.id]);

  // Android back button / browser back: close the sheet or step back instead of leaving the app.
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    if (sheet) return setSheet(null), true;
    if (screen === 'analyzing') return cancelAnalyze(), true;
    if (screen === 'review' || screen === 'failed' || screen === 'manual') return go(picking ? 'manual' : 'add'), true;
    if (screen === 'password') return go('settings'), true;
    if (screen === 'add' || screen === 'settings' || screen === 'week' || screen === 'library') {
      if (picking) return setPicking(false), go('manual'), true;
      return go('today'), true;
    }
    return false;
  };
  useEffect(() => {
    history.pushState({ ct: 1 }, '');
    const onPop = () => {
      if (backRef.current()) history.pushState({ ct: 1 }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── Add flow ──────────────────────────────────────────────
  const clearPhotos = (photos: Photo[]) => photos.forEach(p => URL.revokeObjectURL(p.url));

  const openAdd = () => {
    setDraft(d => ({ ...d, date, meal: defaultMeal() }));
    go('add');
  };

  const runRecognize = async (correction?: string) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    go('analyzing');
    try {
      const res = await recognize(
        { photos: draft.photos, text: draft.text + (correction ? '\n' + correction : ''), library, correction, previous: correction !== undefined ? review : undefined },
        ac.signal
      );
      if (ac.signal.aborted) return;
      if (res.status === 'failed') {
        setFailMsg(res.message);
        go('failed');
      } else {
        setReview(res.items);
        setReviewNotes(res.notes);
        if (correction) setDraft(d => ({ ...d, text: d.text + '\n' + correction }));
        go('review');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setFailMsg('Something went wrong on our side. Check your connection and try again.');
      go('failed');
    }
  };
  const cancelAnalyze = () => {
    abort.current?.abort();
    go('add');
  };

  const confirmSave = () => {
    if (!review.length) return;
    const items: Item[] = review.map(it => ({ id: uid(), name: it.name.trim() || 'Item', amount: +it.amount || 0, kcal: +it.kcal || 0, p: +it.p || 0, f: +it.f || 0, c: +it.c || 0, amountSource: it.amountSource, nutritionSource: it.nutritionSource }));
    const toLib = review.filter(it => it.save && !inLibrary(it.name)).map(productFromItem);
    store.addItems(draft.date, draft.meal, items);
    toLib.forEach(store.upsertProduct);
    clearPhotos(draft.photos);
    setDraft(d => ({ ...d, text: '', photos: [] }));
    setReview([]);
    setReviewNotes([]);
    setDate(draft.date);
    go('today');
    showToast(`Saved to ${draft.meal}` + (toLib.length ? ` · ${toLib.length} added to library` : ''));
  };

  const saveManual = () => {
    store.addItems(draft.date, draft.meal, [{ id: uid(), name: man.name.trim(), amount: +man.amount || 0, kcal: +man.kcal || 0, p: +man.p || 0, f: +man.f || 0, c: +man.c || 0 }]);
    setMan(emptyManual());
    setDate(draft.date);
    go('today');
    showToast(`Added to ${draft.meal}`);
  };

  // ── Today item actions ────────────────────────────────────
  const removeItem = (d: string, meal: Meal, item: Item) => {
    const before = store.getData().days[d];
    store.deleteItem(d, meal.id, item.id);
    showToast('Removed', () => {
      if (before) store.restoreDay(d, before);
      setToast(null);
    });
  };

  // ── Render ────────────────────────────────────────────────
  // Nothing of the app is shown until the user is signed in and their data has come from the cloud.
  const gate = !authAvailable ? (
    <AuthState title="Sign-in isn’t set up" body="This build has no Supabase settings. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and deploy again." />
  ) : sync.authLoading ? (
    <AuthState title="Loading…" />
  ) : !sync.user ? (
    <SignIn initialError={urlAuthError} />
  ) : sync.recovery ? (
    <SetPassword
      email={sync.user.email ?? ''}
      onDone={() => {
        endRecovery();
        showToast('Password saved');
      }}
    />
  ) : sync.data === 'error' ? (
    <AuthState
      title="Couldn’t load your data"
      body={`Check your connection and try again.${sync.loadError ? `\nDetails: ${sync.loadError}` : ''}`}
      action={{ label: 'Try again', onClick: reload }}
      secondary={{ label: 'Sign out', onClick: () => signOut() }}
    />
  ) : sync.data !== 'ready' ? (
    <AuthState title="Loading your data…" />
  ) : null;

  if (gate)
    return (
      <div className="app">
        {gate}
        {toast && (
          <div className="toast" role="status" style={{ bottom: 'calc(100px + var(--safe-b))' }}>
            <span>{toast.msg}</span>
          </div>
        )}
      </div>
    );

  const showNav = (screen === 'today' || screen === 'week' || screen === 'library') && !picking;

  return (
    <div className="app">

      {screen === 'today' && (
        <Today
          data={data}
          date={date}
          today={today}
          datePick={datePick}
          setDate={d => {
            setDate(d);
            setDatePick(false);
          }}
          toggleDatePick={() => setDatePick(p => !p)}
          openSettings={() => go('settings')}
          openItem={(m, it) => setSheet({ type: 'item', date, mealId: m.id, mealType: m.type, draft: { ...it } })}
          deleteItem={(m, it) => removeItem(date, m, it)}
        />
      )}

      {screen === 'add' && (
        <AddMeal
          draft={draft}
          today={today}
          datePick={datePick}
          toggleDatePick={() => setDatePick(p => !p)}
          setDraft={fn => setDraft(fn)}
          addPhotos={(files: File[], kind: PhotoKind) => {
            const added = files.map(file => ({ id: uid(), kind, file, url: URL.createObjectURL(file) }));
            setDraft(d => ({ ...d, photos: [...d.photos, ...added] }));
          }}
          removePhoto={id => {
            draft.photos.filter(p => p.id === id).forEach(p => URL.revokeObjectURL(p.url));
            setDraft(d => ({ ...d, photos: d.photos.filter(p => p.id !== id) }));
          }}
          onBack={() => go('today')}
          onManual={() => go('manual')}
          onRecognize={() => runRecognize()}
          onError={showToast}
        />
      )}

      {screen === 'analyzing' && <Analyzing onCancel={cancelAnalyze} />}

      {screen === 'review' && (
        <Review
          subtitle={`${draft.meal} · ${fullDayLabel(draft.date, today)} · ${review.length} ${review.length === 1 ? 'item' : 'items'}`}
          items={review}
          notes={reviewNotes}
          onBack={() => go('add')}
          onChange={(id, fn) => setReview(r => r.map(x => (x.id === id ? fn(x) : x)))}
          onAmount={(id, v) => setReview(r => r.map(x => (x.id === id ? { ...scaleItem(x, v), amount: v === '' ? ('' as unknown as number) : +v } : x)))}
          onRemove={id => setReview(r => r.filter(x => x.id !== id))}
          onConfirm={confirmSave}
          onReRun={note => runRecognize(note)}
        />
      )}

      {screen === 'failed' && <Failed message={failMsg} onRetry={() => go('add')} onManual={() => go('manual')} />}

      {screen === 'manual' && (
        <Manual
          form={man}
          setForm={setMan}
          meal={draft.meal}
          setMeal={meal => setDraft(d => ({ ...d, meal }))}
          libCount={library.length}
          onBack={() => go('add')}
          onPickLibrary={() => {
            setPicking(true);
            go('library');
          }}
          onSave={saveManual}
        />
      )}

      {screen === 'library' && (
        <Library
          library={library}
          query={query}
          setQuery={setQuery}
          picking={picking}
          onBack={() => {
            setPicking(false);
            go('manual');
          }}
          onNew={() =>
            setSheet({ type: 'product', isNew: true, draft: { id: uid(), name: '', basis: '100', portion: 100, kcal: '' as unknown as number, p: '' as unknown as number, f: '' as unknown as number, c: '' as unknown as number, updatedAt: 0 }, addAmount: '100', addMeal: defaultMeal() })
          }
          onOpen={p => setSheet({ type: 'product', isNew: false, draft: { ...p }, addAmount: p.basis === '100' ? '100' : '1', addMeal: picking ? draft.meal : defaultMeal() })}
        />
      )}

      {screen === 'week' && (
        <Week
          data={data}
          weekStart={weekStart}
          currentWeekStart={weekStartOf(today)}
          today={today}
          setWeekStart={setWeekStart}
          openDay={d => {
            setDate(d);
            go('today');
          }}
        />
      )}

      {screen === 'settings' && (
        <Settings
          data={data}
          sync={sync}
          onBack={() => go('today')}
          onPassword={() => go('password')}
          onSignOut={async () => {
            const saved = await flush();
            if (!saved && !confirm('Your latest changes aren’t saved yet (no connection). Sign out and lose them?')) return;
            await signOut();
            showToast('Signed out');
          }}
          onExport={async () => {
            try {
              showToast(`Exported ${store.exportJson(await fetchLatest())}`);
            } catch {
              showToast('Couldn’t reach your account. Check your connection');
            }
          }}
        />
      )}

      {screen === 'password' && (
        <SetPassword
          email={sync.user?.email ?? ''}
          onBack={() => go('settings')}
          onDone={() => {
            go('settings');
            showToast('Password saved');
          }}
        />
      )}

      {showNav && (
        <>
          <button className="fab" aria-label="Add meal" onClick={openAdd}>
            <Plus />
          </button>
          <nav className="nav">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                className={screen === k ? 'on' : ''}
                aria-current={screen === k ? 'page' : undefined}
                onClick={() => {
                  setPicking(false);
                  go(k);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        </>
      )}

      {sheet && (
        <Sheet
          sheet={sheet}
          setSheet={setSheet}
          onClose={() => setSheet(null)}
          onSaveItem={s => {
            const it = s.draft;
            store.updateItem(s.date, s.mealId, { ...it, name: it.name.trim(), amount: +it.amount || 0, kcal: +it.kcal || 0, p: +it.p || 0, f: +it.f || 0, c: +it.c || 0 });
            setSheet(null);
          }}
          onDeleteItem={s => {
            const meal = store.getData().days[s.date]?.meals.find(m => m.id === s.mealId);
            const item = meal?.items.find(i => i.id === s.draft.id);
            setSheet(null);
            if (meal && item) removeItem(s.date, meal, item);
          }}
          onSaveProduct={p => {
            store.upsertProduct(p);
            setSheet(null);
            showToast('Saved to library');
          }}
          onAddProduct={(p, item, meal) => {
            store.upsertProduct(p);
            const d = picking ? draft.date : date;
            store.addItems(d, meal, [{ ...item, id: uid() }]);
            setSheet(null);
            setPicking(false);
            setDate(d);
            go('today');
            showToast(`Added to ${meal}`);
          }}
          inLibrary={inLibrary}
          onAddToLibrary={it => {
            store.upsertProduct(productFromItem(it));
            showToast('Added to library');
          }}
          onDeleteProduct={p => {
            store.deleteProduct(p.id);
            setSheet(null);
            showToast('Deleted', () => {
              store.upsertProduct({ ...p, deleted: false });
              setToast(null);
            });
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status" style={{ bottom: showNav ? undefined : 'calc(100px + var(--safe-b))' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {toast.msg}
            {toast.undo && (
              <button onClick={toast.undo} style={{ pointerEvents: 'auto', border: 'none', background: 'transparent', color: '#C9DDCB', fontSize: 14, fontWeight: 700, padding: 0 }}>
                Undo
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
