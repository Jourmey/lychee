import type { WhiteboardItem } from '../types';

/**
 * Whiteboard — a drawing layer rendered in the slide's design coordinate
 * system (viewportSize × viewportSize*viewportRatio), placed over the slide
 * card by SlideStage. It is purely display-only for the demo; wb_draw_* items
 * are positioned by the playback engine in design px.
 */
export function Whiteboard({
  items,
  viewportSize,
  viewportRatio,
}: {
  readonly items: WhiteboardItem[];
  readonly viewportSize: number;
  readonly viewportRatio: number;
}) {
  const height = viewportSize * viewportRatio;
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <svg
        className="absolute left-0 top-0"
        width={viewportSize}
        height={height}
        viewBox={`0 0 ${viewportSize} ${height}`}
      >
        {items
          .filter((it) => it.kind === 'line')
          .map((it) => (
            <line
              key={it.id}
              x1={it.startX}
              y1={it.startY}
              x2={it.endX}
              y2={it.endY}
              stroke={it.color}
              strokeWidth={3}
              strokeLinecap="round"
            />
          ))}
      </svg>

      {items.map((it) => {
        if (it.kind === 'line') return null;
        if (it.kind === 'text') {
          return (
            <div
              key={it.id}
              style={{
                position: 'absolute',
                left: it.x,
                top: it.y,
                width: it.width,
                height: it.height,
                fontSize: it.fontSize,
                color: it.color,
                fontWeight: 700,
                whiteSpace: 'pre-wrap',
              }}
            >
              {it.content}
            </div>
          );
        }
        if (it.kind === 'shape') {
          const base: React.CSSProperties = {
            position: 'absolute',
            left: it.x,
            top: it.y,
            width: it.width,
            height: it.height,
            background: it.fillColor,
          };
          if (it.shape === 'circle') {
            return <div key={it.id} style={{ ...base, borderRadius: '9999px' }} />;
          }
          if (it.shape === 'triangle') {
            return (
              <div
                key={it.id}
                style={{
                  ...base,
                  background: 'transparent',
                  width: 0,
                  height: 0,
                  left: it.x,
                  top: it.y,
                  borderLeft: `${it.width / 2}px solid transparent`,
                  borderRight: `${it.width / 2}px solid transparent`,
                  borderBottom: `${it.height}px solid ${it.fillColor}`,
                }}
              />
            );
          }
          return <div key={it.id} style={{ ...base, borderRadius: 6 }} />;
        }
        return null;
      })}
    </div>
  );
}
