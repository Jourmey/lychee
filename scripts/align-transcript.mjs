/**
 * align-transcript.mjs — 把课堂逐字稿按「ITS 课件页」对齐，产出每页的讲解时间区间。
 *
 * 数据集目录默认 `data/`，用环境变量 `DATASET` 切换（见 scripts/lib/dataset.mjs）。
 *
 * 输入：
 *   <DATASET>/data.json         场景列表（每页含课件文本签名 content.canvas.elements）
 *   <DATASET>/transcripts.json  课堂逐字稿（BeginTime/EndTime 毫秒，SpeakerId）
 *   <DATASET>/dataset.config.json  （可选）人工标定边界 manualBounds
 * 输出：
 *   <DATASET>/alignment.json    每页 { page, title, start, end, anchor, source }
 *   （可选）把 start/end 写回 <DATASET>/data.json 的 scenes[].time
 *
 * 对齐策略（高精度锚点 + 单调插值）：
 *   1. 归一化：去掉 HTML / 标点 / 空白，只留汉字与字母数字。
 *   2. 短语锚点：每页取「连续 ≥6 个汉字」的短语，在归一化逐字稿里做精确匹配，
 *      命中即得到该页最确定的 (页 → 时间) 钉子。长短语精度高、召回低。
 *   3. 单调约束：页序 = 时间序。用 LIS（最长递增子序列）剔除乱序/误匹配锚点。
 *   4. 插值：未命中的页在相邻锚点之间按「页数比例」铺满；命中页用锚点时间。
 *   5. 宏观分段边界：开头闲聊（老师 8:25 上下课那段寒暄）不计入第一页，
 *      第一页从正文开始。
 *
 * 重新生成：DATASET=data node scripts/align-transcript.mjs
 *   ... --write   # 同时把 time 写回 <DATASET>/data.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATASET, DS, ROOT, readJson, loadConfig } from './lib/dataset.mjs';

const WRITE_BACK = process.argv.includes('--write');

const course = readJson('data.json');
const transcripts = readJson('transcripts.json');

/* --------------------------------------------------------------- 人工标定 */

/**
 * 由用户对照视频人工给定的两个硬边界（视频时间，HH:MM:SS）—— 来自
 * <DATASET>/dataset.config.json 的 manualBounds：
 *   - startPage / startTime：老师开始正式讲解的页与时刻；
 *   - endPage   / endTime  ：视频末尾讲到哪一页。
 * 该页区间之外（课前寒暄 / 视频没讲到的页）不参与锚点对齐。
 * 视频与课件页**非均匀对应**，所以只在两个硬边界 + 文本锚点之间插值。
 */
const bounds = loadConfig().manualBounds ?? {};
const toMsOr = (t, fallback) => {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(t || ''));
  return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 : fallback;
};
const ANCHOR_START_PAGE = bounds.startPage ?? 1;
const ANCHOR_START_MS = toMsOr(bounds.startTime, 0);
const ANCHOR_END_PAGE = bounds.endPage ?? course.scenes.length;

/* ------------------------------------------------------------------ helpers */

const HAN = /[\u4e00-\u9fff]/;
/** 只留汉字与字母数字，其余（标点/空白/标签）全部丢弃。 */
const normalize = (s) =>
  (s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/[^\u4e00-\u9fff0-9a-zA-Z]/g, '');

const fmt = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/** 课件一页的全部可见文本（text / shape.text 的 content）。 */
function pageText(scene) {
  const els = scene?.content?.canvas?.elements || [];
  const parts = [];
  for (const el of els) {
    if (el.type === 'text' && el.content) parts.push(el.content);
    else if (el.type === 'shape' && el.text?.content) parts.push(el.text.content);
  }
  return parts.join('');
}

/** 从页面文本里取「连续 ≥minLen 个汉字」的短语（用于精确锚定）。 */
function phrasesOf(text, minLen = 5) {
  const out = [];
  const runs = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of runs) {
    if (run.length < minLen) continue;
    // 整段 run（更长更唯一）+ 所有 minLen 长的滑动窗口。
    out.push(run);
    for (let i = 0; i + minLen <= run.length; i++) out.push(run.slice(i, i + minLen));
  }
  return [...new Set(out)];
}

/* --------------------------------------------------- 逐字稿：归一化全文索引 */

const segs = [...transcripts]
  .filter((s) => s.Text && s.Text.trim())
  .sort((a, b) => a.BeginTime - b.BeginTime);

