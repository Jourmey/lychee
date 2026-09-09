import {
  ChevronLeft,
  ChevronRight,
  LayoutList,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pause,
  PencilLine,
  Play,
  Repeat,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '../lib/cn';
import type { EngineState } from '../lib/usePlayback';

const ctrlBtn = cn(
  'relative w-7 h-7 rounded-md flex items-center justify-center',
  'transition-all duration-150 outline-none cursor-pointer',
  'hover:bg-gray-500/[0.08] dark:hover:bg-gray-400/[0.08] active:scale-90',
);

function Divider() {
  return <div className="w-px h-3 bg-gray-200/80 dark:bg-gray-700/60 mx-0.5 shrink-0" />;
}

function VolumeIcon({ muted, volume }: { muted: boolean; volume: number }) {
  const cls = 'w-3.5 h-3.5';
  if (muted || volume === 0) return <VolumeX className={cls} />;
  if (volume < 0.5) return <Volume1 className={cls} />;
  return <Volume2 className={cls} />;
}

export function CanvasToolbar({
  currentSceneIndex,
  scenesCount,
  engineState,
  whiteboardOpen,
  hasWhiteboardContent,
  sidebarCollapsed,
  onToggleSidebar,
  onPrevSlide,
  onNextSlide,
  onPlayPause,
  onToggleWhiteboard,
  onToggleFullscreen,
  onToggleChat,
  chatCollapsed,
  isPresenting,
}: {
  readonly currentSceneIndex: number;
  readonly scenesCount: number;
  readonly engineState: EngineState;
  readonly whiteboardOpen: boolean;
  readonly hasWhiteboardContent: boolean;
  readonly sidebarCollapsed: boolean;
  readonly onToggleSidebar: () => void;
  readonly onPrevSlide: () => void;
  readonly onNextSlide: () => void;
  readonly onPlayPause: () => void;
  readonly onToggleWhiteboard: () => void;
  readonly onToggleFullscreen: () => void;
  readonly onToggleChat: () => void;
  readonly chatCollapsed: boolean;
  readonly isPresenting: boolean;
}) {
  const canGoPrev = currentSceneIndex > 0;
  const canGoNext = currentSceneIndex < scenesCount - 1;

  return (
    <div className="flex items-center gap-2">
      {/* ── Left: sidebar toggle + page indicator ── */}
      <div className="flex items-center gap-1 shrink-0 pl-1">
        <button
          onClick={onToggleSidebar}
          className={cn(
            ctrlBtn,
            'w-6 h-6',
            sidebarCollapsed ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300',
          )}
          aria-label="Toggle sidebar"
        >
          <LayoutList className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums select-none font-medium">
          {currentSceneIndex + 1}
          <span className="opacity-35 mx-px">/</span>
          {scenesCount}
        </span>
      </div>

      <Divider />

      {/* ── Center: unified playback controls ── */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        <div className="inline-flex items-center gap-0.5 px-1 h-7 bg-gray-100/60 dark:bg-gray-800/60 rounded-lg">
          <span
            className={cn(
              ctrlBtn,
              'w-6 h-6',
              engineState === 'playing' ? 'text-violet-600 dark:text-violet-400' : 'text-gray-400 dark:text-gray-500',
            )}
          >
            <VolumeIcon muted={false} volume={1} />
          </span>

          {scenesCount > 1 && (
            <button
              onClick={onPrevSlide}
              disabled={!canGoPrev}
              className={cn(
                ctrlBtn,
                'w-6 h-6 text-gray-500 dark:text-gray-400 disabled:opacity-20 disabled:pointer-events-none',
              )}
              aria-label="Previous"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={onPlayPause}
            className={cn(
              ctrlBtn,
              'w-7 h-6',
              engineState === 'playing'
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-500 dark:text-gray-400',
            )}
            aria-label={engineState === 'playing' ? 'Pause' : 'Play'}
          >
            {engineState === 'playing' ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5 ml-px" />
            )}
          </button>

          {scenesCount > 1 && (
            <button
              onClick={onNextSlide}
              disabled={!canGoNext}
              className={cn(
                ctrlBtn,
                'w-6 h-6 text-gray-500 dark:text-gray-400 disabled:opacity-20 disabled:pointer-events-none',
              )}
              aria-label="Next"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}

          <Divider />

          <button
            className={cn(ctrlBtn, 'w-8 h-6 text-gray-500 dark:text-gray-400')}
            aria-label="Auto-play"
            title="自动播放"
          >
            <Repeat className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onToggleWhiteboard}
            className={cn(
              ctrlBtn,
              'w-6 h-6',
              whiteboardOpen ? 'text-violet-600 dark:text-violet-400' : 'text-gray-500 dark:text-gray-400',
            )}
            title={whiteboardOpen ? '收起白板' : '打开白板'}
          >
            <PencilLine className="w-3.5 h-3.5" />
            {!whiteboardOpen && hasWhiteboardContent && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-violet-500 dark:bg-violet-400 rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* ── Right: fullscreen + chat toggle ── */}
      <div className="flex items-center justify-end gap-px shrink-0 pr-1">
        <Divider />
        <button
          onClick={onToggleFullscreen}
          className={cn(
            ctrlBtn,
            'w-6 h-6',
            isPresenting ? 'text-violet-600 dark:text-violet-400' : 'text-gray-500 dark:text-gray-400',
          )}
          aria-label="Fullscreen"
          title={isPresenting ? '退出全屏' : '全屏'}
        >
          {isPresenting ? (
            <Minimize2 className="w-3.5 h-3.5" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={onToggleChat}
          className={cn(
            ctrlBtn,
            'w-6 h-6',
            chatCollapsed ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300',
          )}
          aria-label="Toggle chat"
          title={chatCollapsed ? '展开对话' : '收起对话'}
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
