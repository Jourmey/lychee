import { useMemo, useState } from 'react';
import type { Action } from '@openmaic/dsl';
import {
  BookOpen,
  Flashlight,
  MessageSquare,
  MousePointer2,
  PanelRightClose,
  Send,
  Sparkles,
} from 'lucide-react';
import { cn } from '../lib/cn';
import type { Course } from '../types';

/**
 * ChatPanel — replicates OpenMAIC's right-side drawer. In the real product the
 * multi-agent classroom discussion streams in live; here it's a static set of
 * example turns so the shell reads as a faithful 1:1 replica. The drawer has
 * two tabs (「笔记」/「对话」) and defaults to dark with the panel expanded.
 */

/** Agent identity + accent color (mirrors OpenMAIC's role colors). */
interface Agent {
  id: string;
  name: string;
  role?: string;
  color: string; // ring / text accent
  avatarBg: string; // gradient bg
  avatar?: string; // 默认头像图（public/avatars/）；无则退回姓名首字
  isTeacher?: boolean;
}

/**
 * 教室里的两种角色：主讲老师（名字/头像取自课程元信息）+ 学生。
 * 逐字稿里的 SpeakerId 已在 scripts/build-course.mjs 归一到 teacher / student，
 * 因此这里只需按角色取到身份与配色。
 */
function buildAgents(course: Course): Record<string, Agent> {
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

/** Inline action chips shown in the lecture notes (mirrors OpenMAIC). */
const ACTION_ICON_ONLY: Record<string, { Icon: typeof Flashlight; style: string }> = {
  spotlight: {
    Icon: Flashlight,
    style:
      'bg-yellow-50 dark:bg-yellow-500/15 border-yellow-300/40 dark:border-yellow-500/30 text-yellow-700 dark:text-yellow-300',
  },
  laser: {
    Icon: MousePointer2,
    style:
      'bg-red-50 dark:bg-red-500/15 border-red-300/40 dark:border-red-500/30 text-red-600 dark:text-red-300',
  },
};

function AgentAvatar({ agent }: { readonly agent: Agent }) {
  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          'flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br text-[11px] font-bold text-white',
          agent.avatarBg,
        )}
      >
        {agent.avatar ? (
          <img src={agent.avatar} alt={agent.name} className="h-full w-full object-cover" />
        ) : (
          agent.name.slice(0, 1)
        )}
      </div>
      {agent.isTeacher && (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-gray-900 bg-green-500" />
      )}
    </div>
  );
}

/** Build per-scene note rows, grouping inline actions (spotlight/laser) with speech. */
function buildRows(actions: Action[]) {
  type Row =
    | { kind: 'speech'; text: string; inlineActions: string[] }
    | { kind: 'discussion'; label: string }
    | { kind: 'trailing'; inlineActions: string[] };

  const rows: Row[] = [];
  let pending: string[] = [];
  for (const action of actions) {
    if (action.type === 'discussion') {
      if (pending.length > 0) {
        rows.push({ kind: 'trailing', inlineActions: pending });
        pending = [];
      }
      rows.push({ kind: 'discussion', label: '课堂讨论' });
    } else if (action.type === 'spotlight' || action.type === 'laser') {
      pending.push(action.type);
    } else if (action.type === 'speech') {
      rows.push({ kind: 'speech', text: action.text, inlineActions: pending });
      pending = [];
    }
  }
  if (pending.length > 0) rows.push({ kind: 'trailing', inlineActions: pending });
  return rows;
}