// 归一化逐字稿全文 + 「归一化字符下标 → 段落下标」映射
let normDoc = '';
const charToSeg = [];
for (let i = 0; i < segs.length; i++) {
  const n = normalize(segs[i].Text);
  for (let k = 0; k < n.length; k++) charToSeg.push(i);
  normDoc += n;
}

/* --------------------------------------------------------------- 短语锚点 */

const sceneList = course.scenes.map((s, i) => ({
  index: i,
  page: i + 1,
  title: s.title || `第 ${i + 1} 页`,
  text: pageText(s),
}));

/** 短语 → 出现在哪些页（用于过滤跨页重复的泛词）。 */
const phrasePages = new Map();
for (const sc of sceneList) {
  for (const p of phrasesOf(sc.text, 5)) {
    if (!phrasePages.has(p)) phrasePages.set(p, new Set());
    phrasePages.get(p).add(sc.page);
  }
}

/** 短语在归一化逐字稿里的所有出现位置（升序）。 */
function occurrences(phrase) {
  const out = [];
  let pos = normDoc.indexOf(phrase);
  while (pos >= 0) {
    out.push(pos);
    pos = normDoc.indexOf(phrase, pos + 1);
  }
  return out;
}

/**
 * 候选锚点：每页的候选短语（页内唯一，或长度 ≥8 的长句/文言原句）在逐字稿里的
 * 每一次出现都算一个候选。短语越长越可信 → 以短语长度作为权重。
 */
const candidates = [];
for (const sc of sceneList) {
  // 只在「人工标定的讲解区间」内取锚点：第 1–8 页是寒暄、第 65 页后本视频没讲到。
  if (sc.page < ANCHOR_START_PAGE || sc.page > ANCHOR_END_PAGE) continue;
  const cand = [...new Set(phrasesOf(sc.text, 6))].filter(
    (p) => phrasePages.get(p)?.size === 1 || p.length >= 10,
  );
  for (const p of cand) {
    const occ = occurrences(p);
    const spread = phrasePages.get(p)?.size || 1; // 出现在几页
    // 置信度：长短语更可信；页内唯一（spread=1）×2；逐字稿仅出现一次（occ=1）×3。
    let score = p.length * p.length;
    if (spread === 1) score *= 2;
    if (occ.length === 1) score *= 3;
    for (const pos of occ.slice(0, 100)) {
      const seg = charToSeg[pos];
      candidates.push({
        page: sc.page,
        index: sc.index,
        pos,
        seg,
        time: segs[seg].BeginTime,
        end: segs[seg].EndTime,
        phrase: p,
        score,
        confidence: occ.length === 1 && spread === 1 && p.length >= 8 ? 'high' : 'low',
      });
    }
  }
}

/**
 * 加权最长递增子序列：在「页序递增 + 时间递增」的约束下，选出一条总权重最大的
 * 候选链（每页至多一个锚点）。这样长短语/文言原句组成的骨架胜出，短期噪声被剔除。
 * 时间约束放松 TOL：同一页内容常被整段念出，相邻页的锚点可能相差几秒甚至倒挂，
 * 留有 TOL 容差可避免把后一页错误地推到下一次出现的位置（如原句被重复念到）。
 */
const TOL = 8000;
function weightedLIS(cands) {
  const list = [...cands].sort((a, b) => a.page - b.page || a.time - b.time || a.pos - b.pos);
  const n = list.length;
  const dp = new Array(n);
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    dp[i] = list[i].score;
    for (let j = 0; j < i; j++) {
      if (list[j].page < list[i].page && list[j].time <= list[i].time + TOL && dp[j] + list[i].score > dp[i]) {
        dp[i] = dp[j] + list[i].score;
        prev[i] = j;
      }
    }
  }
  let bestI = 0;
  for (let i = 1; i < n; i++) if (dp[i] > dp[bestI]) bestI = i;
  const chain = [];
  for (let i = bestI; i >= 0; i = prev[i]) chain.push(list[i]);
  return chain.reverse();
}

const MIN_GAP = 3000;
// 人工硬边界：第 9 页 = 39:30 作为骨架起点（最高优先，不可被覆盖）。
const anchors = [
  {
    page: ANCHOR_START_PAGE,
    index: ANCHOR_START_PAGE - 1,
    time: ANCHOR_START_MS,
    end: ANCHOR_START_MS,
    phrase: '（人工标定：讲解起点）',
    score: Infinity,
    confidence: 'manual',
    source: 'anchor',
  },
];
for (const c of weightedLIS(candidates)) {
  if (c.page === ANCHOR_START_PAGE) continue; // 已由人工硬边界固定
  // 同一名句被反复念到，会让多页挤在相近时间；只保留最早那页，其余丢弃（转插值）。
  if (anchors.length && c.time < anchors[anchors.length - 1].time + MIN_GAP) continue;
  anchors.push({ ...c, source: 'anchor' });
}

