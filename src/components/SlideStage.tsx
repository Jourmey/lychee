import { useRef, useState } from 'react';
import { SlideCanvas, useViewportSize, type SlideEffects } from '@openmaic/renderer';
import type { PPTImageElement, Slide } from '@openmaic/dsl';
import { ImageOff } from 'lucide-react';
import { Whiteboard } from './Whiteboard';
import type { WhiteboardItem } from '../types';

const CANVAS_PERCENTAGE = 94;

/**
 * Graceful image fallback: if the resolved src 404s (assets not yet provided),
 * show a neutral placeholder instead of a broken-image icon.
 */
function SlideImage({
  element,
  src,
}: {
  readonly element: PPTImageElement;
  readonly src: string;
}) {
  const [broken, setBroken] = useState(false);

  if (broken || !src) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-100/70 dark:bg-gray-800/60">
        <div className="flex flex-col items-center gap-1 text-gray-400">
          <ImageOff className="w-5 h-5" />
          {element.name && (
            <span className="text-[10px] font-medium text-gray-400">{element.name}</span>
          )}
        </div>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={element.name ?? ''}
      className="h-full w-full"
      style={{ objectFit: 'contain' }}
      onError={() => setBroken(true)}
      onLoad={() => setBroken(false)}
    />
  );
}

/**
 * SlideStage — the stage core. Renders the slide via `@openmaic/renderer`'s
 * `SlideCanvas` (the same component OpenMAIC uses), applies play-time effects,
 * and layers the whiteboard exactly over the slide card using the same
 * viewport-fit math the renderer uses.
 */
export function SlideStage({
  slide,
  effects,
  whiteboardOpen,
  whiteboardItems,
}: {
  readonly slide: Slide;
  readonly effects: SlideEffects;
  readonly whiteboardOpen?: boolean;
  readonly whiteboardItems?: WhiteboardItem[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewportStyles, fitScale } = useViewportSize(containerRef, {
    viewportSize: slide.viewportSize,
    viewportRatio: slide.viewportRatio,
    canvasPercentage: CANVAS_PERCENTAGE,
  });

  const slideW = slide.viewportSize * fitScale;
  const slideH = slide.viewportSize * slide.viewportRatio * fitScale;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden select-none">
      <div className="absolute inset-0">
        <SlideCanvas
          slide={slide}
          effects={effects}
          canvasPercentage={CANVAS_PERCENTAGE}
          chrome
          elementIdPrefix="screen-"
          className="w-full h-full"
          renderImage={(element, resolvedSrc) => (
            <SlideImage element={element} src={resolvedSrc} />
          )}
        />
      </div>

      {whiteboardOpen && whiteboardItems && whiteboardItems.length > 0 && (
        <div
          className="pointer-events-none absolute rounded-lg"
          style={{
            left: viewportStyles.left,
            top: viewportStyles.top,
            width: slideW,
            height: slideH,
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: slide.viewportSize,
              height: slide.viewportSize * slide.viewportRatio,
              transform: `scale(${fitScale})`,
            }}
          >
            <Whiteboard
              items={whiteboardItems}
              viewportSize={slide.viewportSize}
              viewportRatio={slide.viewportRatio}
            />
          </div>
        </div>
      )}
    </div>
  );
}
