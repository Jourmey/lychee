import { useCallback, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/**
 * 拖拽改尺寸 —— 左侧栏 / 右侧栏 / 顶栏 / 底部面板共用。
 *
 * 按下手柄后监听 mousemove，把鼠标位移量加到「按下那一刻的尺寸」上，夹到 [min, max]。
 *   axis   'x' = 改宽（左右面板），'y' = 改高（上下面板）
 *   invert 面板在右/下侧、手柄落在它的左/上边缘时置 true —— 此时往左/上拖才是变大
 *
 * ⚠️ 拖拽期间必须铺一层全屏遮罩：课件区是跨域 <iframe>，鼠标滑到它上方时
 * 事件会被 iframe 吞掉 —— mousemove 断流（面板不跟手）、mouseup 丢失
 * （松手后仍在拖）。遮罩把 iframe 盖住，事件始终留在父文档。
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
  /** 尺寸镜像 —— 避免 mousemove 回调读到过期的 state。 */
  const sizeRef = useRef(initial);
  /** 是否正在拖 —— 防止残留监听器叠加出「多个面板一起动」。 */
  const activeRef = useRef(false);

  const onDragStart = useCallback(
    (e: ReactMouseEvent) => {
      if (e.button !== 0 || activeRef.current) return;
      e.preventDefault();
      activeRef.current = true;

      const startPos = axis === 'x' ? e.clientX : e.clientY;
      const startSize = sizeRef.current;
      const dir = invert ? -1 : 1;
      const cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      setDragging(true);

      // 全屏遮罩：挡住 <iframe>，保证 mousemove/mouseup 都落在父文档里。
      const shield = document.createElement('div');
      shield.style.cssText = `position:fixed;inset:0;z-index:9999;cursor:${cursor};`;
      document.body.appendChild(shield);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = 'none';

      const onMove = (me: MouseEvent) => {
        const pos = axis === 'x' ? me.clientX : me.clientY;
        const next = Math.min(max, Math.max(min, startSize + (pos - startPos) * dir));
        sizeRef.current = next;
        setSize(next);
      };
      const stop = () => {
        if (!activeRef.current) return;
        activeRef.current = false;
        setDragging(false);
        shield.remove();
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', stop, true);
        window.removeEventListener('blur', stop, true);
      };

      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', stop, true);
      // 窗口失焦（切标签/切应用）时收尾，否则监听器会一直挂着。
      window.addEventListener('blur', stop, true);
    },
    [axis, invert, max, min],
  );

  return { size, dragging, onDragStart };
}
