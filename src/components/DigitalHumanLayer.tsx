import { useCallback, useEffect, useRef, useState } from 'react';
import { DigitalHuman, type HumanRole } from './DigitalHuman';

/**
 * DigitalHumanLayer — 浮在课件区之上的两个 2D 数字人（老师 / AI 助教），可拖动。
 *
 * - 覆盖层本身 `pointer-events-none`，只有头像本体放行事件 —— 课件 iframe 照常可点。
 * - 拖动走 Pointer Events + `setPointerCapture`：指针划过 iframe 时事件仍回到头像，
 *   不会被 iframe 吞掉；`touch-action: none` 避免触屏下拖动变滚动。
 * - 位置以「相对本层左上角的 px」存，尺寸变化（改窗口 / 收起侧栏）时重新钳回可视区。
 */

const AVATAR_SIZE = 112;
const GAP = 10;
const MARGIN = 16;
/** 头像 + 名牌的总高（名牌 ≈ 24px）。 */
const AVATAR_BOX_H = Math.round(AVATAR_SIZE * 1.08) + 26;
const ROLES: HumanRole[] = ['teacher', 'assistant'];

interface Point {
  x: number;
  y: number;
}

export function DigitalHumanLayer({
  speakingRole,
  teacherName,
  assistantName,
}: {
  /** 当前正在说话的角色；null = 没人在说（暂停 / 本页未开始）。 */
  readonly speakingRole: HumanRole | null;
  readonly teacherName: string;
  readonly assistantName: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ role: HumanRole; dx: number; dy: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pos, setPos] = useState<Record<HumanRole, Point | null>>({
    teacher: null,
    assistant: null,
  });
  const [dragging, setDragging] = useState<HumanRole | null>(null);

  const clampTo = useCallback(
    (p: Point, s: { w: number; h: number }): Point => ({
      x: Math.min(Math.max(0, p.x), Math.max(0, s.w - AVATAR_SIZE)),
      y: Math.min(Math.max(0, p.y), Math.max(0, s.h - AVATAR_BOX_H)),
    }),
    [],
  );

  /** 默认落位：右上角并排，助教在最右（对齐录课画面里老师视频窗的位置）。 */
  const defaultPos = useCallback(
    (role: HumanRole, s: { w: number; h: number }): Point => {
      const order = role === 'assistant' ? 0 : 1;
      return clampTo(
        {
          x: s.w - MARGIN - AVATAR_SIZE - order * (AVATAR_SIZE + GAP),
          y: MARGIN,
        },
        s,
      );
    },
    [clampTo],
  );

  // 量覆盖层尺寸；尺寸变化时把已拖走的位置重新钳回可视区。
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const sync = (w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      const s = { w, h };
      setSize(s);
      setPos((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const role of ROLES) {
          const p = next[role];
          if (!p) continue;
          const c = clampTo(p, s);
          if (c.x !== p.x || c.y !== p.y) {
            next[role] = c;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) sync(r.width, r.height);
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    sync(rect.width, rect.height);
    return () => ro.disconnect();
  }, [clampTo]);

  const pointOf = (role: HumanRole): Point => pos[role] ?? defaultPos(role, size);

  const onPointerDown = (role: HumanRole) => (e: React.PointerEvent<HTMLDivElement>) => {
    const el = layerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cur = pointOf(role);
    dragRef.current = {
      role,
      dx: e.clientX - rect.left - cur.x,
      dy: e.clientY - rect.top - cur.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(role);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const el = layerRef.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    setPos((prev) => ({
      ...prev,
      [d.role]: clampTo(
        { x: e.clientX - rect.left - d.dx, y: e.clientY - rect.top - d.dy },
        { w: rect.width, h: rect.height },
      ),
    }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* 指针已释放，忽略 */
      }
    }
    dragRef.current = null;
    setDragging(null);
  };

  // 尺寸未知时先不渲染，避免「先落在左上角再跳到右下角」的闪动。
  if (size.w <= 0) return <div ref={layerRef} className="absolute inset-0 z-40 pointer-events-none" />;

  return (
    <div ref={layerRef} className="absolute inset-0 z-40 pointer-events-none">
      {ROLES.map((role) => {
        const p = pointOf(role);
        const speaking = speakingRole === role;
        return (
          <div
            key={role}
            data-role={role}
            data-speaking={speaking ? 'true' : 'false'}
            className="absolute pointer-events-auto"
            style={{
              left: p.x,
              top: p.y,
              width: AVATAR_SIZE,
              cursor: dragging === role ? 'grabbing' : 'grab',
              touchAction: 'none',
              filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.3))',
              animation: 'dh-pop 0.36s cubic-bezier(0.22,1,0.36,1) both',
              animationDelay: role === 'teacher' ? '0s' : '0.08s',
            }}
            title={`${role === 'teacher' ? teacherName : assistantName} · 按住可拖动`}
            onPointerDown={onPointerDown(role)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <DigitalHuman
              role={role}
              name={role === 'teacher' ? teacherName : assistantName}
              speaking={speaking}
              size={AVATAR_SIZE}
            />
          </div>
        );
      })}
    </div>
  );
}
