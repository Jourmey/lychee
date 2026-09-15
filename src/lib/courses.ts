import type { Course } from '../types';

/**
 * 课程列表 = 数据接入层（将来换成后端 API 时就改这一个文件）。
 *
 * 一门课 = 一个数据集目录（`data4/`；当前只挂这一套，见下方 glob）。这里把
 * `import.meta.glob` 吃进来的 `<DATASET>/data.json` 收成一份「课程目录」，UI 只认
 * 本文件导出的 `listCourses()` / `getCourse(id)` 两个函数，不直接碰 glob。
 *
 * ⚠️ **路由主键用目录名（`data4`），不是 `course.course.id`** —— `data2` 与 `data4`
 * 的 `course.id` 都是 `lychee-its-qiu2-reading`，用后者会撞车。
 */

/** 首页卡片所需的课程摘要（刻意不含 `scenes` 内容，避免首页背上整棵课件树）。 */
export interface CourseSummary {
  /** 数据集目录名，如 `data4` —— 路由主键。 */
  id: string;
  title: string;
  subtitle?: string;
  teacherName: string;
  teacherAvatar?: string;
  /** 课程段数（= `scenes.length`，不是 ITS 的 `pageCount`）。 */
  lessonCount: number;
  /** 是否推荐（目前在下方 mock；后端化时换成接口字段）。 */
  recommended: boolean;
}

/**
 * 挂进应用的数据集 —— **目前只上线 `data4`**。
 *
 * 要加回别的数据集，把它的 `data.json` 补进下面的 glob（或把 glob 改回「`data` + 通配符」
 * 的写法一次全收）。磁盘上的 `data/`、`data2/`、`data3/` 仍在，只是不进应用、不进打包
 * ——（`data4/replay.mp4` 依赖 `data2/` 里那个 1G 回放，别删 data2）。
 */
const modules = import.meta.glob<{ default: Course }>('../../data4/data.json', {
  eager: true,
});

/** 从 glob key（`'../../data4/data.json'`）里抠出目录名 —— 不要按 `../` 切分。 */
const DIR_RE = /^.*\/(data[^/]*)\/data\.json$/;

function idFromKey(key: string): string | null {
  const m = DIR_RE.exec(key);
  return m ? m[1] : null;
}

/** 推荐课程（mock：将来由后端返回）。 */
const RECOMMENDED = new Set(['data4']);

/** id → Course，模块加载时建一次。 */
const byId = new Map<string, Course>();
for (const [key, mod] of Object.entries(modules)) {
  const id = idFromKey(key);
  if (id) byId.set(id, mod.default);
}

/** 全部课程摘要，按目录名排序 —— 顺序稳定，首页不会每刷一次换个样。 */
export function listCourses(): CourseSummary[] {
  return [...byId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, course]) => ({
      id,
      title: course.course.title,
      subtitle: course.course.subtitle,
      teacherName: course.course.teacher?.name ?? '授课教师',
      teacherAvatar: course.course.teacher?.avatar,
      lessonCount: course.scenes.length,
      recommended: RECOMMENDED.has(id),
    }));
}

/** 取完整课程数据（播放页用）。取不到返回 `undefined`，由调用方渲染「未找到」。 */
export function getCourse(id: string): Course | undefined {
  return byId.get(id);
}
