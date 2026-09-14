/**
 * slice-audio.mjs — 按 <DATASET>/pages.json 的 start/end，把课堂回放切成「逐页音频」。
 *
 * 数据集目录默认 `data/`，用环境变量 `DATASET` 切换（见 scripts/lib/dataset.mjs）。
 *
 * 输入：
 *   <DATASET>/pages.json   对象形态 = 每页 { start, end }；数组形态 = 每次出现 { page, start, end }
 *                          （HH:MM:SS，人工对照回放标定）。见 build-course.mjs 的两种形态说明。
 *   <DATASET>/replay.mp4   课堂回放；缺省时可放在 <DATASET>/replay.url 用 --download 拉取
 * 输出：
 *   public/audio/<DATASET>/its-pNN.m4a   对象形态：每页一段 AAC 音频
 *   public/audio/<DATASET>/its-sNN.m4a   数组形态：按「出现次序」一段（同页回翻两次 = 两份音频）
 *
 * 音频按「数据集」分目录，避免不同数据集的同页号互相覆盖；
 * pages.json 里对应的 `audio` 字段应写成上面两种路径之一。
 *
 * 用法：
 *   DATASET=data2 node scripts/slice-audio.mjs             # 切 pages.json 里所有带 start/end 的项
 *   DATASET=data2 node scripts/slice-audio.mjs 9 10 11     # 只切指定项（对象=页码 / 数组=出现次序）
 *   DATASET=data2 node scripts/slice-audio.mjs --write     # 同时把 audio 路径写回 pages.json
 *   DATASET=data2 node scripts/slice-audio.mjs --download  # replay.mp4 缺失时按 replay.url 下载
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATASET, DS, ROOT, readJson, rel } from './lib/dataset.mjs';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const DOWNLOAD = args.includes('--download');
const onlyPages = args.filter((a) => /^\d+$/.test(a)).map(Number);
const onlySet = new Set(onlyPages);

/* ----------------------------------------------------------- 回放源解析 */

const replayMp4 = DS('replay.mp4');

/** 回放源：优先 <DATASET>/replay.mp4；否则该目录下唯一的 *.mp4（容忍原始长文件名）。 */
function findLocalReplay() {
  if (fs.existsSync(replayMp4)) return replayMp4;
  const mp4s = fs.readdirSync(DS()).filter((f) => f.toLowerCase().endsWith('.mp4'));
  return mp4s.length === 1 ? DS(mp4s[0]) : null;
}

let replay = findLocalReplay();

if (!replay) {
  const urlPath = DS('replay.url');
  const url = fs.existsSync(urlPath) ? fs.readFileSync(urlPath, 'utf8').trim() : '';
  if (!url) {
    console.error(`\n✗ 找不到回放：${rel(replayMp4)} 不存在，目录下也没有唯一的 mp4，且无 ${rel(urlPath)}`);
    console.error(`  把回放 mp4 放到 ${rel(DS())}/（建议命名 replay.mp4），或在 ${rel(urlPath)} 写一行下载地址。\n`);
    process.exit(1);
  }
  if (!DOWNLOAD) {
    console.error(`\n✗ 回放尚未下载：${rel(replayMp4)}`);
    console.error(`  重新运行并加 --download，或手动执行：`);
    console.error(`    curl -L --fail -o '${replayMp4}' '${url}'\n`);
    process.exit(1);
  }
  console.log(`↓ 下载回放 ${url}\n  → ${rel(replayMp4)}`);
  execFileSync('curl', ['-L', '--fail', '-o', replayMp4, url], { stdio: 'inherit' });
  replay = replayMp4;
  console.log('');
}

console.log(`回放 ${rel(replay)}`);

/* ------------------------------------------------------------- pages */

const pages = readJson('pages.json');

/** "HH:MM:SS" / "MM:SS" → 秒（支持小数秒）。 */
function toSec(t) {
  const parts = String(t || '').trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * pages.json 两种形态（见 build-course.mjs 注释）都要支持：
 *   对象 → key = 1 基页码，音频 its-pNN.m4a
 *   数组 → 下标 = 出现次序（同一页回翻两次 → 两份音频），音频 its-sNN.m4a
 * key 用于 `--write` 回填与命令行「只切某几项」的过滤。
 */
const items = Array.isArray(pages)
  ? pages.map((entry, i) => ({
      key: i + 1,
      page: Number(entry?.page) || null,
      entry,
      outPath: `/audio/${DATASET}/its-s${String(i + 1).padStart(2, '0')}.m4a`,
    }))
  : Object.entries(pages).map(([k, entry]) => ({
      key: Number(k),
      page: Number(k),
      entry,
      outPath: `/audio/${DATASET}/its-p${String(k).padStart(2, '0')}.m4a`,
    }));

const targets = [];
for (const it of items) {
  if (!Number.isInteger(it.key) || it.key < 1) continue;
  if (onlySet.size && !onlySet.has(it.key)) continue;
  const label = it.page ? `第 ${it.page} 页${Array.isArray(pages) ? `（第 ${it.key} 次）` : ''}` : `第 ${it.key} 项`;
  const start = toSec(it.entry?.start);
  const end = toSec(it.entry?.end);
  if (start == null || end == null) {
    console.warn(`  ! ${label} 缺 start/end，跳过`);
    continue;
  }
  if (end <= start) {
    console.warn(`  ! ${label} end(${it.entry.end}) 不晚于 start(${it.entry.start})，跳过`);
    continue;
  }
  targets.push({ ...it, label, start, end, dur: end - start });
}

if (!targets.length) {
  console.warn(`\n! ${DATASET}/pages.json 里没有可切的页（需要 start + end）\n`);
  process.exit(0);
}

/* --------------------------------------------------------------- 切片 */

const outDirAbs = path.join(ROOT, 'public', 'audio', DATASET);
fs.mkdirSync(outDirAbs, { recursive: true });

console.log(`\n切片  ${DATASET}/pages.json → public/audio/${DATASET}/  共 ${targets.length} 页\n`);
console.log('页\t区间\t\t\t时长\t输出');
console.log('─'.repeat(78));

for (const t of targets) {
  const outRel = t.outPath;
  const outAbs = path.join(ROOT, 'public', outRel.replace(/^\//, ''));
  // -ss 放在 -i 之前 = 输入侧定位（关键帧跳转，快且对 mp4 精确到帧）；
  // -vn 只留音频；-movflags +faststart 让 <audio> 能边下边播。
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(t.start),
      '-i', replay,
      '-t', String(t.dur),
      '-vn', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      outAbs,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const size = fs.statSync(outAbs).size;
  console.log(
    `${t.label.padStart(14)}\t${t.entry.start}–${t.entry.end}\t${String(t.dur).padStart(4)}s\t${rel(outAbs)}  (${(size / 1024).toFixed(0)} KB)`,
  );
}

/* --------------------------------------------- 把 audio 路径写回 pages.json */

if (WRITE) {
  let changed = 0;
  for (const t of targets) {
    if (t.entry.audio !== t.outPath) {
      t.entry.audio = t.outPath;
      changed += 1;
    }
  }
  fs.writeFileSync(DS('pages.json'), JSON.stringify(pages, null, 2) + '\n');
  console.log(`\n✓ 已写回 ${DATASET}/pages.json（audio 更新 ${changed} 处）`);
}

console.log(`\n✓ 音频切片完成  public/audio/${DATASET}/  pages=${targets.length}\n`);
