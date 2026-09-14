/**
 * split-lines.mjs —— 按逐字稿把「保留区间」里的教师录音切成**细粒度多段**，并写回 pages.json 的 lines。
 *
 * 为什么需要它：双师模式下老师那一段本来是「一个场景一条长音轨」（如 p02 102s），
 * 页面上就只弹一个大气泡，跟"逐句对话"的观感差很远。逐字稿（`<DATASET>/transcripts.json`）
 * 里本来就有句子级的 `BeginTime/EndTime`，直接照它切，一段就是一句（或相邻几句合并），
 * 气泡自然变多、时间轴也准。
 *
 * 切法：
 *   1. 取落在一个 keep 区间内的 ASR 段，按「句子」合并成若干组（见 groupSegments）。
 *   2. 组与组之间的切点 = 上一段 `EndTime` 与下一段 `BeginTime` 的**中点**；
 *      首组起点 = keep 起点，末组终点 = keep 终点 → 相邻切片首尾相接、不丢不重。
 *   3. 每组 ffmpeg 切一个文件 `public/audio/<DATASET>/<name>-t<K>.m4a`（K 从 1 起，跨 keep 连续）。
 *   4. 助教 TTS 按 `assist` 声明的位置插进 lines（`after: k` = 插在第 k 个 keep 之后；`'end'` = 片尾）。
 *   5. 写回 pages.json：`title` + `lines`（逐句 text/audio/speaker），并**删掉**已失效的 `text` / `audio`
 *      （build-course 里给了 lines 就以 lines 为准，这两个字段是死数据）。
 *
 * 输入：<DATASET>/transcripts.json、<DATASET>/pages.json、SPECS（本文件，人工分镜）
 * 输出：public/audio/<DATASET>/<name>-t*.m4a、<DATASET>/pages.json
 *
 * 用法：
 *   DATASET=data4 node scripts/split-lines.mjs              # 全量
 *   DATASET=data4 node scripts/split-lines.mjs --only 0,6   # 只做指定场景下标
 *   DATASET=data4 node scripts/split-lines.mjs --dry        # 不切片、不写盘，只打印分组
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATASET, DS, ROOT, readJson, rel } from './lib/dataset.mjs';

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry');
const ONLY = (() => {
  const i = ARGS.indexOf('--only');
  if (i < 0) return null;
  return new Set(ARGS[i + 1].split(',').map((x) => Number(x.trim())));
})();

/* ---------------------------------------------------------------- 分组参数 */
/** 够长才允许在句末断开（避免出现「开心吗？」这种 1.5s 的碎气泡）。 */
const MIN_CHARS = 12;
/** 停顿超过这个秒数就断开（老师换气 / 换话题）。 */
const GAP_BREAK = 0.7;
/** 再长也不合并，硬断。 */
const MAX_CHARS = 55;
/** 切片首/尾各留的余量（秒），避免掐掉起收音的辅音。 */
const LEAD = 0.35;
const TAIL = 0.45;

/* --------------------------------------------------------------- ASR 修字 */
/** 同音误写修正（只改明确的；分镜表里仍保留 ASR 原文以便对照）。 */
const FIXES = [
  [/岛屿/g, '导语'],
  [/太阳门/g, '正阳门'],
  [/万变不离其跑/g, '万变不离其宗'],
  [/何小玲/g, '何晓琳'],
  [/五\s*w\s*e\s*h/gi, '5W1H'],
  [/五W\s*E\s*H/gi, '5W1H'],
];
const fix = (s) => FIXES.reduce((acc, [re, to]) => acc.replace(re, to), s);

/* ----------------------------------------------------------------- 分镜表 */
/**
 * 每个场景：`i` = pages.json 数组下标（= 场景序，0 基）；`page` = ITS 页码（1 基，仅打印用）。
 * `name` 同时是 `<DATASET>/keeps-<name>.json` 的名字 —— **保留区间只写在那里**，本表不重复。
 * `assist`：`after` = 插在第几个 keep 之后（0 基；`'end'` 等价于 keeps.length）。
 */
