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

/** 一条课堂对话（带说话人角色）。角色目前为 `teacher` / `student`。 */
export interface CourseDialogueTurn {
  speaker: string;
  text: string;
}

/** A scene as authored in data.json. Only 'slide' scenes are rendered by the demo. */
export interface CourseScene {
  id: string;
  type: SceneType;
  title: string;
  order: number;
  /** Per-page narration audio, resolved relative to the demo root. */
  audio?: string;
  /** 本页在真实课堂视频中的切片区间（由 content/pages.json 注入，秒/毫秒双份）。 */
  time?: {
    start: string | null;
    end: string | null;
    startMs: number | null;
    endMs: number | null;
  };
  /**
   * 本页「下一步动画」的触发点（相对本页起点的秒数，递增）。
   * ITS 的父页面收不到动画步序回执，只能到点盲发 `playAnimationForPage`，故时间点需人工标注。
   */
  steps?: number[];
  /**
   * 鼠标光标轨迹：老师讲到某处时鼠标移到该点（此后一直停在原地，直到下一个点）。
   * 光标常驻、不消失 —— 跟真实直播里老师那只鼠标一样。
   * ITS 跑在 iframe 里、内部元素无法寻址，所以位置用相对**课件画布**（1365×768）的比例（0~1）标注。
   */
  highlights?: Array<{
    /** 鼠标移到该点的时刻，相对本页起点（秒）。 */
    at: number;
    /** 相对课件画布的横坐标比例 0~1。 */
    x: number;
    /** 相对课件画布的纵坐标比例 0~1。 */
    y: number;
  }>;
  /** Slide canvas (only for type === 'slide'). */
  content?: {
    type: 'slide';
    schemaVersion: number;
    canvas: Slide;
  };
  /** Playback verbs sequenced while this page is shown. */
  actions: Action[];
  /** 本页课堂对话（逐字稿按页切分，驱动右侧「对话」Tab）。 */
  dialogue?: CourseDialogueTurn[];
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