/* ------------------------------------------------------------- 时间轴铺满 */

const CLASS_START = segs[0].BeginTime;
const CLASS_END = Math.max(...segs.map((s) => s.EndTime));

/**
 * 以「人工硬边界 + 文本锚点」为骨架，在相邻锚点之间按页数比例线性插值，
 * 产出连续区间 [start, end)（end = 下一页 start），便于按时间点切片。
 * 三个区段：
 *   - 课前 [1, 9)：寒暄，落在 [课堂开始, 39:30]；
 *   - 讲解 [9, 64]：锚点 + 插值，末页止于课堂结束；
 *   - 未讲到 (64, N]：本视频没讲到，start/end 置空。
 */
function buildTimeline() {
  const anchorByPage = new Map(anchors.map((a) => [a.page, a]));
  const N = sceneList.length;

  // 负责讲解区间 [ANCHOR_START_PAGE, ANCHOR_END_PAGE] 的骨架点
  const pts = [];
  for (const a of anchors) pts.push({ page: a.page, time: a.time });
  pts.push({ page: ANCHOR_END_PAGE + 1, time: CLASS_END });

  const interpAt = (p) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      if (p >= a.page && p <= b.page) {
        const span = b.page - a.page;
        return span <= 0 ? a.time : a.time + ((p - a.page) / span) * (b.time - a.time);
      }
    }
    return CLASS_END;
  };

  // 讲解区间每页 start：锚点页用锚点时间，其余插值；再保证单调非降。
  const starts = new Map();
  for (let p = ANCHOR_START_PAGE; p <= ANCHOR_END_PAGE; p++) {
    const a = anchorByPage.get(p);
    starts.set(p, a ? a.time : interpAt(p));
  }
  let prev = ANCHOR_START_MS;
  for (let p = ANCHOR_START_PAGE; p <= ANCHOR_END_PAGE; p++) {
    if (starts.get(p) < prev) starts.set(p, prev);
    prev = starts.get(p);
  }

  // 课前寒暄页 [1, 9)：均分 [课堂开始, 39:30]（不重要，仅占位）。
  const preCount = ANCHOR_START_PAGE - 1;
  const preStart = CLASS_START;
  const preStep = preCount > 0 ? (ANCHOR_START_MS - preStart) / preCount : 0;

  return sceneList.map((sc) => {
    if (sc.page < ANCHOR_START_PAGE) {
      const k = sc.page - 1;
      return {
        page: sc.page, index: sc.index, title: sc.title,
        start: preStart + k * preStep,
        end: preStart + (k + 1) * preStep,
        source: 'preclass', anchor: false, phrase: null, confidence: 'preclass',
      };
    }
    if (sc.page > ANCHOR_END_PAGE) {
      return {
        page: sc.page, index: sc.index, title: sc.title,
        start: null, end: null,
        source: 'uncovered', anchor: false, phrase: null, confidence: 'uncovered',
      };
    }
    const a = anchorByPage.get(sc.page);
    const start = starts.get(sc.page);
    const end = sc.page < ANCHOR_END_PAGE ? Math.max(starts.get(sc.page + 1), start + 1000) : CLASS_END;
    return {
      page: sc.page, index: sc.index, title: sc.title,
      start, end,
      source: a ? 'anchor' : 'interp',
      anchor: !!a,
      phrase: a?.phrase,
      confidence: a ? a.confidence || 'low' : 'interp',
    };
  });
}

const timeline = buildTimeline();

/* ------------------------------------------------------------------- 输出 */

const anchorCount = timeline.filter((t) => t.anchor).length;
const highCount = timeline.filter((t) => t.confidence === 'high').length;
const coveredCount = timeline.filter((t) => t.source === 'anchor' || t.source === 'interp').length;

