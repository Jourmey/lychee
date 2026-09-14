/**
 * tts-pages.mjs — 按 <DATASET>/pages.json 的「逐句」结构批量合成 TTS 音频。
 *
 * 与 slice-audio.mjs 的关系：那支切的是**真实课堂回放**，这支合成的是 **TTS 配音**。
 * 二者产物都落在 public/audio/<DATASET>/，但用途不同（data3 只用 TTS 版）。
 *
 * 输入：<DATASET>/pages.json —— 数组形态，每项 `{ page, title, lines: [{ text, audio }] }`。
 *   - `audio` 给了就按它输出（相对仓库根的 web 路径，如 /audio/data3/s01-l01.mp3）；
 *     没给就按 `s<场景序号>-l<句序号>` 自动生成并**写回** pages.json。
 * 输出：public/audio/<DATASET>/*.mp3
 *
 * 用法：
 *   DATASET=data3 node scripts/tts-pages.mjs                 # 只补缺失的（已有的跳过）
 *   DATASET=data3 node scripts/tts-pages.mjs --force         # 全部重生成
 *   DATASET=data3 node scripts/tts-pages.mjs --scenes 1,2,3  # 只做指定场景（1 基，按数组下标）
 *   DATASET=data3 node scripts/tts-pages.mjs --dry           # 只打印将要做什么
 *   DATASET=data3 TTS_VOICE=minimax:tal-... node scripts/tts-pages.mjs
 *
 * 音色：默认取 dataset.config.json 的 `tts.voice`，其次 TTS_VOICE 环境变量，
 *       最后落到 tts.mjs 的默认音色。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATASET, DS, ROOT, readJson } from './lib/dataset.mjs';
import { ttsToFile } from './tts.mjs';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry');
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const onlyScenes = new Set(
  (argVal('--scenes') || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0),
);

/* ------------------------------------------------------------- 读配置 */

let config = {};
try {
  config = readJson('dataset.config.json');
} catch {
  /* 没有也能跑，音色退回环境变量/默认 */
}
const VOICE = config.tts?.voice || process.env.TTS_VOICE || null;

const pages = readJson('pages.json');
if (!Array.isArray(pages)) {
  console.error(`\n✗ ${DATASET}/pages.json 不是数组形态（逐句结构只支持数组）\n`);
  process.exit(1);
}

/* --------------------------------------------------------- 收集任务 */

const jobs = [];
let dirty = false;

pages.forEach((scene, si) => {
  const sceneNo = si + 1;
  if (onlyScenes.size && !onlyScenes.has(sceneNo)) return;
  const lines = Array.isArray(scene.lines) ? scene.lines : [];
  if (!lines.length) {
    console.warn(`  ! 第 ${sceneNo} 个场景（page ${scene.page}）没有 lines，跳过`);
    return;
  }
  lines.forEach((line, li) => {
    const text = String(line?.text ?? '').trim();
    if (!text) {
      console.warn(`  ! 场景 ${sceneNo} 第 ${li + 1} 句为空，跳过`);
      return;
    }
    let webPath = line.audio;
    if (!webPath) {
      webPath = `/audio/${DATASET}/s${String(sceneNo).padStart(2, '0')}-l${String(li + 1).padStart(2, '0')}.mp3`;
      line.audio = webPath;
      dirty = true;
    }
    if (!webPath.startsWith('/')) {
      console.error(`  ! 场景 ${sceneNo} 第 ${li + 1} 句 audio 必须是 / 开头的 web 路径：${webPath}`);
      process.exit(1);
    }
    jobs.push({
      label: `场景 ${sceneNo} 第 ${li + 1} 句`,
      text,
      out: path.join(ROOT, 'public', webPath.replace(/^\//, '')),
      webPath,
    });
  });
});

if (!jobs.length) {
  console.warn(`\n! ${DATASET}/pages.json 里没有可合成的句子\n`);
  process.exit(0);
}

const todo = FORCE ? jobs : jobs.filter((j) => !fs.existsSync(j.out));
const done = jobs.length - todo.length;

console.log(`\nTTS  ${DATASET}/pages.json → public/audio/${DATASET}/`);
console.log(`     音色 ${VOICE || '(tts.mjs 默认)'}   句子 ${jobs.length}   已有 ${done}   待合成 ${todo.length}\n`);

if (DRY) {
  for (const j of todo) console.log(`  [dry] ${j.label} → ${j.webPath}`);
  if (dirty) console.log('\n（--dry 也会把缺失的 audio 路径写回 pages.json，这里不写）');
  console.log('');
  process.exit(0);
}

if (dirty) {
  fs.writeFileSync(DS('pages.json'), JSON.stringify(pages, null, 2) + '\n');
  console.log(`✓ 已回填缺失的 audio 路径到 ${DATASET}/pages.json\n`);
}

/* --------------------------------------------------------------- 合成 */

const CONCURRENCY = 4;
let cursor = 0;
let ok = 0;
const failures = [];

async function worker() {
  while (cursor < todo.length) {
    const j = todo[cursor++];
    try {
      await ttsToFile(j.text, {
        voice: VOICE,
        out: j.out,
        log: () => {},
      });
      ok++;
      const size = (fs.statSync(j.out).size / 1024).toFixed(0);
      console.log(`  ✓ ${j.label.padEnd(16)} ${j.webPath}  (${size} KB)`);
    } catch (err) {
      failures.push({ j, err });
      console.log(`  ✗ ${j.label.padEnd(16)} ${j.webPath}  ${err.message}`);
    }
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

console.log(`\n✓ 合成 ${ok}/${todo.length}  用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures.length) {
  console.log(`✗ 失败 ${failures.length}：`);
  for (const f of failures) console.log(`  ${f.j.label}: ${f.j.err.message}`);
  process.exitCode = 1;
}
