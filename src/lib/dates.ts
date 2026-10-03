export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const shift = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const todayIso = () => iso(new Date());

/** Monday of the week containing `s`. */
export const weekStartOf = (s: string) => {
  const d = parse(s);
  return shift(s, -((d.getDay() + 6) % 7));
};

export function dayLabel(s: string, today: string) {
  if (s === today) return 'Today';
  if (s === shift(today, -1)) return 'Yesterday';
  const d = parse(s);
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
}

export function fullDayLabel(s: string, today: string) {
  const d = parse(s);
  const head = s === today ? 'Today' : s === shift(today, -1) ? 'Yesterday' : WD[d.getDay()];
  return `${head}, ${d.getDate()} ${MON[d.getMonth()]}`;
}

export function weekLabel(ws: string) {
  const a = parse(ws);
  const b = parse(shift(ws, 6));
  return `${a.getDate()} ${a.getMonth() !== b.getMonth() ? MON[a.getMonth()] + ' ' : ''}– ${b.getDate()} ${MON[b.getMonth()]}`;
}
