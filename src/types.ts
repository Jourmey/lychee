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

/**
 * 老师批注 / 涂鸦（手写标注）的一笔。
 *
 * ITS 课件跑在 iframe 里、内部元素无法寻址，且老师的涂鸦只存在于录课视频的像素里
 * （ITS 的 `itsevent.json` 不含涂鸦数据），所以这里用**画布比例坐标**手工标注，
 * 由 `DoodleLayer` 在 iframe 之上重绘成手写感的笔画。
 *
 * 坐标一律相对**课件画布**（ITS 的 1365×768）的比例 0~1；`x/y` 是外接框左上角，
 * `w/h` 是外接框尺寸。`text` 用 `x/y` 作锚点（左上），此时 `w/h` 可省略（用 0 占位）。
 */
export type CourseDoodleKind =
  | 'ink' // 像素笔迹：从录课视频里抠出来的**真实**老师笔迹透明 PNG（`src`），位置/形状 1:1
  | 'underline' // 下划线（横穿框底）
  | 'circle' // 圈选（外接椭圆）
  | 'strike' // 划掉（框内斜向划线）
  | 'bracket' // 左侧括号（把一段话括起来）
  | 'arrow' // 箭头（由 `dir` 决定方向：下/上/右/左）
  | 'text' // 手写批注文字
  | 'freehand'; // 任意手绘折线（`points`，归一化坐标）

export interface CourseDoodle {
  kind: CourseDoodleKind;
  /** 出现时刻，相对本页起点（秒）；到点后一直留在屏上（像老师真写下的字）。 */
  at: number;
  /** 相对课件画布的横坐标比例 0~1（`text` 时是文字锚点，左对齐）。 */
  x: number;
  /** 相对课件画布的纵坐标比例 0~1（`text` 时是文字锚点，顶对齐）。 */
  y: number;
  /** 外接框宽/高比例 0~1。 */
  w?: number;
  h?: number;
  /** `text` 的批注文字。 */
  text?: string;
  /** `text` 的字号（画布 px，缺省 26）。 */
  fontSize?: number;
  /** `arrow` 的指向，缺省 `down`。 */
  dir?: 'down' | 'up' | 'right' | 'left';
  /** `freehand` 的折线点（相对课件画布的比例 0~1）。 */
  points?: Array<[number, number]>;
  /** `ink` 的笔迹图路径（相对 demo 根，如 `/courseware/doodle/data4/scene01-b01.png`）。 */
  src?: string;
  /** 笔画颜色，缺省 `#ff3b30`（红笔）。 */
  color?: string;
}

/** 老师的一笔批注是否可显示（相对本页起点的秒数）。 */
export type ActiveDoodle = CourseDoodle & { key: string };

/**
 * 一句配音 —— 文本与音频**一一对应**。
 *
 * 与 `scene.audio`（整页一段音频）互斥，是更细粒度的方案：一页 = 若干句，
 * 每句一个音频文件，播放时逐句顺序播、气泡文本跟着当前句走。
 * 时长以音频**真实时长**为准（不再依赖课堂视频的时间窗）。
 */
export interface CourseSceneLine {
  text: string;
  /** 音频路径，相对 demo 根（如 `/audio/data3/s01-l01.mp3`）。 */
  audio: string;
  /**
   * 说话人**角色 id**，缺省 `teacher`。双师模式下同一页会有 `teacher`（真实录音）
   * 与 `assistant`（AI 助教 TTS）交错；UI 侧按 id 映射到名字/头像/配色
   * （见 `src/lib/agents.ts`）。身份标记走字段而非文本前缀，方便后续扩展。
   */
  speaker?: string;
}


/** A scene as authored in data.json. Only 'slide' scenes are rendered by the demo. */
export interface CourseScene {
  id: string;
  type: SceneType;
  title: string;
  order: number;
  /**
   * 本场景对应 ITS 播放器里的**真实页码（0 基）**。
   * 场景顺序 ≠ 页码：数据集可以按老师真实的翻页顺序排列场景（跳页、回翻同一页），
   * 此时同一个 itsPage 会出现多次（同页第二次出现 = 老师回翻，配自己的时间窗/音频/讲解）。
   * iframe 翻页指令用它，而不是场景序号。缺省时退回场景序号（传统「页码 ↔ 场景一一对应」）。
   */
  itsPage?: number;
  /** Per-page narration audio, resolved relative to the demo root. */
  audio?: string;
  /**
   * 逐句配音（TTS 版数据用）。给了它就**同时**驱动时间轴与讲解气泡：
   * 时间轴 = 各句音频真实时长依次累加，气泡文本 = 当前正在播的那句。
   * `actions` / `dialogue` 仍由 build-course 按同样的句子顺序生成，UI 无需分叉。
   */
  lines?: CourseSceneLine[];
  /** 本页在真实课堂视频中的切片区间（由 <dataset>/pages.json 注入，秒/毫秒双份）。 */
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
  /**
   * 老师在本页写下的批注 / 涂鸦（手工从录课视频里标注）。到点逐笔出现、一直留在屏上，
   * 由 `DoodleLayer` 在 iframe 之上重绘。坐标同 `highlights`：相对课件画布 1365×768 的比例 0~1。
   */
  doodles?: CourseDoodle[];
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
  /**
   * ITS 官方播放器嵌入配置（来自 <dataset>/dataset.config.json 的 `its`）。
   * 课件区用 <iframe> 嵌这个播放器，demo 通过 postMessage 驱动翻页。
   */
  its?: {
    /** ITS 播放器 index.html 地址。 */
    playerUrl: string;
    /** ITS 课程 id。 */
    courseId: string;
    /** 课件总页数（用于侧栏/翻页边界）。 */
    pageCount: number;
  };
  scenes: CourseScene[];
}
