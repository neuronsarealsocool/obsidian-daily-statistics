import {type MobileRecord, mobileTime} from './mobile-journal';
export interface CountSnapshot { hash: string; count: number; time: number; }
export interface CountTransition {id: string; path: string; from: string; to: string; before: number; after: number; start: number; time: number; day: string; basis: string;}
export interface LedgerState {schema: 1; base: Record<string, number>; manual: Record<string, number>; snapshots: Record<string, CountSnapshot>; observations: CountTransition[]; mobile: Record<string, CountTransition>;}
// A stable content fingerprint for matching observed transitions, never a security boundary.
export function fingerprint(text: string): string {
  let a = 2166136261, b = 2246822507;
  for (let i = 0; i < text.length; i++) {a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489909);}
  return text.length + ':' + (a >>> 0).toString(16) + ':' + (b >>> 0).toString(16);
}
export function localDay(time: number): string {
  const d = new Date(time), pad = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
export class StatisticsLedger {
  constructor(public state: LedgerState, private measure: (text: string) => {hash: string; count: number}) {}
  static create(base: Record<string, number>): LedgerState {return {schema: 1, base: {...base}, manual: {}, snapshots: {}, observations: [], mobile: {}};}
  restoreMissingDays(history: Record<string, number>): void {
    const totals = this.totals();
    for (const [day, count] of Object.entries(history)) {
      if (!(day in totals) && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(count)) {
        this.state.base[day] = count;
      }
    }
  }
  observe(path: string, text: string, time: number, basis: string, legacy?: number): void {
    const current = this.measure(text), old = this.state.snapshots[path];
    if (old?.hash === current.hash) return;
    if (old || legacy !== undefined) {
      const before = old?.count ?? legacy!;
      this.state.observations.push({id: 'desktop-' + Date.now() + '-' + Math.random().toString(36).slice(2), path,
        from: old?.hash ?? '', to: current.hash, before, after: current.count, start: old?.time ?? 0,
        time, day: localDay(time), basis});
    }
    this.state.snapshots[path] = {...current, time};
  }
  import(records: MobileRecord[], include: (path: string) => boolean): void {
    for (const r of records) {
      if (r.kind !== 'edit' || !include(r.path)) continue;
      const before = this.measure(r.previousContent!), after = this.measure(r.content);
      this.state.mobile[r.id] = {id: r.id, path: r.path, from: before.hash, to: after.hash,
        before: before.count, after: after.count, start: 0, time: mobileTime(r), day: r.day, basis: 'android-' + r.basis};
    }
  }
  totals(): Record<string, number> {
    const contributions = new Map<string, number>(), mobile = Object.values(this.state.mobile);
    const add = (t: CountTransition, delta: number) => {const key = t.day + '\u0000' + t.path; contributions.set(key, (contributions.get(key) ?? 0) + delta);};
    for (const t of mobile) add(t, t.after - t.before);
    for (const t of this.state.observations) {
      // Replace even a partially delivered phone chain's overlapping desktop estimate.
      // Immutable event IDs make late, duplicate and out-of-order imports repeatable.
      const candidates = mobile.filter(m => m.path === t.path && m.time >= t.start - 5000 && m.time <= t.time + 5000)
        .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
      const used = new Set<string>(); let matched = 0, from = t.from, count = t.before;
      for (const m of candidates) if (!used.has(m.id) && (from ? m.from === from : m.before === count)) {
        used.add(m.id); matched += m.after - m.before; from = m.to; count = m.after; if (from === t.to) break;
      }
      let to = t.to;
      for (const m of [...candidates].reverse()) if (!used.has(m.id) && m.to === to) {
        used.add(m.id); matched += m.after - m.before; to = m.from; if (to === t.from) break;
      }
      add(t, t.after - t.before - matched);
    }
    const result = {...this.state.base};
    for (const [key, delta] of contributions) {const day = key.split('\u0000')[0]; result[day] = (result[day] ?? 0) + Math.max(0, delta);}
    for (const [day, value] of Object.entries(this.state.manual)) result[day] = (result[day] ?? 0) + value;
    return result;
  }
}
