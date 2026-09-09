import type { Action, Slide, SceneType } from '@openmaic/dsl';

/**
 * Lychee course data contract.
 *
 * This is the single JSON that drives the whole classroom demo. Everything an
 * author needs to fill in lives here: course metadata, per-scene (per-page)
 * courseware, per-page audio, and the lecturer's script/actions.
 *
 * The `Slide` and `Action` shapes come straight from `@openmaic/dsl`, so a deck
 * produced for OpenMAIC will render 1:1 here.
 */

/** A single whiteboard stroke/element drawn by a `wb_draw_*` action. */
export interface WhiteboardItem {
  id: string;
  kind: 'text' | 'line' | 'shape' | 'chart' | 'latex' | 'table' | 'code';
  x: number;
  y: number;
  width: number;
  height: number;
  /** For text / latex */
  content?: string;
  fontSize?: number;
  color?: string;
  /** For shape */
  shape?: 'rectangle' | 'circle' | 'triangle';
  fillColor?: string;
  /** For line */
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

/** A scene as authored in data.json. Only 'slide' scenes are rendered by the demo. */
export interface CourseScene {
  id: string;
  type: SceneType;
  title: string;
  order: number;
  /** Per-page narration audio, resolved relative to the demo root. */
  audio?: string;
  /** Slide canvas (only for type === 'slide'). */
  content?: {
    type: 'slide';
    schemaVersion: number;
    canvas: Slide;
  };
  /** Playback verbs sequenced while this page is shown. */
  actions: Action[];
}

export interface Course {
  version: string;
  course: {
    id: string;
    title: string;
    subtitle?: string;
    /** Teacher identity shown in the bottom roundtable. */
    teacher?: {
      name: string;
      avatar?: string;
    };
  };
  scenes: CourseScene[];
}
