/**
 * data2-build-pages.mjs — 把「翻页时间轴 + ITS 课件 geometry + 逐字稿」合成为 data2/pages.json。
 *
 * ⚠️ 产出是**数组**（按老师翻页顺序），不是「页码 → 数据」的对象：
 * 老师不按页码顺序讲、还会回翻，同一页可能出现多次。每项：
 *   { page, title, start, end, audio, text[], steps[], highlights[] }
 *     - page       : 1 基 ITS 页码（场景顺序 ≠ 页码；同页可重复出现）
 *     - start/end  : 回放秒转 hh:mm:ss（来自 pages.timeline.json 的 run）
 *     - audio      : /audio/data2/its-sNN.m4a（NN = 出现次序，同页两次 → 两个不同文件）
 *     - text[]     : 落在本页时间窗内的老师逐字稿，合并成段
 *     - steps[]    : 本页 aniArr 每个「下一步动画」的时间点（相对本页起点 mm:ss）
 *     - highlights[]: 每个 step 的光标位置 = 对应元素中心（相对课件画布 1365×768 的比例）
 *
 * 步骤时间对齐：把本页逐字稿拼成连续串，用动画元素的文字去串里找首次出现位置，
 * 按字符偏移占比映射到本页时间；找不到则在本页内均分兜底。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DS = (...p) => path.join(ROOT, 'data2', ...p);
const CANVAS_W = 1365;
const CANVAS_H = 768;

const timeline = JSON.parse(fs.readFileSync(DS('pages.timeline.json'), 'utf8'));
const its = JSON.parse(fs.readFileSync(DS('raw', 'its-content.json'), 'utf8'));
const pages = its.data.mainCode.pages;
const transcripts = JSON.parse(fs.readFileSync(DS('transcripts.json'), 'utf8'))
  .filter((s) => s.Text && s.Text.trim())
  .sort((a, b) => a.BeginTime - b.BeginTime);

/* ---------------------------------------------------------------- helpers */