const REPLAY = 'data2/lecturer_064315_125810553_1789205700_10260_1789216300.mp4';

const SPECS = [
  {
    i: 0, page: 2, name: 'p02', title: '开课：作业讲评与期中预告',
    assist: [{ after: 0, text: '上节课作业讲评完毕，期中资料已随讲义寄出。接下来进入正题：新闻的标题与导语。', audio: '/audio/data4/p02-assist-1.mp3' }],
  },
  {
    i: 1, page: 3, name: 'p03', title: '复习：新闻标题与导语',
    assist: [{ after: 0, text: '本讲两个考点：标题题只看导语，抓「谁加干了什么」；补导语题先找主人公，再概括事件、补齐时间地点。', audio: '/audio/data4/p03-assist-1.mp3' }],
  },
  {
    i: 2, page: 7, name: 'p07a', title: '第 1 题 · 补标题（看导语）',
    assist: [{ after: 0, text: '第 1 题选 D。补标题永远先看导语，下面进入本题的导语分析。', audio: '/audio/data4/p07a-assist-1.mp3' }],
  },
  {
    i: 3, page: 6, name: 'p06', title: '补标题：只看导语',
    assist: [
      { after: 0, text: '选A的同学，多半只看到了「两场展览」，漏了它讲的是什么。', audio: '/audio/data4/p06-assist-1.mp3' },
      { after: 'end', text: '记住——补标题，只看导语；抓导语里「谁 + 做了什么」，别被正文细节带偏。', audio: '/audio/data4/p06-assist-2.mp3' },
    ],
  },
  {
    i: 4, page: 7, name: 'p07b', title: '第 1 题 · 错因分析（A/B 选项）',
    assist: [{ after: 0, text: '易错点：A 只说有两场展览，没讲它说的是什么；B 的历史全貌是无中生有，所以正确答案是 D。', audio: '/audio/data4/p07b-assist-1.mp3' }],
  },
  {
    i: 5, page: 8, name: 'p08', title: '第 2 题 · 抹去导语的标题题',
    assist: [{ after: 0, text: '第 2 题故意抹掉了第一段，也就抹掉了导语，恰恰说明：补标题的核心信息全在导语里。', audio: '/audio/data4/p08-assist-1.mp3' }],
  },
  {
    i: 6, page: 9, name: 'p09', title: '第 3 题 · 补标题实战（清华附中校庆）',
    assist: [
      { after: 0, text: '三处易错：漏掉动词、把原词换成「进行」、打乱语序。最稳的办法是，导语里能删的删，不能删的照抄原词。', audio: '/audio/data4/p09-assist-1.mp3' },
      { after: 'end', text: '小结：凡补标题题，只看导语。接下来是错得最多的题型，补导语。', audio: '/audio/data4/p09-assist-2.mp3' },
    ],
  },
  {
    i: 7, page: 10, name: 'p10', title: '补导语题 · 三步法（正阳门）',
    assist: [
      { after: 0, text: '补导语三步法：第一，找主人公；第二，用上位词概括事件，要能统称参观、观看、聆听那些事；第三，补齐时间地点。', audio: '/audio/data4/p10-assist-1.mp3' },
      { after: 'end', text: '三步法收尾：找谁、概括干了啥、补时间地点。题干已经给出的信息，不用重复。', audio: '/audio/data4/p10-assist-2.mp3' },
    ],
  },
  {
    i: 8, page: 11, name: 'p11', title: '补导语题 · 港澳例题（金牌选手代表团）',
    assist: [
      { after: 0, text: '关键第一步是找对主人公：不是香港或澳门，而是奥运金牌选手代表团。概括不出来，就分层、一段一段总结。', audio: '/audio/data4/p11-assist-1.mp3' },
      { after: 'end', text: '补导语题收官：找主人公、分层概括事件、补时间地点。导语可以写长一点，信息全、信息准就行。', audio: '/audio/data4/p11-assist-2.mp3' },
    ],
  },
  {
    i: 9, page: 12, name: 'p12', title: '作文：读书感悟类',
    assist: [{ after: 0, text: '新闻部分到此结束，进入作文专题：读书感悟类，也就是读后感。', audio: '/audio/data4/p12-assist-1.mp3' }],
  },
];

