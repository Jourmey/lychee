import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { BookOpen, Moon, Sun } from 'lucide-react';
import { listCourses } from '../lib/courses';
import { readAll, statusOf } from '../lib/progress';
import { CourseCard } from './CourseCard';

/**
 * 首页「我的课程」：品牌头 + 继续学习 + 全部课程。
 * 点击卡片进 `#/course/<目录名>`。
 */
export function HomePage({
  dark,
  onToggleTheme,
}: {
  readonly dark: boolean;
  readonly onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const courses = useMemo(() => listCourses(), []);
  // 首页返回时本组件会重新挂载 → 重新读一次进度即可，无需订阅。
  const progress = useMemo(() => readAll(), []);

  const continueCourses = courses.filter((c) => statusOf(progress[c.id]) !== '未开始');

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto w-full max-w-5xl px-8 py-10">
        {/* 品牌头 */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black tracking-tight text-gray-800 dark:text-gray-100">
                lychee
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">我的课程</span>
            </div>
          </div>
          <button
            onClick={onToggleTheme}
            className="p-2.5 rounded-full bg-white/60 dark:bg-gray-800/60 backdrop-blur-md ring-1 ring-black/5 dark:ring-white/10 text-gray-400 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            aria-label="主题"
            title={dark ? '切换到浅色' : '切换到深色'}
          >
            {dark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        </header>

        {continueCourses.length > 0 && (
          <section className="mb-10">
            <SectionTitle>继续学习</SectionTitle>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {continueCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  progress={progress[course.id]}
                  onClick={() => navigate(`/course/${course.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionTitle>
            全部课程
            <span className="ml-2 text-xs font-semibold text-gray-400 dark:text-gray-500 tabular-nums">
              {courses.length}
            </span>
          </SectionTitle>
          {courses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-16 flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
              <BookOpen className="w-8 h-8" />
              <p className="text-sm font-semibold">还没有课程</p>
              <p className="text-xs">
                先运行 <code className="font-mono">DATASET=data4 pnpm build-course</code> 生成数据
              </p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  progress={progress[course.id]}
                  onClick={() => navigate(`/course/${course.id}`)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { readonly children: ReactNode }) {
  return (
    <h2 className="mb-4 flex items-center text-sm font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
      {children}
    </h2>
  );
}
