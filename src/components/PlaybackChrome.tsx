import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Course } from '../types';
import { usePlayback } from '../lib/usePlayback';
import { writeProgress } from '../lib/progress';
import { buildAgents } from '../lib/agents';
import { SceneSidebar } from './SceneSidebar';
import { Header } from './Header';
import { ItsStage } from './ItsStage';
import { CursorHighlight } from './CursorHighlight';
import { DoodleLayer } from './DoodleLayer';
import { CanvasToolbar } from './CanvasToolbar';
import { ChatPanel } from './ChatPanel';
import { DigitalHumanLayer } from './DigitalHumanLayer';
import type { HumanRole } from './DigitalHuman';

export function PlaybackChrome({
  course,
  courseId,
  dark,
  onToggleTheme,
  onBack,
  initialSceneIndex,
}: {
  readonly course: Course;
  /** 进度 key —— **必须是数据集目录名**（`data4`），不是 `course.course.id`（会撞车）。 */
  readonly courseId: string;
  readonly dark: boolean;
  readonly onToggleTheme: () => void;
  /** 返回首页。缺省时 Header 的返回键为死键（旧 demo 行为）。 */
  readonly onBack?: () => void;
  /** 续播起点（scene 索引）。只在挂载时读一次。 */
  readonly initialSceneIndex?: number;
}) {
  const playback = usePlayback(course, initialSceneIndex);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const currentScene = course.scenes[playback.currentSceneIndex] ?? null;

  /**
   * 进度落盘：每次翻段写一次（够用且便宜）。
   * 打开即记为「进行中」—— 符合「我学过这门课」的直觉。
   */
  useEffect(() => {
    writeProgress(courseId, {
      lastScene: playback.currentSceneIndex,
      sceneCount: course.scenes.length,
      updatedAt: Date.now(),
    });
  }, [courseId, playback.currentSceneIndex, course.scenes.length]);

  const agents = useMemo(() => buildAgents(course), [course]);
  /**
   * 此刻谁在说话 —— 驱动数字人的口型。
   * `activeLine` 是当前时间轴句序；逐句配音页里 `dialogue[i]` ↔ `lines[i]`（build-course 保证同序），
   * 取它的 `speaker` 就是角色 id。暂停 / 未开始 / 没有逐句数据时为 null（两个数字人都闭嘴）。
   */
  const activeTurn =
    playback.activeLine >= 0 ? currentScene?.dialogue?.[playback.activeLine] : undefined;
  const speakingRole: HumanRole | null =
    playback.engineState === 'playing' && activeTurn
      ? activeTurn.speaker === 'assistant'
        ? 'assistant'
        : 'teacher'
      : null;

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      const parent = el.closest('div') as HTMLDivElement | null;
      const target = parent ?? el;
      void target.requestFullscreen?.();
    }
  }, []);

  const hasWhiteboardContent = playback.whiteboardItems.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900 h-full">
      {/* Top header — spans the full width, matching OpenMAIC's playback chrome */}
      <Header
        currentSceneTitle={currentScene?.title ?? course.course.title}
        onBack={onBack}
        dark={dark}
        onToggleTheme={onToggleTheme}
      />

      <div className="flex-1 flex overflow-hidden min-h-0">
        <SceneSidebar
          collapsed={sidebarCollapsed}
          onCollapseChange={setSidebarCollapsed}
          scenes={course.scenes}
          currentSceneIndex={playback.currentSceneIndex}
          onSceneSelect={playback.goToScene}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
          {/* Canvas Area */}
          <div
            ref={stageRef}
            className="overflow-hidden relative flex-1 min-h-0 isolate"
          >
            <ItsStage
              currentSceneIndex={playback.currentSceneIndex}
              itsPage={currentScene?.itsPage}
              firedStepCount={playback.firedStepCount}
              its={course.its}
            />
            <DoodleLayer doodles={playback.activeDoodles} />
            <CursorHighlight highlight={playback.activeHighlight} />
            {/* 2D 数字人（老师 / AI 助教）：浮在课件之上，可拖动 */}
            <DigitalHumanLayer
              speakingRole={speakingRole}
              teacherName={agents.teacher.name}
              assistantName={agents.assistant.name}
            />
          </div>

          {/* Bottom bar — 画布工具条（原 Roundtable 已拆掉，讲解改由右侧逐字稿承载） */}
          <div className="shrink-0 border-t border-gray-100 dark:border-gray-800 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md px-4 py-2">
            <CanvasToolbar
              currentSceneIndex={playback.currentSceneIndex}
              scenesCount={course.scenes.length}
              engineState={playback.engineState}
              whiteboardOpen={playback.whiteboardOpen}
              hasWhiteboardContent={hasWhiteboardContent}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
              onPrevSlide={playback.prevScene}
              onNextSlide={playback.nextScene}
              onPlayPause={playback.togglePlay}
              onToggleWhiteboard={() => {}}
              onToggleFullscreen={toggleFullscreen}
              onToggleChat={() => setChatCollapsed(!chatCollapsed)}
              chatCollapsed={chatCollapsed}
              isPresenting={isPresenting}
            />
          </div>
        </div>

        {/* Right AI discussion panel */}
        <ChatPanel
          collapsed={chatCollapsed}
          onCollapseChange={setChatCollapsed}
          course={course}
          currentSceneIndex={playback.currentSceneIndex}
          onSelectScene={playback.goToScene}
          activeLine={playback.activeLine}
          onSeekLine={playback.seekToLine}
        />
      </div>
    </div>
  );
}