/* ------------------------------------------------------------------ ASR */
const segs = readJson('transcripts.json')
  .filter((s) => s.Text && s.Text.trim())
  .sort((a, b) => a.BeginTime - b.BeginTime)
  .map((s) => ({ b: s.BeginTime / 1000, e: s.EndTime / 1000, t: s.Text.trim() }));

/** 落在 [a,b) 内的 ASR 段（按中点判定，与切分边界同一套口径）。 */
const segsIn = (a, b) => segs.filter((s) => {
  const mid = (s.b + s.e) / 2;
  return mid >= a && mid < b;
});

/**
 * 把一串 ASR 段合并成「句子组」。
 * 断句：① 已够长 且 当前以句末标点收尾；② 与下一段停顿 ≥ GAP_BREAK；③ 已到 MAX_CHARS。
 */
function groupSegments(list) {
  const groups = [];
  let cur = [];
  let chars = 0;
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    chars = 0;
  };
  for (let i = 0; i < list.length; i++) {
    cur.push(list[i]);
    chars += list[i].t.length;
    const next = list[i + 1];
    const gap = next ? next.b - list[i].e : Infinity;
    const endsSentence = /[。！？…」』]$/.test(list[i].t);
    if (chars >= MAX_CHARS || !next || gap >= GAP_BREAK || (endsSentence && chars >= MIN_CHARS)) flush();
  }
  flush();
  return groups;
}

/**
 * 组 → { text, start, end }。
 * 切片**贴着人声**（首尾各留 LEAD/TAIL 秒余量），不按停顿中点铺满 —— 课堂里的大段空档
 * 多半是学生打字/老师等人，铺满会变成十几秒的哑音。相邻切片若因此重叠则各让一半。
 */
function layout(groups, [a, b]) {
  const tight = groups.map((g) => ({
    s: Math.max(a, g[0].b - LEAD),
    e: Math.min(b, g[g.length - 1].e + TAIL),
  }));
  for (let i = 0; i + 1 < tight.length; i++) {
    if (tight[i + 1].s < tight[i].e) {
      const mid = (tight[i].e + tight[i + 1].s) / 2;
      tight[i].e = mid;
      tight[i + 1].s = mid;
    }
  }
  return groups.map((g, gi) => ({
    text: fix(g.map((s) => s.t).join('')),
    start: tight[gi].s,
    end: tight[gi].e,
  }));
}

/* ---------------------------------------------------------------- 切片 */
function sliceAudio(src, start, end, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', start.toFixed(3), '-i', src, '-t', (end - start).toFixed(3),
    '-vn', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    destAbs,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
}

/* ------------------------------------------------------------------ 主流程 */
const replayAbs = path.join(ROOT, REPLAY);
if (!DRY && !fs.existsSync(replayAbs)) throw new Error(`找不到回放源：${rel(replayAbs)}`);

const pages = readJson('pages.json');
const audioDir = path.join(ROOT, 'public', 'audio', DATASET);
let totalSlices = 0;

