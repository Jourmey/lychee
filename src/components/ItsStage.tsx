import { useCallback, useEffect, useRef, useState } from 'react';
import type { Course } from '../types';

/**
 * 直接嵌入 ITS 官方播放器，并由本 demo 通过 postMessage 驱动翻页。
 *
 * 之前是把课件内容 JSON 下载下来、反解成 OpenMAIC 的 Slide 元素（等于重写了一遍 ITS
 * 的渲染器，既冗余又有损）。ITS 播放器本身就是为「被 iframe 嵌入 + 父页面 postMessage
 * 控制」而设计的 —— 它自己也往 window.parent 发 cwLog / cwError / rush_answer 等消息。
 *
 * 已确认：该页面无 X-Frame-Options、无 CSP frame-ancestors，且 Access-Control-Allow-Origin: *，
 * 可直接 <iframe> 嵌入。
 *
 * 控制协议（取自播放器 SDK common_web/dist/js/bundle.js 的 window message 路由）：
 *   父 → 播放器：pageTurning{page,pageType,speed} / changePageNext / changePagePre /
 *                getCatalogueInfo / onOffLight / setViewScale / playAnimationForPage
 *   播放器 → 父：coursewareLoadingProgress / coursewareLoadError / cwLog / cwError /
 *                getBiJiData / storeCWState / cwIsReady
 *
 * 「下一步」= ITS 的「动画播放」。父页面发 `{type:'playAnimationForPage', data:{dir:'next'}}`
 * 即可推进一格。注意是**单向**的：播放器只回报 changeAnimateStatus 这个配置布尔值
 * （currentAnimateStatus），**不回报当前步序 / 总步数 / 是否有下一步**。因此步序无法观测，
 * 只能按 content/pages.json 里人工标注的 steps 时间点定时盲发。
 * 好在本课件 `setConfig.changeAnimateStatus = true`，翻页会自动 resetAllPageAni() 归零，
 * 所以每页都从第 0 步开始，盲发是可复现的。
 */

/** 嵌入参数：关掉播放器自带的底部工具栏（翻页 / 画笔 / 直尺…）与键盘翻页，由 demo 作为唯一主控。 */
const ITS_EMBED_PARAMS: Record<string, string> = {
  line: 'off',
  changePageTool: 'false',
  disableKeyboardEvent: 'true',
  // devHideToolPanel 会在环境配置合并之后强制把 config.toolPanel 覆盖为 3；
  // 播放器模板仅在 toolPanel 为 1/2/4 时渲染工具栏，3 即完全隐藏。
  devHideToolPanel: 'true',
  // 课件区点击默认「先推进下一步动画，动画放完再翻页」。这里只关翻页那一步：
  // devAutoChangePage → setConfig.autoChangePage=false（优先级高于环境配置），
  // 使 checkoutChangePage("canvas", 空) 不再 changeNextPage，退化成发一条
  // sendNeedChangePage 请求（本 demo 不响应）。点击仍可推进「下一步」。
  // autoChangePage 是 autoChangePage 的环境参数（仅 env=2 生效），一并给出兜底。
  devAutoChangePage: 'false',
  autoChangePage: 'false',
};

/** 翻页后播放器要滑动动画 + 加载该页资源，这段窗口内发的动画指令会被丢弃。 */
const PAGE_LOAD_GRACE_MS = 700;

export function ItsStage({
  currentSceneIndex,
  itsPage,
  firedStepCount,
  its,
}: {
  readonly currentSceneIndex: number;
  /** 当前场景对应的**真实 ITS 页码（0 基）**。缺省退回场景序号。 */
  readonly itsPage?: number;
  /** 本页应已触发的「下一步动画」步数，由播放时钟给出；到点补发 next。 */
  readonly firedStepCount: number;
  /** ITS 播放器嵌入配置（来自所在数据集的 dataset.config.json → data.json 的 `its`）。 */
  readonly its?: Course['its'];
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // 场景顺序可能与 ITS 页码不同（按老师翻页顺序排列、同页可重复），翻页指令用真实页码。
  const page = itsPage ?? currentSceneIndex;
  const pageRef = useRef(page);
  pageRef.current = page;
  const readyRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  /** 本页已发出的动画步数，翻页时归零。 */
  const sentStepsRef = useRef(0);
  const graceUntilRef = useRef(0);
  const firedStepCountRef = useRef(firedStepCount);
  firedStepCountRef.current = firedStepCount;

  /** 跳到指定页。`pageTurning.page` 是 0 基（目录面板发的是 `目录项-1`），与 ITS 页码一致。 */
  const sendPage = useCallback((index: number) => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'pageTurning', page: index, pageType: 'normal', speed: 0 },
      '*',
    );
  }, []);

  // 播放器就绪后会主动向父页面发消息；收到即视为可接收控制指令。
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source === frameRef.current?.contentWindow) readyRef.current = true;
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /** 推进一格「下一步动画」。盲发：播放器不回报成功与否，也发不坏。 */
  const sendNextStep = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'playAnimationForPage', data: { dir: 'next' } },
      '*',
    );
  }, []);

  /** 把「应已触发」但「尚未发出」的步数补齐。 */
  const flushSteps = useCallback(() => {
    if (performance.now() < graceUntilRef.current) return;
    while (sentStepsRef.current < firedStepCountRef.current) {
      sendNextStep();
      sentStepsRef.current += 1;
    }
  }, [sendNextStep]);

  // 跟随 demo 时间轴翻页（发的是真实 ITS 页码）。
  useEffect(() => {
    sendPage(page);
  }, [page, sendPage]);

  // 翻页 → 动画归零。播放器 changeAnimateStatus=true 会自动 resetAllPageAni()，
  // 这里只重置本地计数，并留一段加载宽限期，避免指令打在还没就绪的页面上。
  useEffect(() => {
    sentStepsRef.current = 0;
    graceUntilRef.current = performance.now() + PAGE_LOAD_GRACE_MS;
    const timer = window.setTimeout(flushSteps, PAGE_LOAD_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [currentSceneIndex, flushSteps]);

  // 时钟越过新的 step 时间点 → 补发 next。
  useEffect(() => {
    flushSteps();
  }, [firedStepCount, flushSteps]);

  // 冷启动兜底：播放器初始化完成前的指令会被忽略，因此加载后短暂重试。
  useEffect(() => {
    if (!loaded) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      if (readyRef.current || tries >= 20) {
        window.clearInterval(timer);
        return;
      }
      tries += 1;
      sendPage(pageRef.current);
    }, 400);
    return () => window.clearInterval(timer);
  }, [loaded, sendPage]);

  const src = its
    ? `${its.playerUrl}?${new URLSearchParams({
        ...ITS_EMBED_PARAMS,
        id: its.courseId,
        pageCount: String(its.pageCount),
      }).toString()}`
    : null;

  if (!src) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-white text-gray-500 text-sm">
        当前数据集未配置 ITS 播放器（缺 `its` 字段）
      </div>
    );
  }

  return (
    <iframe
      ref={frameRef}
      src={src}
      title="ITS 课件"
      className="w-full h-full border-0 bg-white"
      allow="autoplay; fullscreen"
      onLoad={() => setLoaded(true)}
    />
  );
}
