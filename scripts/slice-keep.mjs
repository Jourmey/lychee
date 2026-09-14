/**
 * slice-keep.mjs — 按「保留区间」从课堂回放切出「只留主讲老师」的音频（双师模式用）。
 *
 * 与 slice-audio.mjs 的区别：那里是每页一段 start/end；这里支持**多段保留区间**，
 * 中间丢弃的正是学生说话的槽位（由助教 TTS 补位，见 <DATASET>/turns-pNN.md）。
 *
 * 两种输出模式：
 *   concat（默认） 多段 atrim + asetpts → concat 拼成一条，`cfg.out`
 *   split          每段各自一个文件 `<name>-ta.m4a` / `-tb.m4a` / …，
 *                  供页面按「老师A → 助教 → 老师B → 助教」逐句交错播放
 *
 * 输入：<DATASET>/keeps-<name>.json
 *   {
 *     page, title,
 *     replay?,   // 回放 mp4 路径（相对**仓库根**）；缺省用 <DATASET>/replay.mp4 或目录下唯一 mp4
 *     split?,    // true = 每段单独出文件；false/缺省 = 拼一条
 *     out?,      // concat 模式的输出名（默认 <name>-teacher.m4a）
 *     drops?: [{ range:[s,e], note }],   // 仅用于打印，说明切掉了什么
 *     keeps: [[s,e], ...]                // 单位=秒，支持小数
 *   }
 * 输出：public/audio/<DATASET>/…
 *
 * 用法：
 *   DATASET=data4 node scripts/slice-keep.mjs p06
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATASET, DS, ROOT, readJson, rel } from './lib/dataset.mjs';

const NAME = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!NAME) {
  console.error('\n用法：DATASET=<数据集> node scripts/slice-keep.mjs <name>   （读 <DATASET>/keeps-<name>.json）\n');
  process.exit(1);
}

/* --------------------------------------------------------------- keeps */
const cfgPath = DS(`keeps-${NAME}.json`);
if (!fs.existsSync(cfgPath)) {
  console.error(`\n✗ 找不到保留清单：${rel(cfgPath)}\n`);
  process.exit(1);
}
const cfg = readJson(`keeps-${NAME}.json`);
const keeps = (cfg.keeps || [])
  .map(([s, e]) => [Number(s), Number(e)])
  .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
if (!keeps.length) {
  console.error(`\n✗ ${rel(cfgPath)} 的 keeps 为空或非法（需 [[起,止], ...]，单位秒）\n`);
  process.exit(1);
}

/* ----------------------------------------------------------- 回放源解析 */
// cfg.replay（相对仓库根）> <DATASET>/replay.mp4 > 该目录下唯一的 *.mp4。
function resolveReplay() {
  if (cfg.replay) {
    const abs = path.isAbsolute(cfg.replay) ? cfg.replay : path.join(ROOT, cfg.replay);
    return fs.existsSync(abs) ? abs : null;
  }
  const local = DS('replay.mp4');
  if (fs.existsSync(local)) return local;
  const mp4s = fs.readdirSync(DS()).filter((f) => f.toLowerCase().endsWith('.mp4'));
  return mp4s.length === 1 ? DS(mp4s[0]) : null;
}
const replay = resolveReplay();
if (!replay) {
  console.error(`\n✗ 找不到回放 mp4：${cfg.replay ? rel(path.join(ROOT, cfg.replay)) : rel(DS()) + '/'}\n`);
  process.exit(1);
}

const outDir = path.join(ROOT, 'public', 'audio', DATASET);
fs.mkdirSync(outDir, { recursive: true });

console.log(`\n回放 ${rel(replay)}`);
console.log(`第 ${cfg.page} 页 · ${cfg.title || ''}  →  public/audio/${DATASET}/`);
for (const [s, e] of keeps) console.log(`  ✓ 保留 ${s.toFixed(2)}–${e.toFixed(2)}  (${(e - s).toFixed(2)}s)`);
for (const d of cfg.drops || []) {
  const [a, b] = d.range || [];
  console.log(`  ✗ 丢弃 ${Number(a).toFixed(2)}–${Number(b).toFixed(2)}  ${d.note ? `— ${d.note}` : ''}`);
}

/** 单段切片：-ss 置于 -i 前（输入侧定位，对本页单段足够准），重编码为 AAC。 */
function cutTo(outAbs, start, dur) {
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y',
     '-ss', String(start), '-i', replay, '-t', String(dur),
     '-vn', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outAbs],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

const durOf = (f) => {
  try {
    return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', f]).toString().trim());
  } catch { return NaN; }
};

const written = [];

if (cfg.split) {
  // 每段一个文件：-ta / -tb / -tc …
  keeps.forEach(([s, e], i) => {
    const letter = String.fromCharCode(97 + i); // a, b, c…
    const outAbs = path.join(outDir, `${NAME}-t${letter}.m4a`);
    cutTo(outAbs, s, e - s);
    written.push(outAbs);
  });
} else {
  // 多段拼一条：atrim 截取 → asetpts 归零 → concat。
  // 不能用 -ss + -c copy 拼多段：会在拼接点累积漂移。
  const parts = keeps.map(([s, e], i) => `[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
  const ins = keeps.map((_, i) => `[a${i}]`).join('');
  const filter = `${parts.join(';')};${ins}concat=n=${keeps.length}:v=0:a=1[out]`;
  const outAbs = path.join(outDir, cfg.out || `${NAME}-teacher.m4a`);
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y',
     '-i', replay, '-filter_complex', filter, '-map', '[out]',
     '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outAbs],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  written.push(outAbs);
}

let total = 0;
for (const f of written) {
  const d = durOf(f);
  total += Number.isFinite(d) ? d : 0;
  console.log(`  → ${rel(f)}  (${(fs.statSync(f).size / 1024).toFixed(0)} KB${Number.isFinite(d) ? `, ${d.toFixed(2)}s` : ''})`);
}
console.log(`\n✓ 完成 ${written.length} 个文件，合计 ${total.toFixed(2)}s\n`);