for (const spec of SPECS) {
  if (ONLY && !ONLY.has(spec.i)) continue;
  const entry = pages[spec.i];
  if (!entry) throw new Error(`pages.json 下标 ${spec.i} 不存在`);

  // 保留区间 / 句内剔除 只在 keeps-<name>.json 里维护（那里还写着切掉了什么、为什么）。
  const cfg = readJson(`keeps-${spec.name}.json`);
  const keeps = (cfg.keeps || [])
    .map(([s, e]) => [Number(s), Number(e)])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
  if (!keeps.length) throw new Error(`keeps-${spec.name}.json 的 keeps 为空或非法`);
  // `cuts` = 保留区间里**要剔除的句子**（点名/玩笑/催作业/闲聊）。按 **ASR 段**判（不按合并后的组），
  // 这样一句话里只有「催作业」那半句也能剔掉、而「来复习一下新闻」那半句留下。
  // 带 `assist` 的 cut 会由助教在那个位置补一句过渡 —— 这正是「用助教过渡课堂」的落点。
  const cuts = (cfg.cuts || []).map((c) => ({
    range: c.range.map(Number),
    note: c.note || '',
    assist: c.assist || null,
  }));
  const cutOf = (t) => cuts.find((c) => t >= c.range[0] && t < c.range[1]);
  const mid = (s) => (s.b + s.e) / 2;

  /** 按时间排好的事件流（老师句 / 助教过渡句），最后统一落成 lines。 */
  const events = [];
  let k = 0;
  keeps.forEach((range, ki) => {
    const all = segsIn(range[0], range[1]);
    if (!all.length) throw new Error(`${spec.name} keep#${ki} [${range}] 内没有 ASR 段，检查区间`);
    // 被剔除的段把这一整个 keep 切成若干「连续段」（run）；每组只在一段内合并、切片也不越界。
    const runs = [];
    let cur = null;
    let pendingCut = null;
    for (const s of all) {
      const cut = cutOf(mid(s));
      if (cut) {
        console.log(`  ✂ [${s.b.toFixed(1)}–${s.e.toFixed(1)}]  ${s.t.slice(0, 40)}  ← ${cut.note}`);
        if (cur) { cur.hi = cut.range[0]; cur = null; }
        pendingCut = cut;
        continue;
      }
      if (!cur) {
        cur = { segs: [], lo: pendingCut ? pendingCut.range[1] : range[0], hi: range[1] };
        runs.push(cur);
        pendingCut = null;
      }
      cur.segs.push(s);
    }
    for (const run of runs) {
      for (const item of layout(groupSegments(run.segs), [run.lo, run.hi])) {
        k += 1;
        const file = `${spec.name}-t${k}.m4a`;
        const rel0 = `/audio/${DATASET}/${file}`;
        if (!DRY) sliceAudio(replayAbs, item.start, item.end, path.join(audioDir, file));
        events.push({ t: item.start, line: { text: item.text, audio: rel0, speaker: 'teacher' } });
        console.log(`  ${file}  [${item.start.toFixed(1)}–${item.end.toFixed(1)}]  ${(item.end - item.start).toFixed(1).padStart(5)}s  ${item.text.slice(0, 42)}`);
      }
    }
    // 场景级助教台词：after=k → 落在第 k 个 keep 之后；'end' → 片尾。
    for (const a of spec.assist.filter((x) => (x.after === 'end' ? ki === keeps.length - 1 : x.after === ki))) {
      events.push({ t: range[1], line: { text: a.text, audio: a.audio, speaker: 'assistant' } });
    }
  });
  // 剔除区间里的助教过渡句。
  for (const c of cuts) {
    if (c.assist) events.push({ t: c.range[0], line: { text: c.assist.text, audio: c.assist.audio, speaker: 'assistant' } });
  }
  events.sort((a, b) => a.t - b.t);
  const lines = events.map((e) => e.line);

  entry.title = spec.title;
  entry.lines = lines;
  // lines 生效后 text / audio 是死数据（build-course 与 usePlayback 都以 lines 为准）。
  delete entry.text;
  delete entry.audio;

  const t = lines.filter((l) => l.speaker === 'teacher').length;
  const a = lines.length - t;
  totalSlices += t;
  console.log(`✓ idx ${spec.i} (ITS p${spec.page}) ${spec.title}  老师 ${t} 段 + 助教 ${a} 条 = ${lines.length} 条\n`);
}

if (DRY) {
  console.log(`[dry] 共 ${totalSlices} 个教师切片（未切片、未写盘）`);
} else {
  fs.writeFileSync(DS('pages.json'), JSON.stringify(pages, null, 2) + '\n');
  console.log(`共 ${totalSlices} 个教师切片 → public/audio/${DATASET}/，已写回 ${DATASET}/pages.json`);
}