const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const mmss = (s) => {
  s = Math.max(0, Math.round(s));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => stripTags(s).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
const posOffset = (str) => {
  const m = /(-?\d+(?:\.\d+)?)px/.exec(str || '');
  return m ? parseFloat(m[1]) : 0;
};
const styleNum = (style, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`).exec(style || '');
  return m ? parseFloat(m[1]) : null;
};
const itemText = (item) => {
  const c = item.content || '';
  const m = /<div[^>]*id="(?:text|shape)_[^"]*_content"[^>]*>([\s\S]*?)<\/div>/.exec(c);
  return stripTags(m ? m[1] : c);
};
const sizeOf = (item) => {
  const snap = (item.attr && item.attr.snap && item.attr.snap.attr) || {};
  let w = snap.width != null ? parseFloat(snap.width) : null;
  let h = snap.height != null ? parseFloat(snap.height) : null;
  if (w == null || Number.isNaN(w)) w = styleNum(item.style, 'width');
  if (h == null || Number.isNaN(h)) h = styleNum(item.style, 'height');
  if (w == null || !w) w = 200;
  if (h == null || !h) h = 40;
  return { w, h };
};

/** 展平 items（含 group 偏移），建「元素 id / svgId → 几何」索引；group 记其子树并集外框。 */
function indexElements(items, ox = 0, oy = 0, map = new Map()) {
  for (const it of items || []) {
    if (it.type === 'group' && Array.isArray(it.groupItem)) {
      const sub = new Map();
      indexElements(it.groupItem, ox + posOffset(it.posX), oy + posOffset(it.posY), sub);
      let box = null;
      for (const v of sub.values()) {
        if (!box) box = { l: v.left, t: v.top, r: v.left + v.w, b: v.top + v.h };
        else {
          box.l = Math.min(box.l, v.left); box.t = Math.min(box.t, v.top);
          box.r = Math.max(box.r, v.left + v.w); box.b = Math.max(box.b, v.top + v.h);
        }
      }
      for (const [k, v] of sub) if (!map.has(k)) map.set(k, v);
      if (box) {
        const rec = { item: it, left: box.l, top: box.t, w: box.r - box.l, h: box.b - box.t, text: '' };
        if (it.id) map.set(it.id, rec);
        if (it.attr && it.attr.svgId) map.set(it.attr.svgId, rec);
      }
      continue;
    }
    const left = ox + posOffset(it.posX);
    const top = oy + posOffset(it.posY);
    const { w, h } = sizeOf(it);
    const rec = { item: it, left, top, w, h, text: itemText(it) };
    if (it.id) map.set(it.id, rec);
    if (it.attr && it.attr.svgId) map.set(it.attr.svgId, rec);
  }
  return map;
}

/** aniArr 的 item 前缀（text_/pic_/shape_/group_…）与元素 id / svgId 可能不同名，按 hex 归一匹配。 */
const idVariants = (id) => {
  const s = String(id);
  const hex = s.replace(/^[a-zA-Z]+_/, '');
  return [s, `svg_${hex}`];
};

/* ---------------------------------------------------- 本页逐字稿 → 时间轴 */

/** 本页时间窗内的逐字稿片段。 */
function segmentsIn(t0, t1) {
  return transcripts.filter((s) => s.EndTime / 1000 > t0 && s.BeginTime / 1000 < t1);
}

/** 拼接本页文字 + 字符偏移→时间 的映射（用于 step 对齐）。 */
function buildPageText(segs) {
  let text = '';
  const marks = []; // {start, end, beginSec, endSec}
  for (const s of segs) {
    const n = norm(s.Text);
    if (!n) continue;
    marks.push({ start: text.length, end: text.length + n.length, beginSec: s.BeginTime / 1000, endSec: s.EndTime / 1000 });
    text += n;
  }
  return { text, marks };
}

/** 字符位置 → 时间（秒）。 */
function timeAt(pos, marks) {
  for (const m of marks) {
    if (pos >= m.start && pos < m.end) {
      const r = m.end > m.start ? (pos - m.start) / (m.end - m.start) : 0;
      return m.beginSec + r * Math.max(0, m.endSec - m.beginSec);
    }
  }
  return null;
}

/* --------------------------------------------------------------- 文本合并 */

/** 逐字稿片段 → 段落级 text[]（每段一条，给右侧「对话/笔记」用）。 */
function toParas(segs, dur) {
  const teacher = segs.filter((s) => s.SpeakerId === '1');
  const use = teacher.length ? teacher : segs;
  const total = use.reduce((n, s) => n + norm(s.Text).length, 0);
  const maxLines = Math.min(24, Math.max(2, Math.round(dur / 25)));
  const target = Math.max(50, Math.ceil(total / maxLines));
  const out = [];
  let buf = '';
  let lastEnd = null;
  for (const s of use) {
    const t = stripTags(s.Text);
    if (lastEnd != null && s.BeginTime / 1000 - lastEnd > 2.5 && buf) {
      out.push(buf);
      buf = '';
    }
    buf += (buf && !/[。！？；，]/.test(buf.slice(-1)) ? '' : '') + t;
    lastEnd = s.EndTime / 1000;
    if (buf.length >= target) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

/* ------------------------------------------------------------- 生成 pages */

const out = [];
const stats = { stepsPages: 0, totalSteps: 0 };

for (const entry of timeline) {
  const idx = entry.page - 1;
  const page = pages[idx];
  if (!page) continue;
  const t0 = entry.t0;
  const dur = entry.t1 - entry.t0;

  const segs = segmentsIn(t0, entry.t1);
  const { text: pageText, marks } = buildPageText(segs);
  const elMap = indexElements(page.items);
  const aniArr = page.aniArr || [];

  // steps + highlights：按 aniArr 顺序**向前贪心**匹配（避免都命中开头同一句）
  const rawSteps = [];
  let searchFrom = 0;
  for (let i = 0; i < aniArr.length; i++) {
    const aniId = aniArr[i].item || aniArr[i].id || aniArr[i];
    let el = null;
    for (const v of idVariants(String(aniId))) {
      if (elMap.has(v)) { el = elMap.get(v); break; }
    }
    let at = null;
    if (el && el.text) {
      const kw = el.text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
      if (kw.length >= 2) {
        const pos = pageText.indexOf(kw, searchFrom);
        if (pos >= 0) {
          at = timeAt(pos, marks);
          searchFrom = pos + Math.max(1, Math.floor(kw.length / 2));
        }
      }
    }
    rawSteps.push({ el, at, i });
  }
  // 对齐质量判定：锚点要够多、且铺得够开，否则整页退回「均分」
  const n = rawSteps.length;
  const anchorIdx = rawSteps.filter((s) => s.at != null).map((s) => s.i);
  const ats = anchorIdx.map((j) => rawSteps[j].at);
  const spread = ats.length ? (Math.max(...ats) - Math.min(...ats)) / dur : 0;
  const goodAlign = anchorIdx.length >= Math.ceil(n * 0.5) && spread >= 0.4;

  const steps = [];
  for (const s of rawSteps) {
    let at;
    if (goodAlign) {
      at = s.at;
      if (at == null) {
        const before = [...anchorIdx].filter((j) => j < s.i).pop();
        const after = anchorIdx.find((j) => j > s.i);
        const at0 = before != null ? rawSteps[before].at : t0;
        const at1 = after != null ? rawSteps[after].at : t0 + dur;
        const j0 = before != null ? before : -1;
        const j1 = after != null ? after : n;
        at = at0 + ((at1 - at0) * (s.i - j0)) / (j1 - j0);
      }
    } else {
      at = t0 + (dur * (s.i + 1)) / (n + 1);
    }
    steps.push(at - t0);
  }
  // 单调递增 + 落在页内
  let prev = -1;
  const stepsSec = steps.map((v) => {
    let x = Math.min(Math.max(v, 0), dur - 1);
    if (x <= prev) x = prev + 0.5;
    prev = x;
    return x;
  });

  const highlights = rawSteps
    .map((s, i) => {
      if (!s.el) return null;
      const x = (s.el.left + s.el.w / 2) / CANVAS_W;
      const y = (s.el.top + s.el.h / 2) / CANVAS_H;
      return { at: mmss(stepsSec[i]), x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
    })
    .filter(Boolean);

  // 音频按「出现次序」命名 —— 同一页被回翻两次就是两个不同文件、两段不同音频。
  const seq = out.length + 1;
  const audio = `/audio/data2/its-s${String(seq).padStart(2, '0')}.m4a`;
  const title = String(entry.title || '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const rec = {
    page: entry.page,
    title: title || undefined,
    start: fmt(t0),
    end: fmt(entry.t1),
    audio,
    text: toParas(segs, dur),
  };
  if (stepsSec.length) {
    rec.steps = stepsSec.map((v) => mmss(v));
    stats.stepsPages += 1;
    stats.totalSteps += stepsSec.length;
  }
  if (highlights.length) rec.highlights = highlights;

  out.push(rec);
}

fs.writeFileSync(DS('pages.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`✓ data2/pages.json  scenes=${out.length}  stepsPages=${stats.stepsPages}  steps=${stats.totalSteps}`);
console.log(`  scenes with text: ${out.filter((o) => o.text && o.text.length).length}`);
console.log(`  scenes with highlights: ${out.filter((o) => o.highlights).length}`);
const dup = {};
for (const o of out) dup[o.page] = (dup[o.page] || 0) + 1;
const repeated = Object.entries(dup).filter(([, n]) => n > 1);
console.log(`  重复出现的页（回翻）：${repeated.map(([p, n]) => `第${p}页×${n}`).join('  ') || '无'}`);
for (const label of ['2', '7', '53', '75']) {
  const o = out.find((e) => e.page === Number(label));
  if (!o) continue;
  console.log(`\n── 第${o.page}页  ${o.start}–${o.end}  steps=${(o.steps || []).length} hl=${(o.highlights || []).length}`);
  console.log('   text[0]:', (o.text[0] || '').slice(0, 60));
  if (o.steps) console.log('   steps:', o.steps.join(' '));
  if (o.highlights) console.log('   hl:', o.highlights.slice(0, 4).map((h) => `${h.at}@${h.x},${h.y}`).join('  '));
}
