import type { Course } from '../types';

/** Agent identity + accent color (mirrors OpenMAIC's role colors). */
export interface Agent {
  id: string;
  name: string;
  role?: string;
  color: string; // ring / text accent
  avatarBg: string; // gradient bg
  avatar?: string; // 默认头像图（public/avatars/）；无则退回姓名首字
  isTeacher?: boolean;
}

/**
 * 课堂里的三种角色：主讲老师、AI 助教、学生。
 *
 * 数据侧（`scene.lines[].speaker` / `scene.dialogue[].speaker`）存的是**角色 id**
 * （`teacher` / `assistant` / `student`），到这里才映射成名字、头像与配色。
 * 双师模式：主讲老师走真实课堂录音，AI 助教走 TTS —— 两者同页交错，靠这个 id 区分。
 */
export function buildAgents(course: Course): Record<string, Agent> {
  return {
    teacher: {
      id: 'teacher',
      name: course.course.teacher?.name ?? '授课教师',
      role: '老师',
      color: '#8b5cf6',
      avatarBg: 'from-purple-500 to-indigo-600',
      avatar: course.course.teacher?.avatar ?? '/avatars/teacher.svg',
      isTeacher: true,
    },
    assistant: {
      id: 'assistant',
      name: 'AI 助教',
      role: '助教',
      color: '#10b981',
      avatarBg: 'from-emerald-500 to-teal-600',
    },
    student: {
      id: 'student',
      name: '同学',
      role: '学生',
      color: '#60a5fa',
      avatarBg: 'from-blue-500 to-sky-600',
      avatar: '/avatars/student1.svg',
    },
  };
}
