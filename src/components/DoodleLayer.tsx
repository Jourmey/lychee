import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ActiveDoodle, CourseDoodle, CourseDoodleKind } from '../types';

/**
 * DoodleLayer —— 课件区之上的「老师批注」层。
 *
 * 老师的圈画/下划线/箭头/手写批注只存在于录课视频的像素里（ITS 无结构化涂鸦数据），
 * 所以坐标由 `<DATASET>/pages.json` 手工标注成**课件画布比例**，这里在 iframe 之上重绘。
 *
 * 坐标系与 `CursorHighlight` 一致：ITS 把 1365×768 的画布按 `contain` 缩放并居中，
 * 故先用浮层实际尺寸算出画布矩形，再把比例换算成像素。
 *
 * 视觉：手写感 —— 路径加确定性抖动（不用随机数，避免每帧重画时抖动），圆头线帽，
 * 出现时用 `stroke-dashoffset` 从起点「写」出来。
 */

const CANVAS_W = 1365;
const CANVAS_H = 768;
const DEFAULT_COLOR = '#ff3b30';
const STROKE_W = 3.2;

/** 手写字体栈：中文优先楷体，退回 cursive。 */
const HAND_FONT = "'Kaiti SC', 'STKaiti', 'KaiTi', 'Songti SC', cursive, sans-serif";

/** 确定性伪随机（-1~1），用种子固定，保证同一笔每次渲染抖动一致。 */
function jitter(seed: number, i: number): number {
  const s = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** 把一条线段采样成带抖动的折线点。 */
function wobble(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  amp = 2.2,
  segs = 10,
): string {
  const pts: string[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const px = x1 + (x2 - x1) * t + jitter(seed, i) * amp * (i === 0 || i === segs ? 0 : 1);
    const py = y1 + (y2 - y1) * t + jitter(seed + 9, i) * amp * (i === 0 || i === segs ? 0 : 1);
    pts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`);
  }
  return pts.join(' ');
}

/** 沿椭圆画一圈带抖动的手写圈（起点在左上，顺时针）。 */
function wobbleEllipse(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const segs = 42;
  const pts: string[] = [];
  // 起点略偏左上、终点略微越过起点，模拟手画圈「收口不严」。
  const start = -0.35;
  const end = Math.PI * 2 - 0.05;
  for (let i = 0; i <= segs; i++) {
    const a = start + ((end - start) * i) / segs;
    const px = cx + Math.cos(a) * rx + jitter(seed, i) * 2.6;
    const py = cy + Math.sin(a) * ry + jitter(seed + 5, i) * 2.6;
    pts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`);
  }
  return pts.join(' ');
}

/** 左侧括号（把一段话括起来）：上下两笔短横 + 中间一竖，带手写弧度。 */
function bracketPath(x: number, y: number, w: number, h: number, seed: number): string {
  const r = Math.min(w, h * 0.4);
  const left = x + r;
  const top = y;
  const bot = y + h;
  return (
    wobble(x + r, top, left + w * 0.2, top, seed, 1.2, 6).replace('M', 'M') +
    ' ' +
    `M${x + r},${top} Q${x + 1},${(top + bot) / 2} ${x + r},${bot}` +
    ' ' +
    wobble(x + r, bot, left + w * 0.2, bot, seed + 3, 1.2, 6)
  );
}

/** 箭头：一条抖动的杆 + 两条箭头线。 */
function arrowPath(
  x: number,
  y: number,
  w: number,
  h: number,
  dir: 'down' | 'up' | 'right' | 'left',
  seed: number,
): { shaft: string; head: string } {
  const cx = x + w / 2;
  const cy = y + h / 2;
  let x1 = x;
  let y1 = y;
  let x2 = x + w;
  let y2 = y + h;
  if (dir === 'down') {
    x1 = cx;
    y1 = y;
    x2 = cx;
    y2 = y + h;
  } else if (dir === 'up') {
    x1 = cx;
    y1 = y + h;
    x2 = cx;
    y2 = y;
  } else if (dir === 'right') {
    x1 = x;
    y1 = cy;
    x2 = x + w;
    y2 = cy;
  } else if (dir === 'left') {
    x1 = x + w;
    y1 = cy;
    x2 = x;
    y2 = cy;
  }
  const shaft = wobble(x1, y1, x2, y2, seed, 1.6, 8);
  const size = Math.max(8, Math.min(w, h) * 0.45);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const a1x = x2 - size * Math.cos(ang - 0.5);
  const a1y = y2 - size * Math.sin(ang - 0.5);
  const a2x = x2 - size * Math.cos(ang + 0.5);
  const a2y = y2 - size * Math.sin(ang + 0.5);
  const head = `M${a1x.toFixed(1)},${a1y.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} L${a2x.toFixed(1)},${a2y.toFixed(1)}`;
  return { shaft, head };
}

