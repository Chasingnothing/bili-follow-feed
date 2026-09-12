export const SCHEMA_VERSION = 1;
const VERSION_KEY = 'bff:schemaVersion';

/**
 * 读 JSON。损坏 / 缺失一律回落 fallback —— 绝不因为脏数据白屏。
 * 这是热身版 readState 已经采用的策略，此处统一收口。
 */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 写 JSON。**返回成功与否**，而不是静默吞掉。
 *
 * 配额写满、或用户在浏览器设置里禁用了网站数据时，静默失败会让「已读状态」
 * 从此不再保存，而界面上毫无迹象 —— 用户只会觉得"刷新后怎么又变回未读了"。
 * 调用方必须把这个返回值暴露到界面上（设计文档 §15.3）。
 */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 读不到也不影响浏览 */
  }
}

/** 所有 `bff:*` 键的 key+value 字符数之和，用于「存储占用」展示（§15.4） */
export function bffUsage(): number {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('bff:')) continue;
      total += k.length + (localStorage.getItem(k) ?? '').length;
    }
  } catch {
    return 0;
  }
  return total;
}

/** 版本缺失或不等于当前版本 → 需要迁移/重置 */
export function needsMigration(): boolean {
  return readJson<number | null>(VERSION_KEY, null) !== SCHEMA_VERSION;
}

export function markMigrated(): boolean {
  return writeJson(VERSION_KEY, SCHEMA_VERSION);
}