console.log(`\nITS 逐字稿对齐  页数=${timeline.length}  讲解页=${coveredCount}  锚点=${anchorCount}（高置信 ${highCount}）\n`);
console.log('页\t时间区间\t\t\t时长\t置信\t标题 / 命中短语');
console.log('─'.repeat(100));
for (const r of timeline) {
  const na = r.start == null;
  const dur = na ? '' : `${Math.round((r.end - r.start) / 1000)}s`;
  const conf = { high: '高', manual: '人工', preclass: '课前', uncovered: '未讲' }[r.confidence] || (r.anchor ? '中' : '低');
  const tag = r.anchor ? `“${(r.phrase || '').slice(0, 16)}”` : na ? '视频未讲到' : r.source === 'preclass' ? '课前寒暄' : '插值';
  const range = na ? '   —   —   ' : `${fmt(r.start)}–${fmt(r.end)}`;
  const line = `${String(r.page).padStart(3)}\t${range}\t${dur.padStart(6)}\t${conf}\t${tag.padEnd(20)}\t${r.title.slice(0, 20)}`;
  console.log(line);
}

/* -------------------------------------------------------- 写回 data 文件 */

const outPath = DS('alignment.json');
const payload = {
  version: '0.2',
  generatedFrom: { courseware: `${DATASET}/data.json`, transcript: `${DATASET}/transcripts.json` },
  manualBounds: {
    startPage: ANCHOR_START_PAGE,
    startTime: fmt(ANCHOR_START_MS),
    endPage: ANCHOR_END_PAGE,
    endTime: fmt(CLASS_END),
  },
  stats: {
    pages: timeline.length,
    covered: coveredCount,
    anchors: anchorCount,
    highConfidence: highCount,
    preclass: timeline.filter((t) => t.source === 'preclass').length,
    uncovered: timeline.filter((t) => t.source === 'uncovered').length,
    classStart: fmt(CLASS_START),
    classEnd: fmt(CLASS_END),
  },
  pages: timeline.map((r) => ({
    page: r.page,
    title: r.title,
    start: r.start == null ? null : fmt(r.start),
    end: r.end == null ? null : fmt(r.end),
    startMs: r.start,
    endMs: r.end,
    source: r.source,
    confidence: r.confidence,
    phrase: r.phrase || null,
  })),
};
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`\n✓ ${path.relative(ROOT, outPath)}  (pages=${timeline.length})`);

/* --------------------------------------------------- 手动校验文档（Markdown） */

/** 讲解区间内的宏观分段（由锚点与逐字稿内容归纳，便于按段落核对）。 */
const PHASES = [
  { from: 9, to: 19, name: '文言文学习思路 / 作者作品（苏东坡、苏轼）' },
  { from: 20, to: 23, name: '真题演练 · 文学常识' },
  { from: 24, to: 38, name: '《记承天寺夜游》精讲（文本正音 / 一词多义）' },
  { from: 39, to: 48, name: '《记承天寺夜游》内容理解 / 赏析 / 选择题' },
  { from: 49, to: 63, name: '《答谢中书书》精讲（题解 / 作者 / 文本正音）' },
  { from: 64, to: 64, name: '《答谢中书书》收尾（抒情议论）' },
];

