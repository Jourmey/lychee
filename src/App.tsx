import { useCallback, useMemo, useState } from 'react';
import type { Course } from './types';
import { PlaybackChrome } from './components/PlaybackChrome';

/**
 * 数据集目录由 `VITE_DATASET` 选择（默认 `data`），与 scripts/lib/dataset.mjs 同一套约定：
 * 同一份代码可以跑多套「ITS 课件 + 回放 + 逐字稿」数据。
 *   VITE_DATASET=data2 pnpm dev
 * 各数据集的 <DATASET>/data.json 由 `DATASET=data2 pnpm build-course` 生成。
 */
const DATASET = import.meta.env.VITE_DATASET || 'data';

const datasets = import.meta.glob<{ default: Course }>('../data*/data.json', { eager: true });
const entry = datasets[`../${DATASET}/data.json`];
if (!entry) {
  throw new Error(
    `未找到数据集 "${DATASET}"（缺 ${DATASET}/data.json）。先运行：DATASET=${DATASET} pnpm build-course`,
  );
}
const data = entry.default;

export default function App() {
  const course = useMemo<Course>(() => data, []);
  const [dark, setDark] = useState(true);
  const toggleTheme = useCallback(() => setDark((prev) => !prev), []);

  return (
    <div
      className={dark ? 'dark' : ''}
      style={{ height: '100vh', colorScheme: dark ? 'dark' : 'light' }}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <PlaybackChrome course={course} dark={dark} onToggleTheme={toggleTheme} />
      </div>
    </div>
  );
}
