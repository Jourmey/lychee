import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action } from '@openmaic/dsl';
import type { SlideEffects } from '@openmaic/renderer';
import type { ActiveDoodle, Course, CourseScene, WhiteboardItem } from '../types';

export type EngineState = 'idle' | 'playing' | 'paused';

/** An action scheduled against the scene clock. */
interface TimedAction {
  action: Action;
  /** Seconds from scene start when the action fires. */
  at: number;
  index: number;
}

/** Reaching an `at` that is no longer relevant (previously fired). */

/** Rough per-action duration used to build a timeline when `at` is absent. */
function estimateActionDuration(action: Action): number {
  switch (action.type) {
    case 'speech':
      // ~5 Chinese chars/sec, clamped to a readable window.
      return Math.max(2, Math.min(10, action.text.length / 5));
    case 'spotlight':
    case 'laser':
      return 1.2;
    case 'play_video':
      return 5;
    case 'wb_open':
      return 0.6;
    case 'wb_draw_text':
    case 'wb_draw_line':
    case 'wb_draw_shape':
    case 'wb_draw_chart':
    case 'wb_draw_latex':
    case 'wb_draw_table':
    case 'wb_draw_code':
      return 0.9;
    case 'wb_close':
      return 0.5;
    case 'wb_clear':
    case 'wb_delete':
      return 0.4;
    case 'discussion':
      return 3;
    default:
      return 1;
  }
}

function hasAt(action: Action): action is Action & { at: number } {
  return 'at' in action && typeof (action as { at?: unknown }).at === 'number';
}

/** Build a cumulative timeline; honor explicit `at`, else stack estimates. */
function buildTimeline(actions: Action[]): TimedAction[] {
  let cursor = 0;
  return actions.map((action, index) => {
    const at = hasAt(action) ? action.at : cursor;
    cursor = at + estimateActionDuration(action);
    return { action, at, index };
  });
}

/** Total scene length in seconds. */
function sceneDuration(timeline: TimedAction[]): number {
  if (timeline.length === 0) return 0;
  const last = timeline[timeline.length - 1];
  return last.at + estimateActionDuration(last.action);
}

/**
 * 该页应停留的秒数 —— 取三者最大：
 *   1. 动作时间轴的估算时长；
 *   2. `scene.time` 给出的真实切片区间（来自 content/pages.json）；
 *   3. 本页音频的真实时长（loadedmetadata 后才知道）。
 * 保证音频没播完不会被自动翻页。
 */
function sceneHoldDuration(
  scene: CourseScene | null,
  timeline: TimedAction[],
  audioDuration: number | null,
): number {
  let seconds = sceneDuration(timeline);
  const t = scene?.time;
  if (t?.startMs != null && t?.endMs != null && t.endMs > t.startMs) {
    seconds = Math.max(seconds, (t.endMs - t.startMs) / 1000);
  }
  if (audioDuration != null && Number.isFinite(audioDuration)) {
    seconds = Math.max(seconds, audioDuration);
  }
  return seconds;
}

export interface PlaybackControls {
  engineState: EngineState;
  currentSceneIndex: number;
  /**
   * 右侧逐字稿当前高亮行（`scene.dialogue` 索引）；-1 = 本页无逐句数据 / 尚未开始。
   * 逐句配音（scene.lines）与 text 覆盖模式下 `dialogue[i]` ↔ `timeline[i]`，索引可直接复用。
   */
  activeLine: number;
  /** Active slide effects derived from fired spotlight/laser actions. */
  effects: SlideEffects;
  whiteboardOpen: boolean;
  whiteboardItems: WhiteboardItem[];
  /** 本页应已触发的「下一步动画」步数（= 已越过的 scene.steps 个数）。 */
  firedStepCount: number;
  /**
   * 鼠标光标当前应处的点（相对**课件画布** 1365×768 的比例 0~1）。
   * null = 本页没有轨迹数据；渲染层会沿用上一个位置，让光标一直停在那儿（常驻不消失）。
   */
  activeHighlight: { x: number; y: number } | null;
  /**
   * 当前应显示的老师批注 / 涂鸦（`at <= 播放头` 的全部，逐笔累积、不消失）。
   * 本页无数据时为空数组。
   */
  activeDoodles: ActiveDoodle[];
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  goToScene: (index: number) => void;
  nextScene: () => void;
  prevScene: () => void;
  /** 跳到本页第 index 句并继续播放 —— 供右侧逐字稿点击联动。 */
  seekToLine: (index: number) => void;
}

