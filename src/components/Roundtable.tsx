import type { ReactNode } from 'react';
import { BookOpen, Pause, Play } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Roundtable — the bottom lecture panel. Mirrors OpenMAIC's playback
 * Roundtable: a toolbar strip on top, a teacher identity column on the left,
 * and a centered interaction card that surfaces the current 讲解文本 as a
 * teacher chat bubble. Live Q&A / multi-agent discussion is out of scope for
 * this static-demo build, so the interactive mic/input overlays are omitted.
 */
export function Roundtable({
  toolbar,
  teacherName,
  teacherAvatar,
  lectureSpeech,
  idleSpeech,
  engineState,
  onTogglePlay,
}: {
  readonly toolbar?: ReactNode;
  readonly teacherName: string;
  /** 教师头像（可选）——有则用图片，无则退回内置图标。 */
  readonly teacherAvatar?: string;
  readonly lectureSpeech: string | null;
  readonly idleSpeech: string | null;
  readonly engineState: 'idle' | 'playing' | 'paused';
  readonly onTogglePlay?: () => void;
}) {
  const shown = lectureSpeech || idleSpeech;
  const isSpeaking = engineState === 'playing';

  return (
    <div className="h-[192px] w-full flex flex-col relative z-10 transition-all duration-300 border-t border-gray-100 dark:border-gray-800 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md">
      {/* Toolbar strip */}
      {toolbar && <div className="shrink-0">{toolbar}</div>}

      {/* Interaction area — three-column layout */}
      <div className="flex-1 flex items-stretch min-h-0">
        {/* Left: Teacher identity */}
        <div className="w-[90px] shrink-0 flex flex-col border-r border-gray-100/50 dark:border-gray-700/50 bg-white/40 dark:bg-gray-900/40 overflow-visible relative">
          <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-purple-50/50 dark:from-purple-900/10 to-transparent pointer-events-none" />
          <div className="flex-1 flex items-center justify-center gap-3 px-2 min-h-0 pb-1 pt-8">
            <div className="relative group flex flex-col items-center justify-center gap-1">
              <div
                className={cn(
                  'relative w-12 h-12 rounded-full transition-all duration-500 flex items-center justify-center',
                  isSpeaking ? 'scale-105' : 'opacity-90 scale-95',
                )}
              >
                <div
                  className={cn(
                    'absolute inset-0 rounded-full border-2 transition-all duration-500',
                    isSpeaking
                      ? 'border-purple-500 dark:border-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                      : 'border-gray-200 dark:border-gray-700 group-hover:border-purple-300 dark:group-hover:border-purple-600',
                  )}
                />
                <div className="w-10 h-10 rounded-full bg-white dark:bg-gray-800 overflow-hidden relative z-10 shadow-sm border border-gray-50 dark:border-gray-700 flex items-center justify-center">
                  {teacherAvatar ? (
                    <img src={teacherAvatar} alt={teacherName} className="w-full h-full object-cover" />
                  ) : (
                    <BookOpen className="w-5 h-5 text-purple-500 dark:text-purple-300" />
                  )}
                </div>
                {isSpeaking && (
                  <div className="absolute -right-0.5 top-0.5 w-4 h-4 bg-green-500 dark:bg-green-400 rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center z-20">
                    <div className="w-1 h-1 bg-white rounded-full animate-pulse" />
                  </div>
                )}
              </div>
              <span
                className={cn(
                  'max-w-[80px] truncate px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border shadow-sm transition-all duration-300 bg-white/90 dark:bg-gray-800/90',
                  isSpeaking
                    ? 'text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-700'
                    : 'text-gray-400 dark:text-gray-500 border-gray-100 dark:border-gray-700',
                )}
              >
                {teacherName}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Interaction stage — lecture speech (teacher chat bubble) */}
        <div className="flex-1 relative mx-3 mb-2">
          <div className="relative w-full h-full rounded-[2.5rem] bg-gradient-to-b from-white/40 to-white/80 dark:from-gray-800/40 dark:to-gray-800/80 backdrop-blur-xl border border-white/50 dark:border-gray-700/50 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05),inset_0_1px_0_0_rgba(255,255,255,0.9)] dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] flex flex-col justify-center px-6 overflow-hidden transition-all duration-700">
            <div className="w-full flex items-center">
              <div className="flex w-full">
                {shown ? (
                  <div
                    onClick={onTogglePlay}
                    className="relative px-4 pt-2 pb-3 rounded-2xl text-[15px] leading-relaxed transition-all border w-[min(420px,calc(100%-3rem))] bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-bl-sm shadow-sm hover:shadow-md cursor-pointer"
                  >
                    {/* Teacher avatar corner */}
                    <div className="absolute -top-2.5 -left-2.5 z-20 pointer-events-none select-none">
                      <div className="w-6 h-6 rounded-full overflow-hidden border-2 border-purple-200 dark:border-purple-700 shadow-sm flex items-center justify-center bg-purple-50 dark:bg-purple-900/30">
                        {teacherAvatar ? (
                          <img src={teacherAvatar} alt={teacherName} className="w-full h-full object-cover" />
                        ) : (
                          <BookOpen className="w-3.5 h-3.5 text-purple-500 dark:text-purple-300" />
                        )}
                      </div>
                    </div>

                    <div className="overflow-y-auto">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 truncate">
                          {teacherName}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap break-words">{shown}</p>
                    </div>

                    {/* Playback state icon */}
                    <div className="absolute right-2.5 bottom-2.5 p-1.5 rounded-full bg-gray-50/80 dark:bg-gray-700/80 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-all duration-300">
                      {isSpeaking ? (
                        <Pause className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                      ) : (
                        <Play className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 ml-0.5" />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center w-full text-gray-400 dark:text-gray-500 text-sm">
                    点击播放开始
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
