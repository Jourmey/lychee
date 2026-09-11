import { useCallback, useEffect, useRef, useState } from 'react';

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
 *                getBiJiData / storeCWState
 */
const ITS_PLAYER_URL =
  'https://kjds-qcdn.speiyou.com/webkjdsfiles/af2cc6f76ec34167a7faf1c25b841efb/index.html';
const ITS_COURSE_ID = '96e764bfca4a4d7c94337cda8c347273';
const ITS_PAGE_COUNT = 91;

/** 嵌入参数：关掉播放器自带的底部工具栏（翻页 / 画笔 / 直尺…）与键盘翻页，由 demo 作为唯一主控。 */
const ITS_EMBED_PARAMS: Record<string, string> = {
  id: ITS_COURSE_ID,
  pageCount: String(ITS_PAGE_COUNT),
  line: 'off',
  changePageTool: 'false',
  disableKeyboardEvent: 'true',
  // devHideToolPanel 会在环境配置合并之后强制把 config.toolPanel 覆盖为 3；
  // 播放器模板仅在 toolPanel 为 1/2/4 时渲染工具栏，3 即完全隐藏。
  devHideToolPanel: 'true',
};

export function ItsStage({ currentSceneIndex }: { readonly currentSceneIndex: number }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const pageRef = useRef(currentSceneIndex);
  pageRef.current = currentSceneIndex;
  const readyRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  /** 跳到指定页。`pageTurning.page` 是 0 基（目录面板发的是 `目录项-1`），与 demo 的场景序号一致。 */
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

  // 跟随 demo 时间轴翻页。
  useEffect(() => {
    sendPage(currentSceneIndex);
  }, [currentSceneIndex, sendPage]);

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

  const src = `${ITS_PLAYER_URL}?${new URLSearchParams(ITS_EMBED_PARAMS).toString()}`;

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
