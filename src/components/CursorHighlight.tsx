import { motion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';

/**
 * CursorHighlight —— 课件区之上的「老师鼠标」层。
 *
 * 视觉复刻 @openmaic/renderer 的 `LaserOverlay`：10px 圆点 + 脉冲环。
 * 区别是光标**常驻**：不像原版 LaserOverlay 那样飞入/停留/飞出，而是像真实直播里
 * 老师那只鼠标一样一直在，讲到哪就移到哪，之后停在原地等下一个点。
 *
 * 坐标：content/pages.json 给的是相对**课件画布**（ITS 的 1365×768）的比例 0~1。
 * ITS 播放器把画布按 `contain` 缩放（scale = min(vw/1365, vh/768)）并居中，两侧/上下留黑边，
 * 所以这里先按浮层实际尺寸算出画布矩形，再把比例换算成像素 —— 否则窗口比例一变就偏。
 */
/** 取自 LaserOverlay 的默认色与尺寸。 */
const COLOR = '#ff3b30';
const DOT_SIZE = 10;
/** ITS 课件画布尺寸（wholeAttr 1365×768）。 */
const CANVAS_W = 1365;
const CANVAS_H = 768;
/** 没有任何轨迹数据时的「停靠点」—— 画面右下角，像鼠标停在旁边。 */
const PARK = { x: 0.82, y: 0.88 };

export function CursorHighlight({
  highlight,
}: {
  /** 相对课件画布的比例 0~1；null = 本页无数据，沿用上一个位置。 */
  readonly highlight: { x: number; y: number } | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** 光标常驻：记住最后位置，highlight 为空时不消失。 */
  const [pos, setPos] = useState(PARK);

  // 浮层与 iframe 同尺寸 → 量它就等于量播放器视口。
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (highlight) setPos(highlight);
  }, [highlight]);

  // ITS 用 contain 缩放 + 居中 → 画布在视口里的矩形。
  const scale = size.w > 0 && size.h > 0 ? Math.min(size.w / CANVAS_W, size.h / CANVAS_H) : 0;
  const canvasW = CANVAS_W * scale;
  const canvasH = CANVAS_H * scale;
  const left = (size.w - canvasW) / 2 + pos.x * canvasW;
  const top = (size.h - canvasH) / 2 + pos.y * canvasH;

  return (
    <div ref={boxRef} className="absolute inset-0 z-30 pointer-events-none">
      {scale > 0 && (
        <motion.div
          initial={false}
          animate={{ left, top }}
          transition={{
            left: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
            top: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
          }}
          style={{ position: 'absolute' }}
        >
          <div style={{ position: 'relative', transform: 'translate(-50%, -50%)' }}>
            {/* 脉冲环 */}
            <motion.div
              animate={{ scale: [1, 2.8], opacity: [0.6, 0] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'easeOut', repeatDelay: 0.3 }}
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '9999px',
                border: `1.5px solid ${COLOR}`,
              }}
            />
            {/* 圆点 */}
            <div
              style={{
                width: DOT_SIZE,
                height: DOT_SIZE,
                borderRadius: '9999px',
                backgroundColor: COLOR,
                boxShadow: `0 0 8px 2px ${COLOR}60`,
              }}
            />
          </div>
        </motion.div>
      )}
    </div>
  );
}
