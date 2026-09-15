import { useNavigate, useParams } from 'react-router';
import { BookOpen, ArrowLeft } from 'lucide-react';
import { getCourse } from '../lib/courses';
import { getProgress } from '../lib/progress';
import { PlaybackChrome } from '../components/PlaybackChrome';

/**
 * 播放页。`id` = 数据集目录名（路由主键）。
 *
 * 将来要插「课程详情页」，在这一层里加即可，URL 不用动 —— `#/course/data4`
 * 仍然先落到这里，内部再决定展示详情还是直接播。
 */
export function PlaybackPage({
  dark,
  onToggleTheme,
}: {
  readonly dark: boolean;
  readonly onToggleTheme: () => void;
}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const course = id ? getCourse(id) : undefined;

  // 续播起点：读已存进度并钳制到本课程合法范围。
  // 刻意不用 useState：直接课程跳课程（同路由不同 param）时组件不会重挂载，
  // 每次 render 重算才能保证 `key={id}` 重挂载时拿到的是新课程的起点。
  const savedLast = id ? (getProgress(id)?.lastScene ?? 0) : 0;
  const startScene = course
    ? Math.max(0, Math.min(savedLast, course.scenes.length - 1))
    : 0;

  if (!id || !course) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-900 text-center px-6">
        <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <BookOpen className="w-6 h-6 text-gray-400 dark:text-gray-500" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">未找到课程</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{id ?? '(空 id)'}</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 rounded-full bg-purple-600 hover:bg-purple-700 px-4 py-2 text-xs font-bold text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回首页
        </button>
      </div>
    );
  }

  return (
    <PlaybackChrome
      /* 切换课程整棵重挂载：让 usePlayback 的初始化 effect 重新跑，带上新的续播起点。 */
      key={id}
      courseId={id}
      course={course}
      initialSceneIndex={startScene}
      onBack={() => navigate('/')}
      dark={dark}
      onToggleTheme={onToggleTheme}
    />
  );
}
