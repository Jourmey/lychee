import { useEffect, useRef } from 'react';

/**
 * DigitalHuman — 2D 数字人半身像。
 *
 * 纯 SVG 手绘，无外部模型/依赖（Live2D 那套 Cubism Core 是闭源二进制，官方免费模型
 * 又明文禁止「在应用之外再分发模型文件」，和本项目「资源传 OSS 公开分发」的部署方式
 * 冲突，故不走）。形象分 `teacher` / `assistant` 两套。
 *
 * 三个动作全部走 CSS keyframes（内联 style 引用，绕开 Tailwind v4 会把动画名吃掉的问题）：
 *   - dh-breathe   待机呼吸
 *   - dh-talk-bob  说话时轻微点头
 *   - dh-blink     眨眼
 * 口型不在这里 —— 见 `Mouth`，由程序化 viseme 时钟按「当前句时长」驱动。
 */

export type HumanRole = 'teacher' | 'assistant';

interface Skin {
  skin: string;
  skinShade: string;
  hair: string;
  hairShade: string;
  clothes: string;
  clothesShade: string;
  collar: string;
  accent: string;
  lip: string;
  tongue: string;
}

/** 两套配色：老师紫（对齐 agents.teacher #8b5cf6），助教青绿（agents.assistant #10b981）。 */
const SKINS: Record<HumanRole, Skin> = {
  teacher: {
    skin: '#f7d5bc',
    skinShade: '#e9bd9d',
    hair: '#3b3550',
    hairShade: '#2b273d',
    clothes: '#7c5cd6',
    clothesShade: '#6647bb',
    collar: '#f4f1ff',
    accent: '#8b5cf6',
    lip: '#8c4148',
    tongue: '#c96b73',
  },
  assistant: {
    skin: '#fbdcc6',
    skinShade: '#efc7a9',
    hair: '#2f8f86',
    hairShade: '#23726b',
    clothes: '#12a97f',
    clothesShade: '#0d8d6a',
    collar: '#eafff7',
    accent: '#10b981',
    lip: '#8a4a52',
    tongue: '#cf7d84',
  },
};

/**
 * 程序化 viseme 时钟 —— 在 rAF 里按音节抖动口型开合度。
 *
 * 不开音频分析：`usePlayback` 已经给了我「谁在说 / 说的是第几句 / 有没有暂停」，
 * 口型只要在"正在播"时按音节节奏开合即可，不碰音频管线也就零风险。
 * 开合度直接写 DOM（`ref.style.transform`），不 setState —— 60fps 下不触发 React 重渲染。
 */
function Mouth({
  speaking,
  seed,
  skin,
}: {
  readonly speaking: boolean;
  readonly seed: number;
  readonly skin: Skin;
}) {
  const ref = useRef<SVGGElement>(null);

  useEffect(() => {
    let raf = 0;
    // 下限：闭合也要留一条唇线，否则嘴会整个消失（看起来像没画嘴）。
    const LIP_LINE = 0.13;
    let cur = LIP_LINE;
    let last = performance.now();

    const apply = () => {
      if (ref.current) ref.current.style.transform = `scaleY(${cur.toFixed(3)})`;
    };

    // 闭嘴：暂停 / 换人时平滑收口。
    if (!speaking) {
      const close = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        cur += (LIP_LINE - cur) * (1 - Math.exp(-dt / 0.045));
        if (Math.abs(cur - LIP_LINE) < 0.005) cur = LIP_LINE;
        apply();
        if (Math.abs(cur - LIP_LINE) > 0.006) raf = requestAnimationFrame(close);
      };
      raf = requestAnimationFrame(close);
      return () => cancelAnimationFrame(raf);
    }

    // 确定性伪随机（LCG）：同一角色节奏稳定，但不会机械重复。
    let s = (seed >>> 0) || 1;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    let until = 0;
    let target = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      until -= dt;

      if (until <= 0) {
        // 新音节：幅度 + 时长（约 8~20 字/秒的语速感）
        target = LIP_LINE + 0.1 + rand() * (1 - LIP_LINE - 0.1);
        until = 0.08 + rand() * 0.12;
        // 少量「闭口音」（唇音/停顿），读起来才有抑扬顿挫
        if (rand() < 0.16) target = LIP_LINE;
      }

      const tau = target > cur ? 0.032 : 0.05;
      cur += (target - cur) * (1 - Math.exp(-dt / tau));
      apply();
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speaking, seed]);

  return (
    // 外层 g 已平移到嘴心；内层 scaleY 的默认 transform-origin(0 0) 即嘴心，
    // 所以开合是「上下张嘴」而不是「往左下缩小」。
    <g ref={ref} style={{ transform: 'scaleY(0.13)' }}>
      {/* 唇形：上下唇不对称的透镜形，闭合时压扁成一条线 */}
      <path d="M-10.5,0 Q0,12 10.5,0 Q0,-6 -10.5,0 Z" fill={skin.lip} />
      {/* 上齿 */}
      <path d="M-9.2,-1.2 L9.2,-1.2 L7.8,-3.6 L-7.8,-3.6 Z" fill="#fdfdfd" />
      {/* 舌 */}
      <ellipse cx="0" cy="5.6" rx="5.4" ry="3.4" fill={skin.tongue} />
    </g>
  );
}