/** Map a `wb_draw_*` action to a whiteboard item for the layer. */
function itemFromAction(action: Action): WhiteboardItem | null {
  switch (action.type) {
    case 'wb_draw_text':
      return {
        id: action.id,
        kind: 'text',
        x: action.x,
        y: action.y,
        width: action.width ?? 300,
        height: action.height ?? 100,
        content: action.content,
        fontSize: action.fontSize ?? 44,
        color: action.color ?? '#1f2430',
      };
    case 'wb_draw_line':
      return {
        id: action.id,
        kind: 'line',
        x: Math.min(action.startX, action.endX),
        y: Math.min(action.startY, action.endY),
        width: 0,
        height: 0,
        startX: action.startX,
        startY: action.startY,
        endX: action.endX,
        endY: action.endY,
        color: action.color ?? '#e74c3c',
      };
    case 'wb_draw_shape':
      return {
        id: action.id,
        kind: 'shape',
        x: action.x,
        y: action.y,
        width: action.width,
        height: action.height,
        shape: action.shape,
        fillColor: action.fillColor ?? '#4caf50',
      };
    default:
      return null;
  }
}

export function usePlayback(course: Course): PlaybackControls {
  const scenes = course.scenes;
  const sceneCount = scenes.length;

  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  /** 右侧逐字稿当前高亮行（timeline / dialogue 索引）；-1 = 未开始 / 本页无逐句数据。 */
  const [activeLine, setActiveLine] = useState(-1);
  const [effects, setEffects] = useState<SlideEffects>({});
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [whiteboardItems, setWhiteboardItems] = useState<WhiteboardItem[]>([]);
  const [firedStepCount, setFiredStepCount] = useState(0);
  const [activeHighlight, setActiveHighlight] = useState<{ x: number; y: number } | null>(null);
  /** 当前应显示的老师批注（逐笔累积）。 */
  const [activeDoodles, setActiveDoodles] = useState<ActiveDoodle[]>([]);
  /** 逐句配音（scene.lines）每句的真实时长（秒）。全部 metadata 到手后填充。 */
  const [lineDurations, setLineDurations] = useState<number[] | null>(null);
  /**
   * 场景复位计数。resetForScene 每次调用都 +1，用来让「本页音频」effect 重新跑一遍。
   * 只靠 currentSceneIndex 不够：goToScene(当前页) 时 index 不变、effect 不会重跑，
   * 且 StrictMode 下 resetForScene(0) 会在 effect 建好 <audio> 之后把 ref 清空。
   */
  const [sceneSession, setSceneSession] = useState(0);

  const playheadRef = useRef(0);
  const firedRef = useRef<Set<number>>(new Set());
  const stepCountRef = useRef(0);
  /** 当前高亮条目的 at 值（作为身份标识），用于避免每帧 setState。 */
  const highlightKeyRef = useRef<number | null>(null);
  /** 当前已显示的批注条数（作为身份标识），仅变化时才 setState。 */
  const doodleCountRef = useRef(0);
  /** activeLine 的 ref 镜像，仅变化时才 setState。 */
  const activeLineRef = useRef(-1);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 本页音频真实时长（秒），loadedmetadata 后填充；无音频为 null。 */
  const audioDurationRef = useRef<number | null>(null);
  /** 逐句配音的 <audio> 元素（与 scene.lines 同序）。 */
  const lineAudiosRef = useRef<HTMLAudioElement[]>([]);
  /** lineDurations 的 ref 镜像，供长生命周期的 rAF 回调读取。 */
  const lineDurationsRef = useRef<number[] | null>(null);
  /** 当前正在播第几句（-1 = 尚未确定）。 */
  const currentLineRef = useRef(-1);
  // Live mirrors so the long-lived rAF loop always reads the current scene.
  const timelineRef = useRef<TimedAction[]>([]);
  const sceneIndexRef = useRef(0);
  const scenesRef = useRef(scenes);
  /** 供长生命周期的回调/effect 读取当前播放状态，避免重建 audio 元素。 */
  const engineStateRef = useRef<EngineState>('idle');

  const activeScene = scenes[currentSceneIndex] ?? null;
  const activeActions = useMemo(
    () => (activeScene ? activeScene.actions : []),
    [activeScene],
  );
  const activeLines = activeScene?.lines ?? null;
  /**
   * 本页时间轴。
   * - 逐句配音（scene.lines）：每句一个 speech 动作，`at` = 前面各句**真实时长**的累加。
   *   时长未到手时先用字数估算占位，metadata 到达后 timeline 重建。
   * - 传统：按 actions 的 `at` / 估算铺开。
   */
  const timeline = useMemo(() => {
    if (activeLines && activeLines.length > 0) {
      let acc = 0;
      return activeLines.map((line, i) => {
        const at = acc;
        const dur = lineDurations?.[i];
        acc += dur != null && dur > 0 ? dur : Math.max(1, Math.min(12, line.text.length / 5));
        return { action: { type: 'speech', id: `line-${i}`, text: line.text } as Action, at, index: i };
      });
    }
    return buildTimeline(activeActions);
  }, [activeLines, lineDurations, activeActions]);
  lineDurationsRef.current = lineDurations;
  timelineRef.current = timeline;
  sceneIndexRef.current = currentSceneIndex;
  scenesRef.current = scenes;
  engineStateRef.current = engineState;

  /** Reset everything for a new scene. */
  const resetForScene = useCallback((index: number) => {
    const scene = scenes[index];
    setCurrentSceneIndex(index);
    sceneIndexRef.current = index;
    setEffects({});
    setWhiteboardOpen(false);
    setWhiteboardItems([]);
    setFiredStepCount(0);
    setActiveHighlight(null);
    setActiveDoodles([]);
    setActiveLine(-1);
    activeLineRef.current = -1;
    doodleCountRef.current = 0;
    // 本页音频（lineDurations / lineAudios / currentLine）由「本页音频」effect 独占管理，
    // 这里只推进 sceneSession 让它重跑 —— 否则会和 effect 抢所有权（StrictMode 下必然踩）。
    setSceneSession((n) => n + 1);
    playheadRef.current = 0;
    firedRef.current = new Set();
    stepCountRef.current = 0;
    highlightKeyRef.current = null;
  }, [scenes]);

  /** Apply a single action's visible effects. */
  const applyAction = useCallback((action: Action) => {
    switch (action.type) {
      case 'spotlight':
        setEffects((prev) => ({
          ...prev,
          spotlight: {
            elementId: action.elementId,
            dimness: action.dimOpacity,
          },
        }));
        break;
      case 'laser':
        setEffects((prev) => ({
          ...prev,
          laser: {
            elementId: action.elementId,
            color: action.color,
            duration: 2,
          },
        }));
        break;
      case 'wb_open':
        setWhiteboardOpen(true);
        break;
      case 'wb_close':
        setWhiteboardOpen(false);
        break;
      case 'wb_draw_text':
      case 'wb_draw_line':
      case 'wb_draw_shape': {
        const item = itemFromAction(action);
        if (item) setWhiteboardItems((prev) => [...prev, item]);
        break;
      }
      default:
        break;
    }
  }, []);

  /** Step the playhead and fire any actions whose time has come. */
  const step = useCallback(
    (now: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = now;
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      playheadRef.current += dt;

      // Read live scene data so navigation/auto-advance never uses a stale closure.
      const timeline = timelineRef.current;
      const total = timeline.length;
      const index = sceneIndexRef.current;
      const scene = scenesRef.current[index] ?? null;
      /** 逐句配音场景：每句时长取真实音频时长，未到手时先按字数估算。 */
      const lines = scene?.lines;
      const lineDurs = lineDurationsRef.current;
      const lineDur = (i: number) => {
        const d = lineDurs?.[i];
        if (d != null && d > 0) return d;
        return Math.max(1, Math.min(12, (lines?.[i]?.text.length ?? 0) / 5));
      };
      const totalDuration =
        lines && lines.length > 0
          ? lines.reduce((sum, _line, i) => sum + lineDur(i), 0)
          : sceneHoldDuration(scene, timeline, audioDurationRef.current);

      for (const item of timeline) {
        if (item.at <= playheadRef.current && !firedRef.current.has(item.index)) {
          firedRef.current.add(item.index);
          applyAction(item.action);
        }
      }

      // 右侧逐字稿高亮：取「已越过」的最后一个 timeline 项作为当前句。
      // 逐句配音 / text 覆盖模式下 dialogue[i] ↔ timeline[i]，索引可直接复用。
      let lineIdx = -1;
      for (const item of timeline) {
        if (item.at <= playheadRef.current) lineIdx = item.index;
        else break;
      }
      if (lineIdx !== activeLineRef.current) {
        activeLineRef.current = lineIdx;
        setActiveLine(lineIdx);
      }

      // 逐句配音（TTS）：playhead 落在哪一句，就保证那一句的 <audio> 在播（其余暂停）。
      if (lines && lines.length > 0) {
        const t = playheadRef.current;
        let cur = 0;
        let curStart = 0;
        let acc = 0;
        for (let i = 0; i < lines.length; i++) {
          if (t >= acc) {
            cur = i;
            curStart = acc;
          } else break;
          acc += lineDur(i);
        }
        if (cur !== currentLineRef.current) {
          const prev = lineAudiosRef.current[currentLineRef.current];
          if (prev) prev.pause();
          const next = lineAudiosRef.current[cur];
          if (next) {
            const offset = t - curStart;
            if (offset > 0.3) {
              try {
                next.currentTime = offset;
              } catch {
                /* metadata 未就绪时忽略 seek */
              }
            }
            if (engineStateRef.current === 'playing') next.play().catch(() => {});
          }
          currentLineRef.current = cur;
        }
      }

      // 「下一步动画」：本页已越过的 steps 时间点个数（ITS 只支持盲发，故由时钟驱动）。
      const steps = scenesRef.current[index]?.steps;
      let stepCount = 0;
      if (steps) while (stepCount < steps.length && steps[stepCount] <= playheadRef.current) stepCount++;
      if (stepCount !== stepCountRef.current) {
        stepCountRef.current = stepCount;
        setFiredStepCount(stepCount);
      }

      // 鼠标光标：取「已越过」的最后一个轨迹点 —— 光标常驻，到点移过去后停在原地。
      // 进入本页时尚未到第一个 at 也直接落在第一个点上（避免光标凭空出现）。
      const highlights = scenesRef.current[index]?.highlights;
      let activeHl: { x: number; y: number } | null = null;
      let hlKey: number | null = null;
      if (highlights && highlights.length > 0) {
        const t = playheadRef.current;
        let cur = highlights[0];
        for (const h of highlights) if (t >= h.at) cur = h;
        activeHl = { x: cur.x, y: cur.y };
        hlKey = cur.at;
      }
      if (hlKey !== highlightKeyRef.current) {
        highlightKeyRef.current = hlKey;
        setActiveHighlight(activeHl);
      }

      // 老师批注：取「已到点」的全部（逐笔累积、不消失）。只用条数做身份，避免每帧 setState。
      const doodles = scenesRef.current[index]?.doodles;
      let doodleCount = 0;
      if (doodles) while (doodleCount < doodles.length && doodles[doodleCount].at <= playheadRef.current) doodleCount++;
      if (doodleCount !== doodleCountRef.current) {
        doodleCountRef.current = doodleCount;
        setActiveDoodles(
          doodles ? doodles.slice(0, doodleCount).map((d, i) => ({ ...d, key: `${index}-${i}` })) : [],
        );
      }

      const allFired = firedRef.current.size >= total;
      if (allFired && playheadRef.current >= totalDuration + 0.6) {
        // Auto-advance to the next scene when the deck isn't over.
        if (index < sceneCount - 1) {
          resetForScene(index + 1);
        } else {
          setEngineState('idle');
          return;
        }
      }
      rafRef.current = requestAnimationFrame(step);
    },
    [applyAction, resetForScene, sceneCount],
  );

  const play = useCallback(() => {
    setEngineState('playing');
  }, []);

  const pause = useCallback(() => {
    setEngineState('paused');
  }, []);

  const togglePlay = useCallback(() => {
    if (engineState === 'playing') pause();
    else play();
  }, [engineState, pause, play]);

  const goToScene = useCallback(
    (index: number) => {
      if (index < 0 || index >= sceneCount) return;
      resetForScene(index);
      setEngineState('playing');
    },
    [resetForScene, sceneCount],
  );

  const nextScene = useCallback(() => {
    if (currentSceneIndex < sceneCount - 1) goToScene(currentSceneIndex + 1);
  }, [currentSceneIndex, goToScene, sceneCount]);

  const prevScene = useCallback(() => {
    if (currentSceneIndex > 0) goToScene(currentSceneIndex - 1);
  }, [currentSceneIndex, goToScene]);

  /**
   * 跳到本页第 index 句并继续播放（右侧逐字稿点击联动）。
   * 直接推进播放头（seek）而非重放全页：把已触发集合重置成「at <= 目标」的部分并重放其可见效果，
   * 再把目标句音频定位到句首，交给「播放/暂停」effect 接管。之后 rAF 时钟接管，
   * 进度 / 光标 / 涂鸦 / 下一步步数会在下一帧按新播放头重算。
   */
  const seekToLine = useCallback(
    (index: number) => {
      const timeline = timelineRef.current;
      if (index < 0 || index >= timeline.length) return;
      const target = timeline[index].at;
      playheadRef.current = target;

      firedRef.current = new Set();
      for (const item of timeline) {
        if (item.at > target) break;
        firedRef.current.add(item.index);
        applyAction(item.action);
      }

      const audios = lineAudiosRef.current;
      if (audios.length > 0) {
        audios.forEach((a, i) => {
          if (i !== index) a.pause();
        });
        const line = audios[index];
        if (line) {
          try {
            line.currentTime = 0;
          } catch {
            /* metadata 未就绪时忽略 seek */
          }
          // 必须在这里直接播：currentLineRef 已置为 index，step() 的分句分支会认为「没换句」而跳过；
          // 而「播放/暂停」effect 只在 engineState 真正变化时跑 —— 本来就在播时 setEngineState('playing')
          // 是空操作，不会帮你起播。点击本身是用户手势，play() 不会被拦。
          line.play().catch(() => {});
        }
        currentLineRef.current = index;
      } else if (audioRef.current) {
        // 整页音频：按估算时间轴近似跳转。
        try {
          audioRef.current.currentTime = target;
        } catch {
          /* ignore */
        }
      }

      activeLineRef.current = index;
      setActiveLine(index);
      setEngineState('playing');
    },
    [applyAction],
  );

  /**
   * 本页音频，两种形态：
   *  - 逐句配音（scene.lines）：每句一个 <audio>，按时间轴依次播（切句在 step 里做）。
   *  - 传统：整页一段音频（scene.audio）。
   * 离开本页时全部暂停。
   */
  useEffect(() => {
    audioDurationRef.current = null;
    const scene = scenes[currentSceneIndex];

    const lines = scene?.lines;

    if (lines && lines.length > 0) {
      const audios = lines.map((l) => new Audio(l.audio));
      lineAudiosRef.current = audios;
      currentLineRef.current = 0;
      let cancelled = false;
      const durations = new Array(lines.length).fill(0);
      let loaded = 0;
      // 全部 metadata 到手后一次性填 lineDurations —— 时间轴按真实时长重铺。
      const handlers = audios.map((a, i) => {
        const onMeta = () => {
          if (cancelled) return;
          if (Number.isFinite(a.duration)) durations[i] = a.duration;
          loaded += 1;
          if (loaded === lines.length) setLineDurations(durations.slice());
        };
        a.addEventListener('loadedmetadata', onMeta);
        return onMeta;
      });
      if (engineStateRef.current === 'playing') audios[0].play().catch(() => {});
      return () => {
        cancelled = true;
        audios.forEach((a, i) => {
          a.removeEventListener('loadedmetadata', handlers[i]);
          a.pause();
        });
        lineAudiosRef.current = [];
        currentLineRef.current = -1;
        setLineDurations(null);
      };
    }

    lineAudiosRef.current = [];
    currentLineRef.current = -1;
    setLineDurations(null);
    if (!scene?.audio) return;
    const audio = new Audio(scene.audio);
    audioRef.current = audio;
    const onMeta = () => {
      // 真实时长到手后作为该页停留时长的下限，避免音频没播完就翻页。
      if (Number.isFinite(audio.duration)) audioDurationRef.current = audio.duration;
    };
    audio.addEventListener('loadedmetadata', onMeta);
    if (engineStateRef.current === 'playing') {
      audio.play().catch(() => {
        /* audio is optional — silently ignore missing/failed files */
      });
    }
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.pause();
      audioRef.current = null;
      audioDurationRef.current = null;
    };
  }, [sceneSession, currentSceneIndex, scenes]);

  /** 播放/暂停与当前页音频保持一致（切页时不重建元素，故单独一个 effect）。 */
  useEffect(() => {
    const lineAudios = lineAudiosRef.current;
    if (lineAudios.length > 0) {
      if (engineState === 'playing') {
        const cur = lineAudios[currentLineRef.current] ?? lineAudios[0];
        cur?.play().catch(() => {
          /* autoplay may be blocked; ignore */
        });
      } else {
        lineAudios.forEach((a) => a.pause());
      }
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (engineState === 'playing') {
      audio.play().catch(() => {
        /* autoplay may be blocked; ignore */
      });
    } else {
      audio.pause();
    }
  }, [engineState, currentSceneIndex]);

  /**
   * 自动播放策略：没有用户手势时 `play()` 会被浏览器以 `NotAllowedError` 拒绝，
   * 页面上线即自动播的 demo 必然踩到。用户第一次点/按键时把当前句补播上。
   * （必须挂在 document 的捕获阶段：手势回调里同步调 play 才被认作「用户触发」。）
   */
  useEffect(() => {
    const resume = () => {
      if (engineStateRef.current !== 'playing') return;
      const line = lineAudiosRef.current[currentLineRef.current] ?? lineAudiosRef.current[0];
      if (line) {
        if (line.paused) line.play().catch(() => {});
        return;
      }
      const audio = audioRef.current;
      if (audio?.paused) audio.play().catch(() => {});
    };
    const opts = { capture: true } as const;
    document.addEventListener('pointerdown', resume, opts);
    document.addEventListener('keydown', resume, opts);
    return () => {
      document.removeEventListener('pointerdown', resume, opts);
      document.removeEventListener('keydown', resume, opts);
    };
  }, []);

  /** Stop the rAF loop and any audio on unmount. */
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
      lineAudiosRef.current.forEach((a) => a.pause());
    };
  }, []);

  // Initialize on the first scene, then auto-play the demo.
  useEffect(() => {
    resetForScene(0);
    const t = setTimeout(() => setEngineState((s) => (s === 'idle' ? 'playing' : s)), 600);
    return () => {
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once autoplay flips to 'playing', start the rAF clock.
  useEffect(() => {
    if (engineState === 'playing' && rafRef.current === null) {
      lastFrameRef.current = null;
      rafRef.current = requestAnimationFrame(step);
    }
    if (engineState !== 'playing' && rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [engineState, step]);

  return {
    engineState,
    currentSceneIndex,
    activeLine,
    effects,
    whiteboardOpen,
    whiteboardItems,
    firedStepCount,
    activeHighlight,
    activeDoodles,
    play,
    pause,
    togglePlay,
    goToScene,
    nextScene,
    prevScene,
    seekToLine,
  };
}
