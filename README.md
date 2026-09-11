# lychee —— 授课场景 Demo

一个数据驱动的「课堂授课场景」demo。**课件区直接 `<iframe>` 嵌入 ITS 官方播放器**，由 demo 通过 `postMessage` 驱动翻页；其余界面**复刻 OpenMAIC 的课堂播放界面**：深色主题 + 右侧「笔记 / 对话」面板 + 底部 Roundtable 讲解气泡 + 左场景侧栏。侧栏缩略图、笔记、对话、讲解时间轴均来自 `data/data.json`（由 ITS 课件内容 + 课堂逐字稿合成）。

## 技术栈

- **[Vite][vite] + [React 19][react] + TypeScript**，Tailwind CSS v4。
- **`@openmaic/renderer` / `@openmaic/dsl`**：直接复用 OpenMAIC 的渲染器与场景 DSL（已 build 为 ESM，见 `packages/@openmaic/*`）。
- 数据驱动：单个 `data/data.json` 描述整节课（页面、幻灯片、讲解文本、白板/聚光灯/激光动作）。

## 如何运行

```bash
cd lychee
pnpm install     # 使用 pnpm（pnpm-workspace 已把 @openmaic/* 纳入本地 workspace）
pnpm dev         # http://localhost:5173
```

其它命令：

```bash
pnpm build        # 产物输出到 dist/
pnpm preview      # 预览 build 产物
pnpm typecheck    # 仅类型检查（tsc --noEmit）
pnpm build-course # 由 ITS 课件 + 逐字稿重新生成 data/data.json
```

> 说明：`@openmaic/renderer`、`@openmaic/dsl` 未发布到 npm，这里把它们 **构建后的 `dist/` 作为本地 workspace 包** 放进 `packages/@openmaic/*`，因此仓库可独立安装、无需依赖外部 OpenMAIC 仓库。若需升级这两个包，用 OpenMAIC 仓库里对应包重新 build 后覆盖 `packages/@openmaic/*/dist` 即可。

## 目录结构

```
lychee/
├── index.html              # 页面骨架
├── vite.config.ts          # Vite 配置（已排除 @openmaic/* 的依赖预构建）
├── tsconfig.json
├── data/                   # ★ 数据与代码分离
│   ├── data.json           # ★ 课程数据（唯一数据源，由 build-course.mjs 生成）
│   ├── transcripts.json    # 课堂逐字稿（带时间戳 / 说话人）
│   └── raw/
│       └── its-content.json # ITS 课件原始内容（91 页）
├── scripts/
│   └── build-course.mjs    # ITS 课件 + 逐字稿 → data/data.json
├── public/
│   ├── courseware/imgs/    # 课件离线图片资源（/courseware/imgs/*）
│   └── avatars/            # 默认头像（教师 / 学生 / 助手）
├── src/
│   ├── main.tsx            # React 入口
│   ├── App.tsx             # 顶层（默认深色主题）
│   ├── types.ts            # Course / 场景类型定义
│   ├── index.css           # 全局样式 + Tailwind 主题 token
│   ├── components/         # Header / SceneSidebar / ItsStage(iframe) / SlideStage / Roundtable / CanvasToolbar / ChatPanel / Whiteboard
│   └── lib/                # usePlayback（播放引擎）/ cn
└── packages/
    └── @openmaic/
        ├── dsl/            # 场景 DSL（build 产物）
        └── renderer/       # 幻灯片渲染器（build 产物 + fonts.css）
```

## data.json 字段说明

以 `data/data.json` 为准。该文件由 `scripts/build-course.mjs` 生成：读取 ITS 课件原始内容
（`data/raw/its-content.json`）与课堂逐字稿（`data/transcripts.json`），把每页课件转成
`Slide` 画布（供左侧栏缩略图）、把逐字稿按页切分并切成 `speech` 动作（驱动底部讲解与
时间轴）与 `dialogue` 对话（驱动右侧「对话」Tab）。**课件主画面不由此文件渲染，而是
iframe 嵌 ITS 官方播放器**（见下）。顶层：