/** 一只眼睛（外框已平移到眼角，眨眼缩 Y 围绕自身中心）。 */
function Eye({ x, y }: { readonly x: number; readonly y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g style={{ animation: 'dh-blink 5.2s ease-in-out infinite' }}>
        <ellipse rx="7.4" ry="8.6" fill="#ffffff" />
        <ellipse cy="0.9" rx="4.8" ry="6.3" fill="#33303f" />
        <circle cx="-1.7" cy="-2.1" r="1.8" fill="#ffffff" />
        <circle cx="1.9" cy="2.3" r="1" fill="#ffffff" opacity="0.7" />
      </g>
    </g>
  );
}

export function DigitalHuman({
  role,
  name,
  speaking,
  size = 112,
}: {
  readonly role: HumanRole;
  readonly name: string;
  /** 正在说话 —— 口型抖动 + 轻微点头 + 外圈高亮。 */
  readonly speaking: boolean;
  readonly size?: number;
}) {
  const skin = SKINS[role];
  const isAI = role === 'assistant';

  return (
    <div className="flex flex-col items-center select-none" style={{ width: size }}>
      <div
        className="relative"
        style={{
          width: size,
          height: size * 1.08,
          animation: speaking
            ? 'dh-talk-bob 1.15s ease-in-out infinite'
            : 'dh-breathe 3.8s ease-in-out infinite',
        }}
      >
        {/* 说话时的呼吸光晕 */}
        {speaking && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `radial-gradient(circle at 50% 62%, ${skin.accent}55 0%, ${skin.accent}1a 46%, transparent 70%)`,
              filter: 'blur(6px)',
              animation: 'dh-ring 1.6s ease-in-out infinite',
            }}
          />
        )}

        <svg viewBox="0 0 140 168" width={size} height={size * 1.08} className="relative block">
          {/* 耳朵：画在头发之前，让后层头发压住大半，只露一点边 —— 否则像两个球挂在脸外 */}
          <ellipse cx="35" cy="76" rx="5.6" ry="8.2" fill={skin.skinShade} />
          <ellipse cx="105" cy="76" rx="5.6" ry="8.2" fill={skin.skinShade} />

          {/* 头发（后层）：只做上半圈轮廓 —— cy 上移、不越过下巴，否则脸会被一圈深色箍住 */}
          <ellipse cx="70" cy="60" rx="43" ry="43" fill={skin.hairShade} />

          {/* 脖子 */}
          <rect x="60" y="94" width="20" height="28" rx="9" fill={skin.skinShade} />

          {/* 身体 */}
          <path
            d="M16,168 C16,131 40,113 70,113 C100,113 124,131 124,168 Z"
            fill={skin.clothes}
          />
          <path
            d="M16,168 C16,131 40,113 70,113 C76,113 80,114 84,116 C64,122 46,140 44,168 Z"
            fill={skin.clothesShade}
            opacity="0.55"
          />
          {/* 领口 */}
          <path d="M56,114 L70,136 L84,114 L78,111 L70,126 L62,111 Z" fill={skin.collar} />

          <ellipse cx="70" cy="70" rx="35" ry="39" fill={skin.skin} />

          {/* 刘海 */}
          <path
            d="M35,64 C35,33 50,22 70,22 C90,22 105,33 105,64 C105,64 101,51 93,48 C85,55 55,55 47,48 C39,51 35,52 35,64 Z"
            fill={skin.hair}
          />

          {/* 眉毛 */}
          <path
            d="M47,59 q9,-5 17,-1.5"
            stroke={skin.hairShade}
            strokeWidth="3.1"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M76,57.5 q8,-3.5 17,1.5"
            stroke={skin.hairShade}
            strokeWidth="3.1"
            strokeLinecap="round"
            fill="none"
          />

          <Eye x={56} y={72} />
          <Eye x={84} y={72} />

          {/* 腮红 */}
          <ellipse cx="46" cy="88" rx="7.5" ry="4.2" fill={skin.accent} opacity="0.22" />
          <ellipse cx="94" cy="88" rx="7.5" ry="4.2" fill={skin.accent} opacity="0.22" />

          {/* 嘴：平移到嘴心后再做开合 */}
          <g transform="translate(70 90)">
            <Mouth speaking={speaking} seed={role === 'teacher' ? 20260914 : 771} skin={skin} />
          </g>

          {/* AI 助教：头顶一根发光天线 */}
          {isAI && (
            <>
              <path
                d="M70,22 C70,14 70,10 70,6"
                stroke={skin.hairShade}
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
              />
              <circle
                cx="70"
                cy="5"
                r="4"
                fill={skin.accent}
                style={{ animation: speaking ? 'dh-ring 1.1s ease-in-out infinite' : undefined }}
              />
            </>
          )}
        </svg>
      </div>

      {/* 名牌 */}
      <div
        className="mt-0.5 flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-bold backdrop-blur-md"
        style={{
          borderColor: speaking ? `${skin.accent}99` : 'rgba(255,255,255,0.22)',
          background: speaking ? `${skin.accent}26` : 'rgba(24,24,32,0.55)',
          color: speaking ? '#ffffff' : 'rgba(255,255,255,0.82)',
        }}
      >
        {speaking && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: skin.accent, animation: 'dh-ring 1.1s ease-in-out infinite' }}
          />
        )}
        <span className="max-w-[92px] truncate">{name}</span>
      </div>
    </div>
  );
}
