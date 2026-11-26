/** Shared, dependency-free Android recorder interchange format. Copies are bundled into each fork. */
export const JOURNAL_ROOT = '_mobile-edit-history';
export interface MobileRecord {
  schema: 1; id: string; deviceId: string; path: string;
  kind: 'baseline' | 'edit'; content: string; previousContent?: string;
  capturedAt: string; modifiedAt: number; day: string; offsetMinutes: number;
  basis: 'file-mtime' | 'observed';
}
export interface JournalAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{files: string[]; folders: string[]}>;
  read(path: string): Promise<string>;
  stat(path: string): Promise<{mtime: number; size: number} | null>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function isNotePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 &&
    !value.includes('\\') && !value.includes(':') && !/[\x00-\x1f]/.test(value) &&
    value.split('/').every(p => p !== '' && p !== '.' && p !== '..' && !p.startsWith('.')) &&
    value.split('/')[0] !== JOURNAL_ROOT;
}
export function parseMobileRecord(text: string): MobileRecord {
  if (text.length > 12 * 1024 * 1024) throw Error('Mobile record exceeds 12 MiB');
  const r = JSON.parse(text);
  if (r.schema !== 1 || !uuid.test(r.id) || !uuid.test(r.deviceId) || !isNotePath(r.path) ||
      !['baseline', 'edit'].includes(r.kind) || typeof r.content !== 'string' ||
      (r.kind === 'edit' && typeof r.previousContent !== 'string') ||
      typeof r.capturedAt !== 'string' || !Number.isFinite(Date.parse(r.capturedAt)) ||
      !Number.isFinite(r.modifiedAt) || r.modifiedAt < 0 ||
      !['file-mtime', 'observed'].includes(r.basis) || !Number.isInteger(r.offsetMinutes) ||
      Math.abs(r.offsetMinutes) > 840 || !/^\d{4}-\d{2}-\d{2}$/.test(r.day))
    throw Error('Invalid mobile history record');
  const time = r.basis === 'file-mtime' ? r.modifiedAt : Date.parse(r.capturedAt);
  if (!Number.isFinite(time) || new Date(time + r.offsetMinutes * 60_000).toISOString().slice(0, 10) !== r.day)
    throw Error('Mobile record date does not match its source timestamp');
  return r as MobileRecord;
}
export function mobileTime(r: MobileRecord): number {
  return r.basis === 'file-mtime' ? r.modifiedAt : Date.parse(r.capturedAt);
}
export class MobileJournalReader {
  private cache = new Map<string, {mtime: number; size: number; record: MobileRecord}>();
  constructor(private adapter: JournalAdapter, private report: (path: string, error: unknown) => void = console.warn) {}
  async readAll(): Promise<MobileRecord[]> {
    const root = JOURNAL_ROOT + '/v1';
    if (!await this.adapter.exists(root)) return [];
    const files: string[] = [];
    const listing = await this.adapter.list(root);
    for (const folder of listing.folders) {
      if (!folder.startsWith(root + '/') || !uuid.test(folder.slice(root.length + 1))) continue;
      files.push(...(await this.adapter.list(folder)).files);
    }
    const result = new Map<string, MobileRecord>();
    for (const file of files.sort()) {
      if (!file.endsWith('.json') || !file.startsWith(root + '/')) continue;
      try {
        const stat = await this.adapter.stat(file);
        if (!stat || stat.size > 12 * 1024 * 1024) continue;
        let cached = this.cache.get(file);
        if (!cached || cached.mtime !== stat.mtime || cached.size !== stat.size) {
          const record = parseMobileRecord(await this.adapter.read(file));
          const parts = file.split('/');
          if (parts[parts.length - 2] !== record.deviceId || parts[parts.length - 1] !== record.id + '.json')
            throw Error('Mobile record identity does not match its filename');
          cached = {mtime: stat.mtime, size: stat.size, record}; this.cache.set(file, cached);
        }
        result.set(cached.record.id, cached.record);
      } catch (error) { this.cache.delete(file); this.report(file, error); }
    }
    return [...result.values()].sort((a, b) => mobileTime(a) - mobileTime(b) || a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
  }
}