| 字段 | 说明 |
|---|---|
| `version` | 数据结构版本 |
| `course.title` | 课程标题，显示在顶部 Header |
| `course.teacher.name` | 授课教师名，显示在底部 Roundtable |
| `scenes` | 页面数组，按顺序播放 |

### 每一页 `scenes[]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 页唯一标识 |
| `type` | string | 场景类型，目前支持 `slide` |
| `title` | string | 本页标题，显示在左上与左侧栏 |
| `audio` | string | 可选，本页音频路径（相对 `index.html`） |
| `content.canvas` | object | type=slide 时：OpenMAIC 幻灯片画布（`Slide`，用于左侧栏缩略图） |
| `actions` | array | 本页播放动作（`speech`…），按时间轴执行 |
| `dialogue` | array | 本页课堂对话 `[{ speaker, text }]`，驱动右侧「对话」Tab |

### `actions[]` 播放动作

每个动作一个对象，通用字段：`type`（动作类型）、`at`（场景开始后的第几秒执行，省略时紧跟上一个动作）、以及类型相关字段。

| type | 效果 |
|---|---|
| `speech` | 更新底部讲解文本 |
| `spotlight` | 聚焦幻灯片某元素，其余变暗 |
| `laser` | 激光红点移动到目标元素上指示 |
| `wb_open` / `wb_close` | 打开 / 关闭白板层 |
| `wb_draw_text` / `wb_draw_line` / `wb_draw_shape` | 白板上写字 / 画线 / 画形状 |

> `speech`、`spotlight`、`laser`、`wb_*` 的类型来自 `@openmaic/dsl` 的 `Action` 联合类型。

## 课件区：iframe 嵌入 ITS 官方播放器

`src/components/ItsStage.tsx` 直接 `<iframe>` 加载 ITS 播放器（内部课件 CDN，无 `X-Frame-Options`、无 CSP
`frame-ancestors`，`Access-Control-Allow-Origin: *`，可直接嵌入），并由 demo 通过 `postMessage` 驱动，
**demo 作为唯一主控**：

- **父 → 播放器**（翻页）：`{ type: 'pageTurning', page, pageType: 'normal' }`（`page` 为 **0 基**页码，
  与目录面板一致：内部目录项 1 基、发出时 `-1`）。
- **播放器 → 父**：`coursewareLoadingProgress` / `coursewareLoadError` / `cwLog` / `cwError` /
  `getBiJiData`（笔记数据）等。
- 嵌入参数 `devHideToolPanel=true&disableKeyboardEvent=true&changePageTool=false`：关掉播放器自带的
  底部工具栏（翻页 / 画笔 / 直尺…）与键盘翻页，翻页完全由 demo 时间轴（`usePlayback` 的
  `currentSceneIndex`）决定。`devHideToolPanel` 会在环境配置合并之后强制 `config.toolPanel=3`，
  而播放器模板仅在 `toolPanel` 为 `1/2/4` 时渲染工具栏，故 `3` 即完全隐藏。
- 播放器初始化完成前收到的指令会被忽略，故加载后做有限重试。

> 其余可用控制指令（暂未启用）：`changePageNext` / `changePagePre` / `getCatalogueInfo`（取页目录）/
> `onOffLight`（关灯）/ `setViewScale`（缩放）/ `playAnimationForPage`（播动画）/ `setUpVideoState` /
> `setUpAudioState`。

## 复刻要点（对照 OpenMAIC）

- **布局**：顶层全宽 `Header`，下方 `[SceneSidebar | 主列(ItsStage + Roundtable) | ChatPanel]`。
- **右侧面板**：`笔记`（从 `scenes` 生成的每页讲义）与 `对话`（按页切分的课堂对话）双 Tab，可收起。
- **课件主画面**：`ItsStage` 用 iframe 嵌 ITS 官方播放器，demo 通过 `postMessage` 翻页。
- **左侧栏缩略图**：仍由 `@openmaic/renderer` 渲染 `data.json` 里的 `Slide`（转换产物）。
- **播放**：`usePlayback` 用 `requestAnimationFrame` 驱动动作时间轴，并处理自动翻页、关闭音频。

[vite]: https://vitejs.dev
[react]: https://react.dev
