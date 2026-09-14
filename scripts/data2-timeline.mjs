/**
 * data2-timeline.mjs — 从 data2/itsevent.json 的「翻页」事件推导每页在回放中的时间窗。
 *
 * 时间基准：回放 t=0 = 2026-09-12 17:35:00 +08:00（= mp4 起始 unix）
 *   relative_seconds = absolute_wall_clock - T0
 *
 * 输出的是**老师真实的翻页序列**（run 级，每个 run = 一次连续停留），不是「每页一个窗口」——
 * 老师并不按页码顺序讲（会跳页、会回翻同一个页），所以同一页可能出现在多个 run 里。
 * 每个 run 的结束时间 = 下一次翻到别页的时间。
 * 输出：data2/pages.timeline.json（数组，按时间序；中间产物，供人工核对）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DS = (...p) => path.join(ROOT, 'data2', ...p);

const T0 = new Date('2026-09-12T17:35:00+08:00').getTime();
const tsec = (s) => (new Date(s.replace(' ', 'T') + '+08:00').getTime() - T0) / 1000;
const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const ev = JSON.parse(fs.readFileSync(DS('itsevent.json'), 'utf8'));
const its = JSON.parse(fs.readFileSync(DS('raw', 'its-content.json'), 'utf8'));
const pages = its.data.mainCode.pages;

const flips = ev.filter((e) => e.eventName === '翻页');

// 回放总时长（以视频时长兜底）
let VIDEO_END = 10260;
try {
  const tr = JSON.parse(fs.readFileSync(DS('transcripts.json'), 'utf8')).filter((s) => s.Text && s.Text.trim()).sort((a, b) => a.BeginTime - b.BeginTime);
  const last = tr[tr.length - 1];
  if (last && last.EndTime) VIDEO_END = Math.min(VIDEO_END, last.EndTime / 1000);

  // 课堂真正讲到哪：找第一处 >10 分钟的逐字稿空档（data2 是 02:15 老师闭麦让学生写作文，
  // 之后 ~32 分钟静音，末尾 02:47 才回来讲收尾）。末页结束时间封顶到这里，避免切片全是静音。
  for (let i = 0; i < tr.length - 1; i++) {
    if ((tr[i + 1].BeginTime - tr[i].EndTime) / 1000 > 600) { VIDEO_END = Math.min(VIDEO_END, tr[i].EndTime / 1000); break; }
  }
} catch { /* ignore */ }

let seq = flips.map((f) => ({ p: Number(f.currentIndex), t: tsec(f.time) })).sort((a, b) => a.t - b.t);
// 丢掉重连伪影（中途冒出来的 idx0）与开播前那条 idx0
seq = seq.filter((e) => !(e.p === 0 && e.t > 60));
seq = seq.filter((e) => e.t >= -10);

// 连续同页合并成 run；run 的结束 = 下一次翻到别页的时间
const runs = [];
for (const e of seq) {
  const last = runs[runs.length - 1];
  if (last && last.p === e.p) last.t1 = e.t;
  else runs.push({ p: e.p, t0: e.t, t1: e.t });
}
for (let i = 0; i < runs.length; i++) runs[i].t1 = i + 1 < runs.length ? runs[i + 1].t0 : VIDEO_END;

// 输出 run 序列本身（不做「每页只留最长窗口」的收敛）→ 保住老师的翻页顺序与回翻。
const out = [];
for (const r of runs) {
  const dur = r.t1 - r.t0;
  if (dur < 1) continue; // 零长窗口切不出音频
  const p = pages[r.p];
  out.push({
    page: r.p + 1,
    t0: r.t0,
    t1: r.t1,
    dur,
    aniArr: p.aniArr ? p.aniArr.length : 0,
    title: p.title || '',
  });
}

fs.writeFileSync(DS('pages.timeline.json'), JSON.stringify(out, null, 2) + '\n');
console.log('seq  page  start     end       dur  aniArr  title');
out.forEach((o, i) => {
  console.log(String(i).padStart(3), String(o.page).padStart(4), ' ', fmt(o.t0), ' ', fmt(o.t1), ' ', String(Math.round(o.dur)).padStart(4), ' ', String(o.aniArr).padStart(5), '  ', o.title.slice(0, 34));
});
const usedPages = new Set(out.map((o) => o.page));
console.log(`\n场景数 ${out.length}  用到 ${usedPages.size} 页（同页可出现多次=老师回翻）  覆盖到 ${fmt(Math.max(...out.map((o) => o.t1)))}`);
const unused = [...Array(pages.length).keys()].map((i) => i + 1).filter((n) => !usedPages.has(n));
console.log(`未被讲到的 ${unused.length} 页（已过滤）：${unused.join(',')}`);
