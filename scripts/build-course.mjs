/**
 * build-course.mjs — 把「ITS H5 课件 + 课堂逐字稿」合成为本 demo 的唯一数据源 <DATASET>/data.json。
 *
 * 数据集目录默认 `data/`，用环境变量 `DATASET` 切换（见 scripts/lib/dataset.mjs）。
 *
 * 输入：
 *   <DATASET>/raw/its-content.json   ITS 课件原始内容（源自内部课件 CDN 的 <id>.json）
 *   <DATASET>/transcripts.json       课堂逐字稿（带时间戳 / 说话人）
 *   <DATASET>/dataset.config.json    课程元信息 + ITS 嵌入配置（可选）
 *   <DATASET>/pages.json             逐页手工数据（可选）
 * 输出：
 *   <DATASET>/data.json              Course 结构（见 src/types.ts）：course 元信息 + scenes[]
 *
 * 课件每一页 = 画布(1365x768) + 若干 item（txt/pic/shape/table/group…）。本脚本把
 * item 转成 OpenMAIC 的 Slide.elements（text / shape / image），坐标取自 item.posX/posY
 * （绝对定位，group 内为相对坐标，已叠加 group 偏移），尺寸取自 style 的 width/height。
 * 图片资源统一重写到 /courseware/imgs/ 下（已离线下载到 public/）。
 *
 * 重新生成：DATASET=data node scripts/build-course.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATASET, DS, readJson, loadConfig } from './lib/dataset.mjs';

const config = loadConfig();

const its = readJson('raw/its-content.json');
const transcripts = readJson('transcripts.json');
const pages = its.data.mainCode.pages;

const CANVAS_W = 1365;
const CANVAS_H = 768;
const IMG_PREFIX = '/courseware/imgs/';

/* ---------------------------------------------------------------- helpers */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** style 里严格取某个属性（避免 max-width 被 width 误匹配）。 */
function styleNum(style, prop) {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`).exec(style || '');
  return m ? parseFloat(m[1]) : null;
}

/** item.posX / posY 形如 "left:125px;" / "top:279px;"。 */
function posOffset(str) {
  const m = /(-?\d+(?:\.\d+)?)px/.exec(str || '');
  return m ? parseFloat(m[1]) : 0;
}

function svgViewBox(content) {
  const m = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(content || '');
  return m ? { w: parseFloat(m[3]), h: parseFloat(m[4]) } : null;
}

/** 课件 HTML → 可用于本站的 HTML：修 svg 命名空间、重写图片路径、去掉脚本。 */
function cleanHtml(html) {
  return (html || '')
    .replace(/xmlns="https:\/\/www\.w3\.org\/2000\/svg"/g, 'xmlns="http://www.w3.org/2000/svg"')
    .replace(/resource\/imgs\//g, IMG_PREFIX)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\ssrc\s*=\s*"/g, ' src="');
}

/** 课件背景字段 "url(resource/imgs/x.png) ..." → /courseware/imgs/x.png */
function bgImageSrc(bg) {
  const m = /url\(\s*([^)]+?)\s*\)/.exec(bg || '');
  if (!m) return null;
  const file = m[1].split('/').pop();
  return file ? IMG_PREFIX + file : null;
}

/* ------------------------------------------------------- item → element */

/** 从 item.content 提取内层文本 div 的 HTML。 */
function extractTextHtml(content) {
  const m = /<div[^>]*id="(?:text|shape)_[^"]*_content"[^>]*>([\s\S]*?)<\/div>/.exec(content || '');
  return m ? m[1] : '';
}

/** 从 item.content 的 <rect> 提取背景填充色（透明则忽略）。 */
function extractRectFill(content) {
  const m = /<rect[^>]*\bfill="([^"]+)"/.exec(content || '');
  const fill = m ? m[1] : '';
  if (!fill || fill === 'none' || /rgba?\([^)]*,\s*0\s*\)/.test(fill)) return undefined;
  return fill;
}

function extractImgSrc(content) {
  const m = /<img[^>]*\bsrc\s*=\s*"?([^"\s>]+)"?/i.exec(content || '');
  if (!m) return null;
  const src = m[1];
  return src.replace(/^resource\/imgs\//, IMG_PREFIX);
}

/** 尺寸：优先 style 的 width/height，退回 svg viewBox。 */
function sizeOf(item) {
  const style = item.style || '';
  let w = styleNum(style, 'width');
  let h = styleNum(style, 'height');
  const vb = svgViewBox(item.content);
  if ((w == null || !w) && vb) w = vb.w;
  if ((h == null || !h) && vb) h = vb.h;
  if (w == null || !w) w = 200;
  if (h == null || !h) h = 40;
  return { w, h };
}

let idSeq = 0;
const nextId = (p) => `${p}-${(++idSeq).toString(36)}`;

/** 单个 item → OpenMAIC 元素（可能为 null 表示跳过）。children 递归 groupItem。 */
function itemToElement(item, offsetX, offsetY) {
  const left = offsetX + posOffset(item.posX);
  const top = offsetY + posOffset(item.posY);
  const attr = item.attr || {};
  const content = item.content || '';

  if (item.type === 'pic') {
    const src = extractImgSrc(content);
    if (!src) return null;
    const { w, h } = sizeOf(item);
    return { id: item.id || nextId('img'), type: 'image', left, top, width: w, height: h, rotate: 0, fixedRatio: false, src };
  }

  if (item.type === 'shape' || item.type === 'lineShape') {
    const dm = /<path[^>]*\bd="([^"]+)"/.exec(content);
    const fm = /<path[^>]*\bfill="([^"]+)"/.exec(content);
    if (dm) {
      const { w, h } = sizeOf(item);
      const textHtml = extractTextHtml(content).trim();
      const el = {
        id: item.id || nextId('sh'),
        type: 'shape',
        left,
        top,
        width: w,
        height: h,
        rotate: 0,
        viewBox: [w, h],
        path: dm[1],
        fixedRatio: false,
        fill: fm ? fm[1] : '#5b9bd5',
      };
      const plain = textHtml.replace(/<[^>]+>/g, '').trim();
      if (plain) {
        el.text = {
          content: cleanHtml(textHtml),
          defaultFontName: attr.fontname || 'Microsoft YaHei',
          defaultColor: attr.forecolor || '#333333',
          align: 'middle',
        };
      }
      return el;
    }
    // 无 path 的形状退回文本块
  }

  // 表格 → 直接保留整段 content(其内是 <table> HTML)
  if (item.type === 'table') {
    if (!stripTags(content)) return null;
    const { w, h } = sizeOf(item);
    return {
      id: item.id || nextId('tb'),
      type: 'text',
      left,
      top,
      width: w,
      height: h,
      rotate: 0,
      content: cleanHtml(content),
      defaultFontName: attr.fontname || 'Microsoft YaHei',
      defaultColor: attr.forecolor || '#333333',
      lineHeight: 1.5,
    };
  }

  // txt / 其它 → 文本块：取内层文本 HTML，背景矩形转成 fill；两者皆无则跳过
  const textHtml = extractTextHtml(content);
  const fill = extractRectFill(content);
  if (!stripTags(textHtml) && !fill) return null;
  const { w, h } = sizeOf(item);
  const el = {
    id: item.id || nextId('tx'),
    type: 'text',
    left,
    top,
    width: w,
    height: h,
    rotate: 0,
    content: cleanHtml(textHtml),
    defaultFontName: attr.fontname || 'Microsoft YaHei',
    defaultColor: attr.forecolor || '#333333',
    lineHeight: 1.5,
  };
  if (fill) el.fill = fill;
  return el;
}

/** 递归展开 group：children 的 posX/posY 相对 group，叠加 group 偏移。 */
function collectElements(items, offsetX = 0, offsetY = 0, seen = new Set(), out = []) {
  for (const item of items) {
    if (item.id && seen.has(item.id)) continue;
    if (item.id) seen.add(item.id);
    if (item.type === 'group' && Array.isArray(item.groupItem)) {
      const gx = offsetX + posOffset(item.posX);
      const gy = offsetY + posOffset(item.posY);
      collectElements(item.groupItem, gx, gy, seen, out);
      continue;
    }
    const el = itemToElement(item, offsetX, offsetY);
    if (el) out.push(el);
  }
  return out;
}

/* ------------------------------------------------------------- page → slide */

function pageToSlide(page, index) {
  const bg = bgImageSrc(page.main && page.main.background);
  const elements = collectElements(page.items || []);
  const slide = {
    id: `slide-${index + 1}`,
    viewportSize: CANVAS_W,
    viewportRatio: CANVAS_H / CANVAS_W,
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#722ed1', '#5b9bd5', '#f5a623', '#2e7d32'],
      fontColor: '#1f2430',
      fontName: 'Microsoft YaHei',
    },
    background: bg ? { type: 'image', image: { src: bg, size: 'cover' } } : { type: 'solid', color: '#ffffff' },
    elements,
  };
  return slide;
}

/* --------------------------------------------------------- transcript → actions */

const stripTags = (s) => (s || '').replace(/<[^>]+>/g, '').trim();

/** 标题清洗：实体空格与空白折叠（课件里标题常带 &nbsp;）。 */
const cleanTitle = (s) => String(s || '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** 课件页标题：优先 page.title / note，否则第一个非空文本。pageNo 为 1 基的真实 ITS 页码。 */
function pageTitle(page, pageNo) {
  const t = cleanTitle(stripTags(page.title)) || cleanTitle(stripTags(page.note));
  if (t) return t.slice(0, 24);
  for (const it of page.items || []) {
    if (it.type === 'txt' || it.type === 'shape') {
      const plain = cleanTitle(stripTags(extractTextHtml(it.content))) || cleanTitle(stripTags(it.content));
      if (plain && plain.length > 1) return plain.slice(0, 24);
    }
  }
  return `第 ${pageNo} 页`;
}

/** 按标点切句（保留标点），丢弃空片段。 */
const splitSentences = (text) =>
  (text || '')
    .split(/(?<=[。！？；!?])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

/** 逐字稿 → 每场景的 { actions, dialogue }。
 *  - actions：切句后的 speech 动作（驱动底部讲解气泡 / 笔记）。
 *  - dialogue：带说话人角色的课堂对话（驱动右侧「对话」Tab）。
 *  两条流都来自同一份逐字稿，保证同一页内「笔记」与「对话」内容一致。 */
function buildNarrationByScene(sceneCount) {
  const segs = [...transcripts]
    .filter((s) => s.Text && s.Text.trim())
    .sort((a, b) => a.BeginTime - b.BeginTime);

  // 合并同一说话人的连续片段
  const utterances = [];
  for (const s of segs) {
    const last = utterances[utterances.length - 1];
    if (last && last.speaker === s.SpeakerId) {
      last.text += s.Text.trim();
      last.end = s.EndTime;
    } else {
      utterances.push({ speaker: s.SpeakerId, text: s.Text.trim(), begin: s.BeginTime, end: s.EndTime });
    }
  }

  // 说话人角色：讲得最多的那位视为主讲老师，其余为学生。
  const charsBySpeaker = {};
  for (const u of utterances) charsBySpeaker[u.speaker] = (charsBySpeaker[u.speaker] || 0) + u.text.length;
  const teacherSpeaker = Object.entries(charsBySpeaker).sort((a, b) => b[1] - a[1])[0]?.[0];
  const roleOf = (speaker) => (speaker === teacherSpeaker ? 'teacher' : 'student');

  // 按比例铺满所有页（floor(i*N/M)），保证每一页都有内容、末尾页不落空。
  const byScene = Array.from({ length: sceneCount }, () => []);
  utterances.forEach((u, i) => {
    const scene = Math.min(sceneCount - 1, Math.floor((i * sceneCount) / utterances.length));
    byScene[scene].push(u);
  });

  return byScene.map((items, sceneIdx) => {
    // dialogue：每个说话片段切句成一条气泡，保留说话人角色。
    const dialogue = [];
    for (const u of items) {
      const role = roleOf(u.speaker);
      const parts = splitSentences(u.text);
      const turns = parts.length ? parts : u.text ? [u.text] : [];
      for (const t of turns) dialogue.push({ speaker: role, text: t.slice(0, 140) });
    }

    // actions：整页合并后切句，最多 6 条。
    const joined = items.map((u) => u.text).join('');
    const sentences = splitSentences(joined).slice(0, 6);
    const actions = sentences.map((text, j) => ({
      type: 'speech',
      id: `s${sceneIdx + 1}-${j + 1}`,
      text,
    }));
    if (actions.length === 0) {
      actions.push({ type: 'speech', id: `s${sceneIdx + 1}-1`, text: joined.slice(0, 80) || '……' });
    }

    return { actions, dialogue: dialogue.slice(0, 20) };
  });
}

/* -------------------------------------------- pages.json → 场景（含顺序） */

/**
 * <DATASET>/pages.json 是手工维护的逐页数据（进 git），支持两种形态：
 *
 * ① 对象（传统，页码↔场景一一对应）：key = 1 基 ITS 页码，场景按页码升序。
 *    每页可给 { title, start, end, audio, text, steps, highlights }。
 *
 * ② 数组（按老师真实翻页顺序）：下标 = 场景顺序，每项多一个 `page` = 1 基 ITS 页码。
 *    老师会跳页、会回翻，所以**同一页可以出现多次**（各带自己的时间窗/音频/讲解）。
 *    场景通过 scene.itsPage 记录真实页码 —— iframe 翻页指令用的是它，不是场景序号。
 *
 *   - title      → scene.title
 *   - audio      → scene.audio（usePlayback 切页时播放）
 *   - text       → string[]，每条 = 一条对话/一条讲解；逐条生成 actions 与 dialogue
 *   - steps      → string[]，本页「下一步动画」的时间点（相对本页起点 mm:ss / hh:mm:ss），
 *                  build 时换算成 scene.steps: number[]（秒）
 *   - highlights → [{at,x,y}]，鼠标光标轨迹。at 同上；x/y 是相对**课件画布**(1365×768)
 *                  的比例 0~1（ITS 是 iframe，内部元素无法寻址，只能给比例）。
 *                  光标常驻不消失：到点移过去，停在原地直到下一点
 *   - start/end  → scene.time（视频切片区间，秒为单位另给 startMs/endMs）
 *
 * 生成物 data.json 会被每次重建覆盖，所以手工内容必须留在 <DATASET>/pages.json。
 */
const pagesPath = DS('pages.json');
const overrides = fs.existsSync(pagesPath) ? readJson('pages.json') : {};

const allSpecs = (Array.isArray(overrides)
  ? overrides.map((o, i) => ({ pageNo: Number(o?.page) || i + 1, o: o || {} }))
  : pages.map((_, i) => ({ pageNo: i + 1, o: overrides[String(i + 1)] || {} }))
).filter((s) => {
  if (pages[s.pageNo - 1]) return true;
  console.warn(`  ! ${DATASET}/pages.json: 第 ${s.pageNo} 页不存在，已跳过`);
  return false;
});

/**
 * `sceneLimit`（dataset.config.json，可选，正整数）：只保留前 N 个场景。
 * 用于「屏蔽」还没做完/暂时不看的页 —— 数据（pages.json 的手工内容、切片）原样留着，删掉该字段即恢复。
 */
const sceneLimit = Number(config.sceneLimit);
const sceneSpecs = sceneLimit > 0 ? allSpecs.slice(0, sceneLimit) : allSpecs;
if (sceneLimit > 0 && allSpecs.length > sceneLimit) {
  console.log(`  · sceneLimit=${sceneLimit}：保留前 ${sceneLimit} 个场景，屏蔽 ${allSpecs.length - sceneLimit} 个`);
}

const toMs = (t) => {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(t || ''));
  return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 : null;
};
/** "mm:ss" 或 "hh:mm:ss" → 秒（支持小数秒）。 */
const toSec = (t) => {
  const parts = String(t || '').trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

// 无手工 text 的场景才用这份按比例平摊的兜底讲解，故按「场景数」铺，而不是按 ITS 页数。
const narration = buildNarrationByScene(sceneSpecs.length);

let overrideCount = 0;
const scenes = sceneSpecs.map((spec, index) => {
  const { pageNo, o } = spec;
  const page = pages[pageNo - 1];
  const scene = {
    id: `scene-${index + 1}`,
    type: 'slide',
    title: pageTitle(page, pageNo),
    order: index,
    /** ITS 播放器里的真实页码（0 基）。场景顺序 ≠ 页码：按老师翻页顺序排列，同页可重复。 */
    itsPage: pageNo - 1,
    content: { type: 'slide', schemaVersion: 1, canvas: pageToSlide(page, pageNo - 1) },
    actions: narration[index].actions,
    dialogue: narration[index].dialogue,
  };
  if (o.title) scene.title = cleanTitle(o.title);
  if (o.audio) scene.audio = o.audio;
  // 逐句配音（TTS / 双师版）：text 与 audio 一一对应。给了 lines 就以它为准，
  // actions/dialogue 也按同一顺序生成，这样讲解气泡与笔记/对话 Tab 零改动即可工作。
  // `speaker`（角色 id，缺省 teacher）走字段：双师模式下同一页老师(真实录音)/助教(TTS)交错。
  if (Array.isArray(o.lines)) {
    const lines = o.lines
      .map((l) => ({
        text: String(l?.text ?? '').trim(),
        audio: String(l?.audio ?? '').trim(),
        speaker: String(l?.speaker ?? 'teacher').trim() || 'teacher',
      }))
      .filter((l) => l.text && l.audio);
    if (lines.length !== o.lines.length) {
      console.warn(`  ! 第 ${pageNo} 页有 ${o.lines.length - lines.length} 句缺 text/audio，已跳过`);
    }
    scene.lines = lines;
    scene.actions = lines.map((l, j) => ({ type: 'speech', id: `s${index + 1}-l${j + 1}`, text: l.text }));
    scene.dialogue = lines.map((l) => ({ speaker: l.speaker, text: l.text }));
  } else if (Array.isArray(o.text)) {
    const lines = o.text.filter((t) => typeof t === 'string' && t.trim());
    scene.actions = lines.map((text, j) => ({ type: 'speech', id: `s${index + 1}-${j + 1}`, text }));
    scene.dialogue = lines.map((text) => ({ speaker: 'teacher', text }));
  }
  const startMs = toMs(o.start);
  const endMs = toMs(o.end);
  if (startMs != null || endMs != null) {
    scene.time = { start: o.start ?? null, end: o.end ?? null, startMs, endMs };
  }
  if (Array.isArray(o.steps)) {
    // 本页「下一步动画」触发点（相对本页起点，秒），必须递增。
    const steps = o.steps.map(toSec).filter((n) => n != null).sort((a, b) => a - b);
    if (steps.length > 0) scene.steps = steps;
  }
  if (Array.isArray(o.highlights)) {
    // 鼠标光标轨迹：at 相对本页起点（秒）；x/y 为**课件画布**(1365×768)比例 0~1。
    // 光标常驻：到点移过去，之后停在原地直到下一点（没有 hold，不消失）。
    const highlights = o.highlights
      .map((h) => ({ at: toSec(h.at), x: Number(h.x), y: Number(h.y) }))
      .filter((h) => h.at != null && Number.isFinite(h.x) && Number.isFinite(h.y))
      .sort((a, b) => a.at - b.at);
    if (highlights.length > 0) scene.highlights = highlights;
  }
  if (Object.keys(o).length) overrideCount += 1;
  return scene;
});
console.log(`✓ 手工逐页覆盖  ${DATASET}/pages.json  scenes=${overrideCount}${Array.isArray(overrides) ? '（数组形态：按翻页顺序）' : ''}`);

/* ------------------------------------------------------------------- build */

const course = {
  version: config.course?.version ?? '0.2',
  course: {
    id: config.course?.id ?? DATASET,
    title: config.course?.title ?? DATASET,
    subtitle: config.course?.subtitle,
    teacher: config.course?.teacher,
  },
  /** demo 用 iframe 嵌 ITS 官方播放器所需的配置（来自 <DATASET>/dataset.config.json）。 */
  its: config.its,
  scenes,
};

const outPath = DS('data.json');
fs.writeFileSync(outPath, JSON.stringify(course, null, 2) + '\n');

const elCount = scenes.reduce((n, s) => n + s.content.canvas.elements.length, 0);
const actCount = scenes.reduce((n, s) => n + s.actions.length, 0);
console.log(`✓ ${DATASET}/data.json  scenes=${scenes.length}  elements=${elCount}  actions=${actCount}`);
console.log(`  size=${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`);