function LectureNotes({
  course,
  currentSceneIndex,
  onSelectScene,
}: {
  readonly course: Course;
  readonly currentSceneIndex: number;
  readonly onSelectScene: (index: number) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 scrollbar-hide">
      {course.scenes.map((scene, index) => {
        const isCurrent = index === currentSceneIndex;
        const rows = buildRows(scene.actions);
        return (
          <button
            key={scene.id}
            type="button"
            onClick={() => onSelectScene(index)}
            className={cn(
              'block w-full text-left mb-3 last:mb-0 rounded-lg px-3 py-2.5 transition-colors duration-200',
              isCurrent
                ? 'bg-purple-50/80 dark:bg-purple-950/25 ring-1 ring-purple-200/60 dark:ring-purple-700/30'
                : 'bg-gray-50/50 dark:bg-gray-800/30 hover:bg-purple-50/40 dark:hover:bg-purple-950/15',
            )}
          >
            {/* Page label row */}
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  isCurrent
                    ? 'bg-purple-500 dark:bg-purple-400 shadow-sm shadow-purple-400/40'
                    : 'bg-gray-300 dark:bg-gray-600',
                )}
              />
              <span
                className={cn(
                  'text-[10px] font-semibold tracking-wide',
                  isCurrent
                    ? 'text-purple-600 dark:text-purple-400'
                    : 'text-gray-400 dark:text-gray-500',
                )}
              >
                第 {index + 1} 页
              </span>
              {isCurrent && (
                <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300">
                  当前页
                </span>
              )}
            </div>

            {/* Scene title */}
            <h4 className="text-[13px] font-bold text-gray-800 dark:text-gray-100 mb-1.5 leading-snug pl-4">
              {scene.title}
            </h4>

            {/* Ordered items */}
            <div className="pl-4 space-y-1">
              {rows.map((row, i) => {
                if (row.kind === 'discussion') {
                  return (
                    <div
                      key={i}
                      className="my-1.5 flex items-start gap-1.5 rounded-md border border-amber-200/60 dark:border-amber-700/30 bg-amber-50/60 dark:bg-amber-900/10 px-2 py-1.5"
                    >
                      <MessageSquare className="w-3 h-3 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                      <span className="text-[11px] leading-snug text-amber-800 dark:text-amber-300">
                        {row.label}
                      </span>
                    </div>
                  );
                }
                const isSpeech = row.kind === 'speech';
                const content = (
                  <>
                    {row.inlineActions.map((a, j) => {
                      const cfg = ACTION_ICON_ONLY[a];
                      if (!cfg) return null;
                      const { Icon, style } = cfg;
                      return (
                        <span
                          key={j}
                          className={cn(
                            'inline-flex items-center justify-center w-4 h-4 rounded-full border align-middle mr-0.5',
                            style,
                          )}
                        >
                          <Icon className="w-2.5 h-2.5" />
                        </span>
                      );
                    })}
                    {isSpeech ? row.text : null}
                  </>
                );
                return (
                  <p
                    key={i}
                    className="text-[12px] leading-[1.8] text-gray-700 dark:text-gray-300"
                  >
                    {content}
                  </p>
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ChatPanel({
  collapsed,
  onCollapseChange,
  course,
  currentSceneIndex,
  onSelectScene,
}: {
  readonly collapsed: boolean;
  readonly onCollapseChange: (collapsed: boolean) => void;
  readonly course: Course;
  readonly currentSceneIndex: number;
  readonly onSelectScene: (index: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<'lecture' | 'chat'>('chat');
  const [supportInteractive, setSupportInteractive] = useState(false);
  const [draft, setDraft] = useState('');
  const width = collapsed ? 0 : 400;

  const agents = useMemo(() => buildAgents(course), [course]);
  // 对话内容取自「当前页」的逐字稿 —— 翻页即切换，和左侧课件 / 右侧笔记保持同步。
  const turns = course.scenes[currentSceneIndex]?.dialogue ?? [];

  const tabCls = (active: boolean) =>
    cn(
      'flex items-center justify-center gap-1 text-xs font-semibold h-full flex-1 transition-colors',
      'border-b-2',
      active
        ? 'border-purple-500 dark:border-purple-400 text-purple-600 dark:text-purple-400'
        : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300',
    );

  return (
    <div
      style={{ width }}
      className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-l border-gray-100 dark:border-gray-800 shadow-[-2px_0_24px_rgba(0,0,0,0.02)] flex flex-col shrink-0 z-20 relative overflow-hidden transition-[width] duration-300"
    >
      {/* Tab header */}
      <div className="h-11 shrink-0 flex items-center gap-1 mt-2 px-2 border-b border-gray-100 dark:border-gray-800">
        <button
          onClick={() => setActiveTab('lecture')}
          className={tabCls(activeTab === 'lecture')}
        >
          <BookOpen className="w-3.5 h-3.5" />
          笔记
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={tabCls(activeTab === 'chat')}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          对话
        </button>
        <button
          onClick={() => onCollapseChange(true)}
          className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center bg-gray-100/80 dark:bg-gray-800/80 text-gray-500 dark:text-gray-400 ring-1 ring-black/[0.04] dark:ring-white/[0.06] hover:bg-gray-200/90 dark:hover:bg-gray-700/90 hover:text-gray-700 dark:hover:text-gray-200 active:scale-90 transition-all duration-200"
          aria-label="收起面板"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* 笔记 tab */}
      {activeTab === 'lecture' && (
        <LectureNotes
          course={course}
          currentSceneIndex={currentSceneIndex}
          onSelectScene={onSelectScene}
        />
      )}

      {/* 对话 tab */}
      {activeTab === 'chat' && (
        <>
          {/* 当前页标识 + support-interactive toggle */}
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 pt-2">
            <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 truncate">
              第 {currentSceneIndex + 1} 页 · 课堂对话
            </span>
            <button
              onClick={() => setSupportInteractive(!supportInteractive)}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-semibold transition-colors',
                supportInteractive
                  ? 'border-purple-300 dark:border-purple-600 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300',
              )}
              title="支持互动"
            >
              <Sparkles className="w-3.5 h-3.5" />
              支持互动
              <span
                className={cn(
                  'relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors',
                  supportInteractive ? 'bg-purple-500' : 'bg-gray-300 dark:bg-gray-600',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
                    supportInteractive ? 'translate-x-3.5 left-0.5' : 'left-0.5',
                  )}
                />
              </span>
            </button>
          </div>

          {/* Messages — 当前页课堂对话，随翻页切换 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4 scrollbar-hide">
            {turns.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-gray-400 dark:text-gray-500">
                本页暂无课堂对话
              </div>
            ) : (
              turns.map((t, i) => {
                const agent = agents[t.speaker] ?? agents.student;
                const isTeacher = agent.isTeacher;
                return (
                  <div key={i} className={cn('flex gap-2', isTeacher ? 'opacity-80' : '')}>
                    <AgentAvatar agent={agent} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[11px] font-bold" style={{ color: agent.color }}>
                          {agent.name}
                        </span>
                        {agent.role && (
                          <span className="text-[9px] px-1 py-px rounded bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500">
                            {agent.role}
                          </span>
                        )}
                      </div>
                      <div
                        className={cn(
                          'rounded-2xl rounded-tl-sm px-3 py-2 text-[13px] leading-relaxed break-words',
                          isTeacher
                            ? 'bg-purple-500/10 dark:bg-purple-500/15 text-purple-700 dark:text-purple-200'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200',
                        )}
                      >
                        {t.text}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Input */}
          <div className="shrink-0 p-3 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 bg-gray-100/80 dark:bg-gray-800/80 rounded-xl px-3 py-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="输入消息,与课堂互动…"
                className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none"
              />
              <button
                className="shrink-0 w-7 h-7 rounded-lg bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 text-white flex items-center justify-center transition-colors active:scale-90"
                aria-label="发送"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
