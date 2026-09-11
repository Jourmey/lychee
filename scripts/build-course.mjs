/**
 * build-course.mjs — 把「ITS H5 课件 + 课堂逐字稿」合成为本 demo 的唯一数据源 data/data.json。
 *
 * 输入：
 *   data/raw/its-content.json   ITS 课件原始内容（91 页，源自内部课件 CDN 的 <id>.json）
 *   data/transcripts.json       课堂逐字稿（带时间戳 / 说话人）
 * 输出：
 *   data/data.json              Course 结构（见 src/types.ts）：course 元信息 + scenes[]
 *
 * 课件每一页 = 画布(1365x768) + 若干 item（txt/pic/shape/table/group…）。本脚本把
 * item 转成 OpenMAIC 的 Slide.elements（text / shape / image），坐标取自 item.posX/posY
 * （绝对定位，group 内为相对坐标，已叠加 group 偏移），尺寸取自 style 的 width/height。
 * 图片资源统一重写到 /courseware/imgs/ 下（已离线下载到 public/）。
 *
 * 重新生成：node scripts/build-course.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const its = read('data/raw/its-content.json');
const transcripts = read('data/transcripts.json');
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

/** 课件页标题：优先 page.title / note，否则第一个非空文本。 */
function pageTitle(page, index) {
  const t = stripTags(page.title) || stripTags(page.note);
  if (t) return t.slice(0, 24);
  for (const it of page.items || []) {
    if (it.type === 'txt' || it.type === 'shape') {
      const plain = stripTags(extractTextHtml(it.content)) || stripTags(it.content);
      if (plain && plain.length > 1) return plain.slice(0, 24);
    }
  }
  return `第 ${index + 1} 页`;
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

/* ------------------------------------------------------------------- build */

const narration = buildNarrationByScene(pages.length);

const scenes = pages.map((page, index) => ({
  id: `scene-${index + 1}`,
  type: 'slide',
  title: pageTitle(page, index),
  order: index,
  content: { type: 'slide', schemaVersion: 1, canvas: pageToSlide(page, index) },
  actions: narration[index].actions,
  dialogue: narration[index].dialogue,
}));

const course = {
  version: '0.2',
  course: {
    id: 'lychee-its-gu-wen',
    title: '庭前絮语解文言 · 古文阅读之山水小品进阶',
    subtitle: '快乐文言文 ·《记承天寺夜游》《答谢中书书》',
    teacher: { name: '何晓琳', avatar: '/avatars/teacher.svg' },
  },
  scenes,
};

const outPath = path.join(ROOT, 'data/data.json');
fs.writeFileSync(outPath, JSON.stringify(course, null, 2) + '\n');

const elCount = scenes.reduce((n, s) => n + s.content.canvas.elements.length, 0);
const actCount = scenes.reduce((n, s) => n + s.actions.length, 0);
console.log(`✓ data/data.json  scenes=${scenes.length}  elements=${elCount}  actions=${actCount}`);
console.log(`  size=${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`);
