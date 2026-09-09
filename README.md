# lychee —— 授课场景 Demo

一个纯静态、数据驱动的「课堂授课场景」demo。所有课件数据来自 `src/data.json`，浏览器直接渲染，**复刻 OpenMAIC 的课堂播放界面**：深色主题 + 右侧「笔记 / 对话」多智能体讨论面板 + 底部 Roundtable 讲解气泡 + 左场景侧栏。

## 技术栈

- **[Vite][vite] + [React 19][react] + TypeScript**，Tailwind CSS v4。
- **`@openmaic/renderer` / `@openmaic/dsl`**：直接复用 OpenMAIC 的渲染器与场景 DSL（已 build 为 ESM，见 `packages/@openmaic/*`）。
- 数据驱动：单个 `src/data.json` 描述整节课（页面、幻灯片、讲解文本、白板/聚光灯/激光动作）。

## 如何运行

```bash
cd lychee
pnpm install     # 使用 pnpm（pnpm-workspace 已把 @openmaic/* 纳入本地 workspace）
pnpm dev         # http://localhost:5173
```

其它命令：

```bash
pnpm build       # 产物输出到 dist/
pnpm preview     # 预览 build 产物
pnpm typecheck   # 仅类型检查（tsc --noEmit）
```

> 说明：`@openmaic/renderer`、`@openmaic/dsl` 未发布到 npm，这里把它们 **构建后的 `dist/` 作为本地 workspace 包** 放进 `packages/@openmaic/*`，因此仓库可独立安装、无需依赖外部 OpenMAIC 仓库。若需升级这两个包，用 OpenMAIC 仓库里对应包重新 build 后覆盖 `packages/@openmaic/*/dist` 即可。

## 目录结构

```
lychee/
├── index.html              # 页面骨架
├── vite.config.ts          # Vite 配置（已排除 @openmaic/* 的依赖预构建）
├── tsconfig.json
├── src/
│   ├── main.tsx            # React 入口
│   ├── App.tsx             # 顶层（默认深色主题）
│   ├── data.json           # ★ 课程数据（唯一数据源，你来填）
│   ├── types.ts            # Course / 场景类型定义
│   ├── index.css           # 全局样式 + Tailwind 主题 token
│   └── components/         # Header / SceneSidebar / SlideStage / Roundtable / CanvasToolbar / ChatPanel / Whiteboard
│   └── lib/                # usePlayback（播放引擎）/ cn
└── packages/
    └── @openmaic/
        ├── dsl/            # 场景 DSL（build 产物）
        └── renderer/       # 幻灯片渲染器（build 产物 + fonts.css）
```

## data.json 字段说明

以 `src/data.json` 为准，顶层：

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
| `content.canvas` | object | type=slide 时：OpenMAIC 幻灯片画布（`Slide`） |
| `actions` | array | 本页播放动作，按 `at` 时间轴执行 |

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

## 复刻要点（对照 OpenMAIC）

- **布局**：顶层全宽 `Header`，下方 `[SceneSidebar | 主列(SlideStage + Roundtable) | ChatPanel]`。
- **右侧面板**：`笔记`（从 `scenes` 生成的每页讲义）与 `对话`（多智能体课堂讨论）双 Tab，可收起。
- **渲染**：`SlideStage` 用 `@openmaic/renderer` 的 `SlideCanvas` 1:1 渲染幻灯片与 spotlight / laser 效果。
- **播放**：`usePlayback` 用 `requestAnimationFrame` 驱动动作时间轴，并处理自动翻页、关闭音频。

[vite]: https://vitejs.dev
[react]: https://react.dev