function renderMarkdown() {
  const confLabel = (r) =>
    ({ high: '高 ✅', manual: '人工', preclass: '课前', uncovered: '未讲' }[r.confidence] || (r.anchor ? '中' : '低'));
  const rowsOf = (list) =>
    list
      .map((r) => {
        const na = r.start == null;
        const dur = na ? '—' : `${Math.round((r.end - r.start) / 1000)}s`;
        const phrase = r.anchor
          ? `“${(r.phrase || '').slice(0, 18)}”`
          : r.source === 'preclass'
            ? '—（课前寒暄）'
            : na
              ? '—（视频未讲到）'
              : '—（插值估算）';
        const start = na ? '—' : fmt(r.start);
        const end = na ? '—' : fmt(r.end);
        return `| ${r.page} | ${start} | ${end} | ${dur} | ${confLabel(r)} | ${phrase} | ${r.title.replace(/\|/g, '/').slice(0, 24)} |  |`;
      })
      .join('\n');

  const head = `| 页 | 起 | 止 | 时长 | 置信 | 锚点短语 | 页面标题 | 校验（对/错/实际时间） |
|---:|---|---|---:|---|---|---|---|`;

  const sections = PHASES.map((ph) => {
    const list = timeline.filter((r) => r.page >= ph.from && r.page <= ph.to);
    if (!list.length) return '';
    return `### ${ph.name}（第 ${ph.from}–${ph.to} 页）

${head}
${rowsOf(list)}`;
  }).join('\n\n');

  // 课前 / 未讲到两个区段单独列出（不参与讲解切片）
  const preList = timeline.filter((r) => r.source === 'preclass');
  const unList = timeline.filter((r) => r.source === 'uncovered');
  const extra = [
    preList.length
      ? `### 课前寒暄（第 1–${ANCHOR_START_PAGE - 1} 页，不重要）

${head}
${rowsOf(preList)}`
      : '',
    unList.length
      ? `### 本视频未讲到（第 ${ANCHOR_END_PAGE + 1}–${timeline.length} 页）

> 视频到 ${fmt(CLASS_END)} 结束，只讲到第 ${ANCHOR_END_PAGE} 页；以下页面本视频**没有讲到**，无时间点。

${head}
${rowsOf(unList)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return `# ITS 逐字稿对齐 · 手动校验表

> 由 \`scripts/align-transcript.mjs\` 生成。用于对照课堂视频逐页核对讲解时间点。
> 重新生成：\`pnpm align-transcript\`

## 概况

- 课程：${course.course.title}
- 视频/逐字稿区间：**${fmt(CLASS_START)} → ${fmt(CLASS_END)}**（共 ${Math.round((CLASS_END - CLASS_START) / 60000)} 分钟）
- **人工硬边界**：第 **${ANCHOR_START_PAGE}** 页起于 **${fmt(ANCHOR_START_MS)}**，第 **${ANCHOR_END_PAGE}** 页止于 **${fmt(CLASS_END)}**
- 讲解页：**${coveredCount}** 页（第 ${ANCHOR_START_PAGE}–${ANCHOR_END_PAGE} 页）　锚点：**${anchorCount}**（高置信 **${highCount}**）
- 课前寒暄：**${preList.length}** 页（第 1–${ANCHOR_START_PAGE - 1} 页）　本视频未讲到：**${unList.length}** 页（第 ${ANCHOR_END_PAGE + 1}–${timeline.length} 页）

## 怎么用 / 置信度含义

- **人工**：你给定的硬边界（第 ${ANCHOR_START_PAGE} 页 = ${fmt(ANCHOR_START_MS)}）。
- **高 ✅**：页面上有「页内唯一 + 逐字稿只出现一次」的长句（多为文言原句/题干），时间点基本可信。
- **中**：命中了短语，但该短语在其他页或逐字稿里也出现过，时间点值得复核。
- **低**：没有命中，时间点是相邻锚点之间按页数插值**估算**出来的，最需要你核对。
- **课前 / 未讲**：不参与切片，仅列出。
- 校验列可直接填 \`对\` / \`错\` / 实际时间（如 \`01:05:30\`），之后我据此修正。

## 核对重点（已知的不确定处）

1. **第 10–19 页**：夹在人工起点（39:30）与首个文本锚点之间，按页数均分，实际分布可能不同。
2. **第 25–38 页**：中段无锚点，按页数插值，最需要逐页核对。
3. **第 39 页**：锚在 **02:02:10**（原文确在讲「庭下如积水空明、竹柏影如水中藻荇」）。
4. **第 64 页**：按你的时间线止于视频末尾 ${fmt(CLASS_END)}。

## 逐页时间表

${sections}

${extra}
`;
}

const mdPath = DS('alignment.md');
fs.writeFileSync(mdPath, renderMarkdown());
console.log(`✓ ${path.relative(ROOT, mdPath)}  （手动校验表）`);

/* ----------------------------------------------------- 逐页老师讲解 CSV */

/** 说话人：讲得最多的那位是老师，只保留老师内容。 */
const charsBySpeaker = {};
for (const s of segs) charsBySpeaker[s.SpeakerId] = (charsBySpeaker[s.SpeakerId] || 0) + s.Text.length;
const teacherSpeaker = Object.entries(charsBySpeaker).sort((a, b) => b[1] - a[1])[0]?.[0];

/** CSV 字段转义：含逗号/引号/换行时用双引号包裹，内部双引号翻倍。 */
const csvField = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * 逐字稿 ASR 常见误识 → 修正（多为文言同音字、口头复述被听错）。
 * 顺序敏感：先具体、后笼统。
 */
const CORRECTIONS = [
  [/水中藻荇交横盖竹柏营业/g, '水中藻荇交横，盖竹柏影也'],
  [/盖(?:主板|竹柏)营业/g, '盖竹柏影也'],
  [/主板营业/g, '竹柏影也'],
  [/营业/g, '影'], // 余下多为「盖XX影」被听成「盖XX营业」
  [/怀民意味，紧相与步于中庭/g, '怀民亦未寝，相与步于中庭'],
  [/怀民意味/g, '怀民亦未寝'],
  [/烛影和白影/g, '竹影和柏影'],
  [/竹帛/g, '竹柏'],
  [/竹和博/g, '竹和柏'],
  [/骄横/g, '交横'],
  [/早性/g, '藻荇'],
  [/枣荇/g, '藻荇'],
  [/沪/g, '户'],
  [/穗/g, '遂'],
  [/啥叫户户/g, '啥叫户'],
  [/翻译燃的时候/g, '翻译然的时候'],
  [/空明记四个字儿/g, '空明，记住四个字儿'],
  [/(?:no[\s，。]*){2,}/gi, ''], // 口头 "no no no…" 噪声
  [/o\s*k\s*/gi, ''], // 口头 "ok / o k" 噪声
];

/** 标点修复：全角标点旁的半角句点、连续重复标点。分段与合段后都要跑。 */
function tidyPunct(s) {
  return (s || '')
    .replace(/([，。！？；：、])[.·]/g, '$1') // 全角标点后误带的半角句点/间隔号
    .replace(/[.·]([，。！？；：、])/g, '$1')
    .replace(/([，。！？；：、])\1+/g, '$1');
}

/** 清洗一段老师口播文本：修正常见误识、合并空白、去重标点。 */
function cleanText(s) {
  let out = (s || '').trim();
  for (const [re, to] of CORRECTIONS) out = out.replace(re, to);
  return tidyPunct(out.replace(/\s+/g, ''));
}

/**
 * 老师口播 → 分段长文本。按「停顿 ≥2.5s」或「本段已够长」断段，
 * 去掉时间点，拼接成通顺的连续文本。
 */
function teacherParagraphs(list) {
  const paras = [];
  let buf = '';
  let len = 0;
  let prevEnd = null;
  for (const s of list) {
    const gap = prevEnd == null ? 0 : s.BeginTime - prevEnd;
    if (buf && (gap >= 2500 || len >= 260)) {
      paras.push(buf);
      buf = '';
      len = 0;
    }
    const t = cleanText(s.Text);
    buf += t;
    len += t.length;
    prevEnd = s.EndTime;
  }
  if (buf) paras.push(buf);
  return paras;
}

/** 把逐字稿按页归属：段落 BeginTime 落在该页 [start, end) 内。 */
const segsByPage = new Map();
for (const r of timeline) {
  if (r.start == null) continue;
  const list = segs.filter((s) => s.BeginTime >= r.start && s.BeginTime < r.end);
  segsByPage.set(r.page, list);
}

function renderCsv() {
  const header = [
    'its页码', '页面标题', '开始时间', '结束时间', '时长秒', '置信', '锚点短语', '老师讲解内容',
  ];
  const rows = timeline.map((r) => {
    const list = (segsByPage.get(r.page) || []).filter((s) => s.SpeakerId === teacherSpeaker);
    const content = teacherParagraphs(list).map(tidyPunct).join('\n\n');
    const dur = r.start == null ? '' : Math.round((r.end - r.start) / 1000);
    const conf = { high: '高', manual: '人工', preclass: '课前', uncovered: '未讲' }[r.confidence] || (r.anchor ? '中' : '低');
    return [
      r.page,
      r.title,
      r.start == null ? '' : fmt(r.start),
      r.end == null ? '' : fmt(r.end),
      dur,
      conf,
      r.phrase || '',
      content,
    ].map(csvField).join(',');
  });
  // 前置 UTF-8 BOM，Excel 打开中文不乱码。
  return '\uFEFF' + [header.join(','), ...rows].join('\r\n') + '\r\n';
}

const csvPath = DS('alignment.csv');
fs.writeFileSync(csvPath, renderCsv());
console.log(`✓ ${path.relative(ROOT, csvPath)}  （逐页逐字稿）`);

if (WRITE_BACK) {
  course.scenes.forEach((scene, i) => {
    const r = timeline[i];
    if (r.start == null) {
      delete scene.time;
      delete scene.durationHint;
      return;
    }
    scene.time = { start: fmt(r.start), end: fmt(r.end), startMs: r.start, endMs: r.end };
    scene.durationHint = Math.round((r.end - r.start) / 1000);
  });
  fs.writeFileSync(DS('data.json'), JSON.stringify(course, null, 2) + '\n');
  console.log(`✓ 已写回 ${DATASET}/data.json（scenes[].time）`);
}
