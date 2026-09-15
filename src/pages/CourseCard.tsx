import { BookOpen, Play, Sparkles } from 'lucide-react';
import { SlideCanvas } from '@openmaic/renderer';
import { cn } from '../lib/cn';
import { getCourse } from '../lib/courses';
import type { CourseSummary } from '../lib/courses';
import { progressFraction, statusOf } from '../lib/progress';
import type { CourseStatus, ProgressRecord } from '../lib/progress';

const STATUS_CLASS: Record<CourseStatus, string> = {
  未开始: 'bg-gray-100 text-gray-500 dark:bg-gray-700/60 dark:text-gray-400',
  进行中: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  已完成: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

/**
 * 首页单张课程卡：封面直接用第一个 `scene.content.canvas` 渲染 `<SlideCanvas>` 缩略图
 * （与 `SceneSidebar` 同款写法，不需要额外的封面资源）。
 */
export function CourseCard({
  course,
  progress,
  onClick,
}: {
  readonly course: CourseSummary;
  readonly progress?: ProgressRecord;
  readonly onClick: () => void;
}) {
  const detail = getCourse(course.id);
  const first = detail?.scenes[0];
  const slide = first?.content?.type === 'slide' ? first.content.canvas : undefined;

  const status = statusOf(progress);
  const fraction = progressFraction(progress);
  const percent = Math.round(fraction * 100);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col text-left rounded-2xl overflow-hidden',
        'bg-white dark:bg-gray-800/70 ring-1 ring-black/5 dark:ring-white/10',
        'shadow-sm hover:shadow-xl hover:ring-purple-300/60 dark:hover:ring-purple-500/50',
        'hover:-translate-y-0.5 transition-all duration-200 cursor-pointer',
      )}
    >
      {/* 封面 */}
      <div className="relative aspect-video w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
        {slide ? (
          <SlideCanvas
            slide={slide}
            chrome={false}
            canvasPercentage={100}
            className="w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-300 dark:text-gray-600">
            <BookOpen className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-wider">{first?.type ?? 'slide'}</span>
          </div>
        )}

        {/* hover 播放浮层 */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors duration-200">
          <span className="w-11 h-11 rounded-full bg-white/90 text-purple-600 flex items-center justify-center shadow-lg opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200">
            <Play className="w-5 h-5 translate-x-px" fill="currentColor" />
          </span>
        </div>

        {course.recommended && (
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-2.5 py-1 text-[10px] font-bold text-white shadow-lg shadow-purple-900/20">
            <Sparkles className="w-3 h-3" />
            推荐
          </span>
        )}
      </div>

      {/* 信息 */}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">
            {course.title}
          </h3>
          {course.subtitle && (
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{course.subtitle}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {course.teacherAvatar ? (
              <img
                src={course.teacherAvatar}
                alt={course.teacherName}
                className="w-5 h-5 rounded-full object-cover bg-white ring-1 ring-black/5 dark:ring-white/10"
              />
            ) : (
              <span className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-[9px] font-bold text-purple-600 dark:text-purple-300">
                {course.teacherName.slice(0, 1)}
              </span>
            )}
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {course.teacherName}
            </span>
          </div>
          <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
            共 {course.lessonCount} 段
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold',
                STATUS_CLASS[status],
              )}
            >
              {status}
            </span>
            {percent > 0 && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                {percent}%
              </span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
