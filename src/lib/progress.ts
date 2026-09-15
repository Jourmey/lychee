/**
 * 学习进度（localStorage 持久化）。纯函数、不依赖 React。
 *
 * key = `'lychee:progress:v1'`，值是 `Record<datasetId, ProgressRecord>`。
 * 首页一次 `readAll()` 拿全部（不要每张卡 parse 一次）。
 */

export type CourseStatus = '未开始' | '进行中' | '已完成';

export interface ProgressRecord {
  /** 最后停留的段序号（0 基 scene 索引）。 */
  lastScene: number;
  /** 该课程的段数（用于算完成度，容忍课程内容以后变长变短）。 */
  sceneCount: number;
  /** 最后更新时间戳（ms）。 */
  updatedAt: number;
}

const STORAGE_KEY = 'lychee:progress:v1';

/** 读全部进度。无痕模式 / 无 localStorage / 坏数据一律退回 `{}`。 */
export function readAll(): Record<string, ProgressRecord> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, ProgressRecord>;
  } catch {
    return {};
  }
}

/** 写一门课的进度（读改写，保留其余课程）。失败静默忽略（配额 / 无痕）。 */
export function writeProgress(id: string, rec: ProgressRecord): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const all = readAll();
    all[id] = rec;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* 无痕模式 / 配额不足 —— 进度是锦上添花，不阻断播放 */
  }
}

/** 读一门课的进度。 */
export function getProgress(id: string): ProgressRecord | undefined {
  return readAll()[id];
}

/**
 * 状态规则：
 *  - 无记录 → `未开始`；
 *  - `lastScene >= sceneCount - 1`（最后一段）→ `已完成`；
 *  - 其余 → `进行中`。
 */
export function statusOf(rec: ProgressRecord | undefined): CourseStatus {
  if (!rec || rec.sceneCount <= 0) return '未开始';
  if (rec.lastScene >= rec.sceneCount - 1) return '已完成';
  return '进行中';
}

/** 进度条比例 0~1 = `(lastScene + 1) / sceneCount`（当前段也算走完了）。 */
export function progressFraction(rec: ProgressRecord | undefined): number {
  if (!rec || rec.sceneCount <= 0) return 0;
  return Math.min(1, Math.max(0, (rec.lastScene + 1) / rec.sceneCount));
}