type Ink = { src: string; x: number; y: number; w: number; h: number };
type Built =
  | { kind: 'path'; d: string }
  | { kind: 'text'; x: number; y: number; text: string; fontSize: number }
  | { kind: 'ink'; ink: Ink };

/** 一笔的几何描述（画布 px）→ SVG 元素（一条笔画可拆成多条 path）。 */
function buildPaths(d: CourseDoodle, key: string): Built[] {
  // 像素笔迹：直接用从录像里抠出的透明 PNG，位置/形状与当年老师写的一模一样。
  if (d.kind === 'ink') {
    if (!d.src) return [];
    return [
      {
        kind: 'ink',
        ink: { src: d.src, x: d.x * CANVAS_W, y: d.y * CANVAS_H, w: (d.w ?? 0) * CANVAS_W, h: (d.h ?? 0) * CANVAS_H },
      },
    ];
  }
  const x = d.x * CANVAS_W;
  const y = d.y * CANVAS_H;
  const w = (d.w ?? 0) * CANVAS_W;
  const h = (d.h ?? 0) * CANVAS_H;
  const seed = (key.length * 7 + Math.round(x) + Math.round(y)) % 997;

  switch (d.kind as CourseDoodleKind) {
    case 'underline': {
      // 贴近框底、略微上抬，手写感：两段轻微起伏的横线。
      const yy = y + h;
      const mid = x + (x + w) / 2;
      return [
        { kind: 'path', d: wobble(x, yy, mid, yy - 1.5, seed, 2.0, 8) },
        { kind: 'path', d: wobble(mid, yy - 1.5, x + w, yy, seed + 11, 2.0, 8) },
      ];
    }
    case 'strike': {
      return [{ kind: 'path', d: wobble(x, y, x + w, y + h, seed, 2.6, 10) }];
    }
    case 'circle': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return [{ kind: 'path', d: wobbleEllipse(cx, cy, w / 2, h / 2, seed) }];
    }
    case 'bracket': {
      return [{ kind: 'path', d: bracketPath(x, y, w, h, seed) }];
    }
    case 'arrow': {
      const { shaft, head } = arrowPath(x, y, w, h, d.dir ?? 'down', seed);
      return [{ kind: 'path', d: shaft }, { kind: 'path', d: head }];
    }
    case 'freehand': {
      const pts = d.points ?? [];
      if (pts.length < 2) return [];
      const path = pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p[0] * CANVAS_W).toFixed(1)},${(p[1] * CANVAS_H).toFixed(1)}`)
        .join(' ');
      return [{ kind: 'path', d: path }];
    }
    case 'text': {
      return [{ kind: 'text', x, y, text: d.text ?? '', fontSize: d.fontSize ?? 26 }];
    }
    default:
      return [];
  }
}

export function DoodleLayer({ doodles }: { readonly doodles: ActiveDoodle[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ITS 用 contain 缩放 + 居中 → 画布在浮层里的矩形（与 CursorHighlight 一致）。
  const scale = size.w > 0 && size.h > 0 ? Math.min(size.w / CANVAS_W, size.h / CANVAS_H) : 0;
  const offX = (size.w - CANVAS_W * scale) / 2;
  const offY = (size.h - CANVAS_H * scale) / 2;

  const items = useMemo(
    () =>
      doodles.flatMap((d) =>
        buildPaths(d, d.key).map((built, i) => ({ built, key: `${d.key}#${i}`, color: d.color ?? DEFAULT_COLOR })),
      ),
    [doodles],
  );

  return (
    <div ref={boxRef} className="absolute inset-0 z-20 pointer-events-none">
      {scale > 0 && (
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          style={{
            position: 'absolute',
            left: offX,
            top: offY,
            width: CANVAS_W * scale,
            height: CANVAS_H * scale,
            overflow: 'visible',
          }}
        >
          {items.map((it) => {
            if (it.built.kind === 'ink') {
              return (
                <image
                  key={it.key}
                  href={it.built.ink.src}
                  x={it.built.ink.x}
                  y={it.built.ink.y}
                  width={it.built.ink.w}
                  height={it.built.ink.h}
                  preserveAspectRatio="none"
                  style={{ animation: 'doodle-ink-in 0.5s ease-out both' }}
                />
              );
            }
            if (it.built.kind === 'text') {
              return (
                <text
                  key={it.key}
                  x={it.built.x}
                  y={it.built.y + it.built.fontSize}
                  fill={it.color}
                  style={{
                    fontFamily: HAND_FONT,
                    fontSize: it.built.fontSize,
                    fontWeight: 600,
                  }}
                >
                  {it.built.text}
                </text>
              );
            }
            return (
              <path
                key={it.key}
                d={it.built.d}
                fill="none"
                stroke={it.color}
                strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={1}
                style={{ animation: 'doodle-write 0.45s ease-out both' }}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
