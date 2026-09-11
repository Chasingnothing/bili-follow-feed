const READ_KEY = 'bff:readVideos';
const VISIT_KEY = 'bff:lastVisitAt';

/** 读取已读集合。数据损坏时静默返回空集合 —— 不应因为 localStorage 脏数据而白屏。 */
export function loadRead(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function saveRead(s: Set<string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...s]));
  } catch {
    /* 配额满或被禁用时忽略，不影响浏览 */
  }
}

/** 返回新集合，不修改入参 */
export function markRead(s: Set<string>, bvid: string): Set<string> {
  const next = new Set(s);
  next.add(bvid);
  return next;
}

export function markAllRead(bvids: string[]): Set<string> {
  return new Set(bvids);
}

export function loadLastVisit(): number {
  const raw = localStorage.getItem(VISIT_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function saveLastVisit(ts: number): void {
  try {
    localStorage.setItem(VISIT_KEY, String(ts));
  } catch {
    /* 同上 */
  }
}
