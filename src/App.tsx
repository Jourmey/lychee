import { useCallback, useMemo, useState } from 'react';
import data from './data.json';
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
