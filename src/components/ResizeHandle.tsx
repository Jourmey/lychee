import type { MouseEvent as ReactMouseEvent } from 'react';
import { cn } from '../lib/cn';

/**
 * 面板边缘的拖拽手柄。四个面板共用，视觉沿用左侧栏原来那只（悬停淡紫、中间一根短圆条）。
 *
 * `edge` 是手柄贴住的那条边：左栏贴右边、右栏贴左边、顶栏贴下边、底栏贴上边。
 * 调用方负责给外层容器加 `relative`。
 */
export function ResizeHandle({
  edge,
  onMouseDown,
}: {
  edge: 'left' | 'right' | 'top' | 'bottom';
  onMouseDown: (e: ReactMouseEvent) => void;
}) {
  const vertical = edge === 'left' || edge === 'right';
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        'absolute z-50 group transition-colors',
        'hover:bg-purple-400/30 dark:hover:bg-purple-600/30 active:bg-purple-500/40 dark:active:bg-purple-500/40',
        vertical
          ? cn('top-0 bottom-0 w-1.5 cursor-col-resize', edge === 'left' ? 'left-0' : 'right-0')
          : cn('left-0 right-0 h-1.5 cursor-row-resize', edge === 'top' ? 'top-0' : 'bottom-0'),
      )}
    >
      {/* 中间的短圆条 */}
      <div
        className={cn(
          'absolute rounded-full bg-gray-300 dark:bg-gray-600 group-hover:bg-purple-400 dark:group-hover:bg-purple-500 transition-colors',
          vertical
            ? cn('top-1/2 -translate-y-1/2 w-0.5 h-8', edge === 'left' ? 'left-0.5' : 'right-0.5')
            : cn('left-1/2 -translate-x-1/2 h-0.5 w-8', edge === 'top' ? 'top-0.5' : 'bottom-0.5'),
        )}
      />
    </div>
  );
}
