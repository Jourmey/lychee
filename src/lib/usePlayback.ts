import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action } from '@openmaic/dsl';
import type { SlideEffects } from '@openmaic/renderer';
import type { Course, CourseScene, WhiteboardItem } from '../types';

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
  /** 当前讲解文本 — the lecturer line currently being spoken/displayed. */
  lectureSpeech: string | null;
  /** 默认旁白 — first speech line, shown while idle. */
  idleSpeech: string | null;
  /** Active slide effects derived from fired spotlight/laser actions. */
  effects: SlideEffects;
  whiteboardOpen: boolean;
  whiteboardItems: WhiteboardItem[];
  /** 0..1 progress within the current scene. */
  sceneProgress: number;
  /** Number of actions fired in the current scene. */
  firedCount: number;
  /** Total actions in the current scene. */
  totalActions: number;
  /** 本页应已触发的「下一步动画」步数（= 已越过的 scene.steps 个数）。 */
  firedStepCount: number;
  /**
   * 鼠标光标当前应处的点（相对**课件画布** 1365×768 的比例 0~1）。
   * null = 本页没有轨迹数据；渲染层会沿用上一个位置，让光标一直停在那儿（常驻不消失）。
   */
  activeHighlight: { x: number; y: number } | null;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  goToScene: (index: number) => void;
  nextScene: () => void;
  prevScene: () => void;
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
  const [lectureSpeech, setLectureSpeech] = useState<string | null>(null);
  const [idleSpeech, setIdleSpeech] = useState<string | null>(null);
  const [effects, setEffects] = useState<SlideEffects>({});
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [whiteboardItems, setWhiteboardItems] = useState<WhiteboardItem[]>([]);
  const [sceneProgress, setSceneProgress] = useState(0);
  const [firedCount, setFiredCount] = useState(0);
  const [firedStepCount, setFiredStepCount] = useState(0);
  const [activeHighlight, setActiveHighlight] = useState<{ x: number; y: number } | null>(null);

  const playheadRef = useRef(0);
  const firedRef = useRef<Set<number>>(new Set());
  const stepCountRef = useRef(0);
  /** 当前高亮条目的 at 值（作为身份标识），用于避免每帧 setState。 */
  const highlightKeyRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 本页音频真实时长（秒），loadedmetadata 后填充；无音频为 null。 */
  const audioDurationRef = useRef<number | null>(null);
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
  const timeline = useMemo(() => buildTimeline(activeActions), [activeActions]);
  const total = timeline.length;
  timelineRef.current = timeline;
  sceneIndexRef.current = currentSceneIndex;
  scenesRef.current = scenes;
  engineStateRef.current = engineState;

  /** Reset everything for a new scene. */
  const resetForScene = useCallback((index: number) => {
    const scene = scenes[index];
    const firstSpeech = scene?.actions.find((a) => a.type === 'speech');
    setCurrentSceneIndex(index);
    sceneIndexRef.current = index;
    setLectureSpeech(firstSpeech && firstSpeech.type === 'speech' ? firstSpeech.text : null);
    setIdleSpeech(firstSpeech && firstSpeech.type === 'speech' ? firstSpeech.text : null);
    setEffects({});
    setWhiteboardOpen(false);
    setWhiteboardItems([]);
    setSceneProgress(0);
    setFiredCount(0);
    setFiredStepCount(0);
    setActiveHighlight(null);
    playheadRef.current = 0;
    firedRef.current = new Set();
    stepCountRef.current = 0;
    highlightKeyRef.current = null;
  }, [scenes]);

  /** Apply a single action's visible effects. */
  const applyAction = useCallback((action: Action) => {
    switch (action.type) {
      case 'speech':
        setLectureSpeech(action.text);
        break;
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
      const totalDuration = sceneHoldDuration(
        scenesRef.current[index] ?? null,
        timeline,
        audioDurationRef.current,
      );

      let fired = 0;
      for (const item of timeline) {
        if (item.at <= playheadRef.current && !firedRef.current.has(item.index)) {
          firedRef.current.add(item.index);
          applyAction(item.action);
          fired += 1;
        }
      }
      if (fired > 0) setFiredCount(firedRef.current.size);

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

      const progress = totalDuration > 0 ? Math.min(1, playheadRef.current / totalDuration) : 1;
      setSceneProgress(progress);

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

  /** Play the scene's per-page audio best-effort, and stop it when leaving. */
  useEffect(() => {
    audioDurationRef.current = null;
    const scene = scenes[currentSceneIndex];
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
  }, [currentSceneIndex, scenes]);

  /** 播放/暂停与当前页音频保持一致（切页时不重建元素，故单独一个 effect）。 */
  useEffect(() => {
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

  /** Stop the rAF loop and any audio on unmount. */
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
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
    lectureSpeech,
    idleSpeech,
    effects,
    whiteboardOpen,
    whiteboardItems,
    sceneProgress,
    firedCount,
    totalActions: total,
    firedStepCount,
    activeHighlight,
    play,
    pause,
    togglePlay,
    goToScene,
    nextScene,
    prevScene,
  };
}
