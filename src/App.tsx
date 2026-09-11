import { useCallback, useMemo, useState } from 'react';
// 课程数据统一放在仓库根的 data/ 目录，与代码分离（由 scripts/build-course.mjs 生成）。
import data from '../data/data.json';
import type { Course } from './types';
import { PlaybackChrome } from './components/PlaybackChrome';

export default function App() {
  const course = useMemo<Course>(() => data as Course, []);
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
