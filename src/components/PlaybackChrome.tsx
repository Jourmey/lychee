import { useCallback, useRef, useState } from 'react';
import type { Course } from '../types';
import { usePlayback } from '../lib/usePlayback';
import { SceneSidebar } from './SceneSidebar';
import { Header } from './Header';
import { SlideStage } from './SlideStage';
import { Roundtable } from './Roundtable';
import { CanvasToolbar } from './CanvasToolbar';
import { ChatPanel } from './ChatPanel';
import { BookOpen } from 'lucide-react';

export function PlaybackChrome({
  course,
  dark,
  onToggleTheme,
}: {
  readonly course: Course;
  readonly dark: boolean;
  readonly onToggleTheme: () => void;
}) {
  const playback = usePlayback(course);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const currentScene = course.scenes[playback.currentSceneIndex] ?? null;
  const slide = currentScene?.content?.type === 'slide' ? currentScene.content.canvas : null;

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
            {slide ? (
              <SlideStage
                slide={slide}
                effects={playback.effects}
                whiteboardOpen={playback.whiteboardOpen}
                whiteboardItems={playback.whiteboardItems}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                <div className="flex flex-col items-center gap-2">
                  <BookOpen className="w-8 h-8" />
                  <span>暂不支持该场景类型</span>
                </div>
              </div>
            )}
          </div>

          {/* Roundtable Area */}
          <div className="shrink-0">
            <Roundtable
              toolbar={
                <div className="px-4 pt-2">
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
              }
              teacherName={course.course.teacher?.name ?? '授课教师'}
              lectureSpeech={playback.lectureSpeech}
              idleSpeech={playback.idleSpeech}
              engineState={playback.engineState}
              onTogglePlay={playback.togglePlay}
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
        />
      </div>
    </div>
  );
}
