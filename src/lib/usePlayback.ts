import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action } from '@openmaic/dsl';
import type { SlideEffects } from '@openmaic/renderer';
import type { Course, WhiteboardItem } from '../types';

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

  const playheadRef = useRef(0);
  const firedRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Live mirrors so the long-lived rAF loop always reads the current scene.
  const timelineRef = useRef<TimedAction[]>([]);
  const sceneIndexRef = useRef(0);

  const activeScene = scenes[currentSceneIndex] ?? null;
  const activeActions = useMemo(
    () => (activeScene ? activeScene.actions : []),
    [activeScene],
  );
  const timeline = useMemo(() => buildTimeline(activeActions), [activeActions]);
  const total = timeline.length;
  timelineRef.current = timeline;
  sceneIndexRef.current = currentSceneIndex;

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
    playheadRef.current = 0;
    firedRef.current = new Set();
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
      const totalDuration = sceneDuration(timeline);
      const index = sceneIndexRef.current;

      let fired = 0;
      for (const item of timeline) {
        if (item.at <= playheadRef.current && !firedRef.current.has(item.index)) {
          firedRef.current.add(item.index);
          applyAction(item.action);
          fired += 1;
        }
      }
      if (fired > 0) setFiredCount(firedRef.current.size);

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
    const scene = scenes[currentSceneIndex];
    if (!scene?.audio) return;
    const audio = new Audio(scene.audio);
    audioRef.current = audio;
    audio.play().catch(() => {
      /* audio is optional — silently ignore missing/failed files */
    });
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [currentSceneIndex, scenes]);

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
    play,
    pause,
    togglePlay,
    goToScene,
    nextScene,
    prevScene,
  };
}
