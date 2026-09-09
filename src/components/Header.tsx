import { ArrowLeft, Download, Moon, Settings, Sun } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Header — playback top bar. Mirrors OpenMAIC's `Header`: a back arrow + the
 * current scene title on the left, and the global-controls cluster on the
 * right (theme/settings pill + a decorative Pro switch + export).
 */
export function Header({
  currentSceneTitle,
  onBack,
  dark,
  onToggleTheme,
}: {
  readonly currentSceneTitle: string;
  readonly onBack?: () => void;
  readonly dark?: boolean;
  readonly onToggleTheme?: () => void;
}) {
  return (
    <header className="h-20 px-8 flex items-center justify-between z-10 bg-transparent gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button
          onClick={onBack}
          className="shrink-0 p-2 rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          title="返回首页"
          aria-label="返回首页"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400 dark:text-gray-500 mb-0.5">
            当前场景
          </span>
          <h1
            className="text-xl font-bold text-gray-800 dark:text-gray-200 tracking-tight truncate"
            suppressHydrationWarning
          >
            {currentSceneTitle}
          </h1>
        </div>
      </div>

      <HeaderControls dark={dark} onToggleTheme={onToggleTheme} />
    </header>
  );
}

function HeaderControls({
  dark,
  onToggleTheme,
}: {
  readonly dark?: boolean;
  readonly onToggleTheme?: () => void;
}) {
  return (
    <div className="flex items-center gap-4">
      {/* Global capsule: theme + settings */}
      <div className="shrink-0 flex items-center gap-1 backdrop-blur-md shadow-sm rounded-full bg-white/60 dark:bg-gray-800/60 border border-gray-100/50 dark:border-gray-700/50 px-2 py-1.5">
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all group"
          aria-label="主题"
        >
          {dark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
        <button
          className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all group"
          aria-label="设置"
        >
          <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
        </button>
      </div>

      {/* Pro switch (decorative in the demo) */}
      <label
        className={cn(
          'shrink-0 inline-flex items-center gap-2.5 rounded-full border shadow-sm transition-colors duration-200',
          'bg-white/60 dark:bg-gray-800/60 backdrop-blur-md',
          'h-9 px-3',
          'border-gray-100/50 dark:border-gray-700/50 cursor-pointer hover:border-violet-400/60 dark:hover:border-violet-500/50',
        )}
        title="Pro 模式(演示为只读)"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] tabular-nums select-none transition-colors duration-200 text-gray-500 dark:text-gray-400">
          Pro
        </span>
        <span className="relative inline-flex h-5 w-9 shrink-0 rounded-full bg-gray-200 dark:bg-gray-700 transition-colors">
          <span className="absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow-sm transition-transform" />
        </span>
      </label>

      {/* Export */}
      <button
        className="shrink-0 p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm"
        aria-label="导出"
      >
        <Download className="w-4 h-4" />
      </button>
    </div>
  );
}
