const ink = 'var(--ink)';
const muted = 'var(--muted)';

export const ChevronLeft = ({ small }: { small?: boolean }) => (
  <svg width={small ? 8 : 10} height={small ? 14 : 16} viewBox="0 0 10 16" fill="none" stroke={small ? muted : ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 2 2 8l6 6" />
  </svg>
);

export const ChevronRight = ({ small, color }: { small?: boolean; color?: string }) => (
  <svg width={small ? 8 : 10} height={small ? 14 : 16} viewBox="0 0 10 16" fill="none" stroke={color ?? ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m2 2 6 6-6 6" />
  </svg>
);

export const ChevronDown = () => (
  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke={muted} strokeWidth="1.5" strokeLinecap="round" aria-hidden>
    <path d="m1 1 4 4 4-4" />
  </svg>
);

export const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={muted} strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <path d="M3 5h12M3 9h12M3 13h12" />
    <circle cx="7" cy="5" r="1.6" fill="var(--bg)" />
    <circle cx="12" cy="9" r="1.6" fill="var(--bg)" />
    <circle cx="6" cy="13" r="1.6" fill="var(--bg)" />
  </svg>
);

export const Plus = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M11 3v16M3 11h16" />
  </svg>
);

export const CameraIcon = () => (
  <svg width="22" height="20" viewBox="0 0 22 20" fill="none" stroke={ink} strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h3l2-3h6l2 3h3v11H3z" />
    <circle cx="11" cy="11" r="3.2" />
  </svg>
);

export const GalleryIcon = () => (
  <svg width="22" height="20" viewBox="0 0 22 20" fill="none" stroke={ink} strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="16" height="14" rx="2" />
    <path d="m3 14 5-5 4 4 3-3 4 4" />
  </svg>
);

export const MicIcon = ({ color }: { color: string }) => (
  <svg width="16" height="20" viewBox="0 0 16 20" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <rect x="5" y="1" width="6" height="11" rx="3" />
    <path d="M2 9a6 6 0 0 0 12 0M8 15v4" />
  </svg>
);

export const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={muted} strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <circle cx="7" cy="7" r="5" />
    <path d="m11 11 3.5 3.5" />
  </svg>
);

export const Star = ({ on }: { on: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill={on ? 'var(--accent)' : 'none'} stroke={on ? 'var(--accent)' : '#C9C3B8'} strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
    <path d="m9 1.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L1.8 7.1l5-.7z" />
  </svg>
);

export const Exclaim = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke={muted} strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <path d="M13 7v8M13 19.5v.5" />
  </svg>
);

/** The app mark: an open ring on sage. */
export const Logo = () => (
  <div style={{ width: 56, height: 56, borderRadius: 18, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
    <div style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid #fff', borderRightColor: 'transparent' }} />
  </div>
);
