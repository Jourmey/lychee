import { useCallback, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';
import { PlaybackPage } from './pages/PlaybackPage';

/**
 * 两层结构：首页（课程列表）→ 播放页（`#/course/<数据集目录名>`）。
 *
 * 用 **HashRouter** 而非 BrowserRouter：部署到 OSS/CDN 静态环境没有 SPA fallback，
 * `BrowserRouter` 深链/刷新会 404；`HashRouter` 零服务端配置（代价只是 URL 带 `#`）。
 *
 * 主题（`dark` / `toggleTheme`）留在这一层 —— `.dark` 包裹层罩住两个路由，
 * 跨页切换保持。
 */
export default function App() {
  const [dark, setDark] = useState(true);
  const toggleTheme = useCallback(() => setDark((prev) => !prev), []);

  return (
    <div
      className={dark ? 'dark' : ''}
      style={{ height: '100vh', colorScheme: dark ? 'dark' : 'light' }}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomePage dark={dark} onToggleTheme={toggleTheme} />} />
            <Route
              path="/course/:id"
              element={<PlaybackPage dark={dark} onToggleTheme={toggleTheme} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </div>
    </div>
  );
}
