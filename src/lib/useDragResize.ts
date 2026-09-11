import { useCallback, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/**
 * 拖拽改尺寸 —— 左侧栏 / 右侧栏 / 顶栏 / 底部面板共用。
 *
 * 按下手柄后监听 mousemove，把鼠标位移量加到「按下那一刻的尺寸」上，夹到 [min, max]。
 *   axis   'x' = 改宽（左右面板），'y' = 改高（上下面板）
 *   invert 面板在右/下侧、手柄落在它的左/上边缘时置 true —— 此时往左/上拖才是变大
 */
export function useDragResize({
  axis,
  initial,
  min,
  max,
  invert = false,
}: {
  axis: 'x' | 'y';
  initial: number;
  min: number;
  max: number;
  invert?: boolean;
}) {
  const [size, setSize] = useState(initial);
  /** 拖拽中 —— 用来临时关掉尺寸的过渡动画，否则跟手会有延迟。 */
  const [dragging, setDragging] = useState(false);

  const onDragStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startPos = axis === 'x' ? e.clientX : e.clientY;
      const startSize = size;
      setDragging(true);

      const handleMouseMove = (me: MouseEvent) => {
        const pos = axis === 'x' ? me.clientX : me.clientY;
        const delta = (pos - startPos) * (invert ? -1 : 1);
        setSize(Math.min(max, Math.max(min, startSize + delta)));
      };
      const handleMouseUp = () => {
        setDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [axis, invert, max, min, size],
  );

  return { size, dragging, onDragStart };
}
