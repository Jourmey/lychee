/**
 * tts.mjs — 文本转语音（MiniMax 神经语音引擎），把讲解/对话文本合成为音频文件。
 *
 * 协议移植自 ai-teacher 的 TTS 工具（internal/agent/mcps/tts/tts_tools.go 的
 * generateWithMiniMaxAPI）：
 *
 *   POST <TTS_URL>            Header: Content-Type: application/json, api-key: <key>
 *   {
 *     voice, text, text_type: "plain", format: "mp3", sample_rate: 16000,
 *     volume: 50, pitch_rate: 1, speech_rate: 1,
 *     extra: { language: "zh-CN", outputFormat: "audio-16khz-32kbitrate-mono-mp3" }
 *   }
 *   → { code: 200, message, data: { audio: <base64 mp3>, task_id, sample_rate } }
 *
 * 单次文本上限：工具描述里对外写 100 字，代码实际限 300 字（utf8.RuneCountInString > 300）。
 * 本脚本按 300 切分（--max-chars 可调）：优先在句读处断开，多段分别合成后用 ffmpeg
 * 无损拼接（同编码参数，`-c copy`）成一个文件。
 *
 * 用法：
 *   node scripts/tts.mjs --list                        # 列出所有音色
 *   node scripts/tts.mjs --text "你好，世界" --voice iUx34Uvfr8Z --out /tmp/a.mp3
 *   node scripts/tts.mjs --file note.txt --voice 49x2K9u75su --out /tmp/a.m4a
 *   node scripts/tts.mjs --json jobs.json              # 批量：[{ voice, text, out }]
 *
 * 参数：
 *   --text <str>        要合成的文本（也可用 --file <路径> 读文件）
 *   --voice <id>        音色；可给完整 id（minimax:tal-…）或后缀（iUx34Uvfr8Z）
 *   --out <path>        输出文件；以 .m4a 结尾会自动转成 AAC/m4a（默认 mp3）
 *   --json <path>       批量任务清单 [{ voice, text, out }]，逐条合成
 *   --concurrency <n>   批量并发数（默认 3）
 *   --max-chars <n>     单次合成最大字数（默认 300）
 *   --list              只打印音色表
 *   --probe             逐个试音色，打印哪些可用（接口按 api-key 授权）
 *   --dry               不请求接口，只打印将要生成的任务
 *
 * 注：默认 api-key 实测 19 个音色里 14 个可用，5 个返回 2042「无权限」
 * （小男孩儿-爱豆 / 皮皮 / 卡皮巴拉 / 小低兰朵 / 成熟青年女声），用 --probe 复验。
 *
 * 环境变量（默认值即 conf/dev 的配置）：
 *   TTS_URL      默认 https://speech-internal-test.tal.com/v1/tts（prod: https://speech-internal.tal.com/v1/tts）
 *   TTS_API_KEY  默认 1000000125:a66b0927f8cbaa446f463f5cb98f62e4
 *   TTS_VOICE    默认音色
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* ------------------------------------------------------------------ 音色 */

/**
 * MiniMax 音色（dev/test 环境）。id 带 `minimax:` 前缀，与接口入参一致。
 * （prod 走的是另一套 17 个 volcengine 音色，接口地址也不同，需要时用 TTS_URL 切。）
 */
export const VOICES = [
  { id: 'minimax:tal-20260126-enrL4vCFXXq', label: '小男孩儿音色-许多' },
  { id: 'minimax:tal-20260126-j0ZBtLFqKaw', label: '温柔男青年音色' },
  { id: 'minimax:tal-20260126-k5eUqU02WHt', label: '清亮男童音色' },
  { id: 'minimax:tal-20260126-fnH8g7vzy2E', label: '睿智老年男士音色-适合朗读古诗词' },
  { id: 'minimax:tal-20260126-1i3KRTHmmA9', label: '小男孩儿音色-爱豆' },
  { id: 'minimax:tal-20260126-2SafrNY2l0w', label: '可爱小女孩儿音色' },
  { id: 'minimax:tal-20260126-2Sewsvi6R7r', label: '皮皮音色，活泼可爱-适合儿童故事朗读' },
  { id: 'minimax:tal-20260126-6OuBq042Kjh', label: '睿智老年女生-适合朗读课文' },
  { id: 'minimax:tal-20260126-49x2K9u75su', label: '温柔女青年-适合朗读' },
  { id: 'minimax:tal-20260126-3WhDA3JtCJ7', label: '卡皮巴拉音色，治愈系萌宠-适合儿童故事朗读' },
  { id: 'minimax:tal-20260126-j80eaBg3qEO', label: '小低兰朵音色，甜美可爱-适合儿童故事朗读' },
  { id: 'minimax:tal-20260126-iUx34Uvfr8Z', label: '活泼女青年-适合教学音频' },
  { id: 'minimax:tal-20260126-4v6aVCRdcGk', label: '成熟青年女声-适合朗读' },
  { id: 'minimax:tal-20260129-4ph5VgQuIio', label: '英文-小男孩儿-爱豆' },
  { id: 'minimax:tal-20260129-5xhXR294PQB', label: '英文-小女孩儿音色-lily' },
  { id: 'minimax:tal-20260129-5zxChEjxiso', label: '英文-卡皮巴拉音色，治愈系萌宠' },
  { id: 'minimax:tal-20260129-jvScNM25aZ4', label: '英文-中年女声' },
  { id: 'minimax:tal-20260129-aKQ8JlPOhpp', label: '英文-小女孩儿-nancy' },
  { id: 'minimax:tal-20260129-3Q6Nm2P19Ly', label: '英文-中年男声' },
];

const DEFAULT_VOICE = process.env.TTS_VOICE || 'minimax:tal-20260126-iUx34Uvfr8Z';
const API_URL = process.env.TTS_URL || 'https://speech-internal-test.tal.com/v1/tts';
const API_KEY = process.env.TTS_API_KEY || '1000000125:a66b0927f8cbaa446f463f5cb98f62e4';
const MAX_CHARS = 300;

/**
 * 音色解析（宽松）：完整 id 直接用；只给 id 尾巴（`iUx34Uvfr8Z`）或去掉 `minimax:` 的
 * 整串（`tal-20260126-iUx34Uvfr8Z`）都按音色表反查成完整 id。
 */
export function resolveVoice(v) {
  const s = String(v || '').trim();
  if (!s) return DEFAULT_VOICE;
  const exact = VOICES.find((x) => x.id === s);
  if (exact) return exact.id;
  const bare = s.replace(/^minimax:/, '');
  const hits = VOICES.filter((x) => x.id.endsWith(bare));
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) throw new Error(`音色 "${s}" 有歧义：${hits.map((x) => x.id).join(', ')}`);
  if (s.includes(':')) return s; // 表外的完整 id（如 volcengine:…）原样透传
  throw new Error(`未知音色 "${s}"，用 --list 查看可选音色`);
}

/* ------------------------------------------------------------- 文本切分 */

/**
 * 按 max 字切成多段（rune 安全）。到上限时优先回退到最近的句读处断开，
 * 避免在词中间截断；单段无标点则硬切。
 */
export function chunkText(text, max = MAX_CHARS) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chars = Array.from(clean);
  const out = [];
  let cur = [];
  for (const ch of chars) {
    cur.push(ch);
    if (cur.length < max) continue;
    let cut = -1;
    for (let k = cur.length - 1; k >= Math.floor(max * 0.6); k--) {
      if (/[。！？；!?;，,、]/.test(cur[k])) {
        cut = k;
        break;
      }
    }
    out.push((cut >= 0 ? cur.slice(0, cut + 1) : cur.slice()).join(''));
    cur = cut >= 0 ? cur.slice(cut + 1) : [];
  }
  if (cur.length) out.push(cur.join(''));
  return out.map((s) => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ 合成 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 单段合成：返回 mp3 Buffer。网络/5xx 重试 2 次。 */
async function synthesizeChunk(voice, text, { retries = 2, log = () => {} } = {}) {
  const body = {
    voice,
    text,
    text_type: 'plain',
    format: 'mp3',
    sample_rate: 16000,
    volume: 50,
    pitch_rate: 1,
    speech_rate: 1,
    extra: { language: 'zh-CN', outputFormat: 'audio-16khz-32kbitrate-mono-mp3' },
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
      }
      let j;
      try {
        j = JSON.parse(raw);
      } catch {
        throw new Error(`响应不是 JSON: ${raw.slice(0, 300)}`);
      }
      if (j.code !== 200) throw new Error(`接口返回 code=${j.code}, message=${j.message}`);
      if (!j.data?.audio) throw new Error(`响应缺少 audio 字段: ${raw.slice(0, 200)}`);
      log(`    ↳ task_id=${j.data.task_id} sample_rate=${j.data.sample_rate}`);
      return Buffer.from(j.data.audio, 'base64');
    } catch (err) {
      if (attempt < retries && /fetch failed|ECONN|ETIMEDOUT|socket/i.test(String(err.message))) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

/**
 * mp3 Buffer 列表 → destPath。多段时用 ffmpeg concat 拼接。
 * 每段 mp3 自带 Xing 头/独立时间戳，`-c copy` 拼会报 non-monotonic dts，
 * 故按源参数重编码（16kHz 单声道 32k，与接口返回一致，语音无损感知）。
 */
function concatMp3(buffers, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (buffers.length === 1) {
    fs.writeFileSync(destPath, buffers[0]);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
  try {
    const lines = buffers.map((b, i) => {
      const f = path.join(tmp, `p${String(i).padStart(3, '0')}.mp3`);
      fs.writeFileSync(f, b);
      return `file '${f}'`;
    });
    const listFile = path.join(tmp, 'list.txt');
    fs.writeFileSync(listFile, lines.join('\n') + '\n');
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c:a', 'libmp3lame', '-b:a', '32k', '-ar', '16000', '-ac', '1',
        destPath,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** destPath 以 .m4a 结尾 → 转 AAC/m4a（和仓库里 its-pNN.m4a 一致的封装）。 */
function maybeTranscode(destPath) {
  if (!/\.m4a$/i.test(destPath)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
  try {
    const mp3 = path.join(tmp, 'a.mp3');
    fs.renameSync(destPath, mp3);
    execFileSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp3, '-vn', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', destPath],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * 文本 → 音频文件。
 * @param {string} text
 * @param {{ voice?: string, out: string, maxChars?: number, log?: (s:string)=>void }} opts
 */
export async function ttsToFile(text, { voice, out, maxChars = MAX_CHARS, log = () => {} } = {}) {
  if (!out) throw new Error('缺少 --out 输出路径');
  const v = resolveVoice(voice);
  const chunks = chunkText(text, maxChars);
  if (!chunks.length) throw new Error('文本为空');
  log(`  voice=${v}  段数=${chunks.length}  字数=${Array.from(String(text).replace(/\s+/g, ' ').trim()).length}`);
  const buffers = [];
  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) log(`  [${i + 1}/${chunks.length}] ${chunks[i].slice(0, 24)}…`);
    buffers.push(await synthesizeChunk(v, chunks[i], { log }));
  }
  concatMp3(buffers, out);
  maybeTranscode(out);
  const size = fs.statSync(out).size;
  log(`  ✓ ${out} (${(size / 1024).toFixed(0)} KB)`);
  return out;
}

/* -------------------------------------------------------------------- CLI */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list' || a === '--dry') out[a.slice(2)] = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val == null || val.startsWith('--')) out[key] = true;
      else {
        out[key] = val;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

function printVoices() {
  console.log(`\n可选音色（${VOICES.length} 个 MiniMax 音色）：`);
  for (const v of VOICES) console.log(`  ${v.id.replace(/^minimax:/, '').padEnd(26)} ${v.label}`);
  console.log(`\n  --voice 可只给后缀（如 iUx34Uvfr8Z），默认 ${DEFAULT_VOICE}`);
  console.log(`  接口 ${API_URL}\n`);
}

/** 并发跑任务（保持输出顺序无关，失败不中断其余）。 */
async function runBatch(jobs, concurrency, log) {
  let cursor = 0;
  let ok = 0;
  const failures = [];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, async () => {
    while (cursor < jobs.length) {
      const i = cursor++;
      const job = jobs[i];
      log(`[${i + 1}/${jobs.length}] → ${job.out}`);
      try {
        await ttsToFile(job.text, { voice: job.voice, out: job.out, maxChars: job.maxChars, log });
        ok++;
      } catch (err) {
        failures.push({ job, err });
        log(`  ✗ ${job.out}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);
  return { ok, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (s) => console.log(s);

  if (args.list) {
    printVoices();
    if (!args.json && !args.text && !args.file && !args.probe) return;
  }

  // 音色可用性探测：接口按 api-key 授权，同一份音色表在不同 key/环境下不一定都可用。
  if (args.probe) {
    console.log(`\n探测音色可用性 @ ${API_URL}`);
    const usable = [];
    const denied = [];
    for (const v of VOICES) {
      try {
        await synthesizeChunk(v.id, '你好', { log: () => {} });
        usable.push(v);
        console.log(`  ✓ ${v.id.replace(/^minimax:/, '').padEnd(24)} ${v.label}`);
      } catch (err) {
        denied.push([v, err]);
        console.log(`  ✗ ${v.id.replace(/^minimax:/, '').padEnd(24)} ${v.label}  | ${err.message}`);
      }
    }
    console.log(`\n可用 ${usable.length}/${VOICES.length}${denied.length ? `，不可用 ${denied.length}` : ''}\n`);
    return;
  }

  const maxChars = args['max-chars'] ? Number(args['max-chars']) : MAX_CHARS;
  const concurrency = args.concurrency ? Number(args.concurrency) : 3;

  let jobs = [];
  if (args.json) {
    const spec = JSON.parse(fs.readFileSync(args.json, 'utf8'));
    if (!Array.isArray(spec)) throw new Error(`${args.json} 应为数组：[{ voice, text, out }]`);
    jobs = spec.map((j, i) => ({
      voice: j.voice,
      text: j.text,
      out: j.out,
      maxChars,
      _i: i,
    }));
    if (!jobs.length) throw new Error(`${args.json} 为空`);
  } else {
    const text = args.file ? fs.readFileSync(args.file, 'utf8') : args.text;
    if (typeof text !== 'string' || !text.trim()) {
      printVoices();
      throw new Error('缺少输入：用 --text "…" 或 --file <路径> 或 --json <清单>');
    }
    jobs = [{ voice: args.voice, text, out: args.out, maxChars }];
    if (!args.out) throw new Error('缺少 --out 输出路径');
  }

  if (args.dry) {
    console.log(`\n[dry] ${jobs.length} 个任务：`);
    for (const j of jobs) {
      const n = chunkText(j.text, maxChars).length;
      console.log(`  ${resolveVoice(j.voice)}  ${n} 段  ${Array.from(String(j.text).replace(/\s+/g, ' ').trim()).length} 字  → ${j.out}`);
    }
    return;
  }

  const t0 = Date.now();
  const { ok, failures } = await runBatch(jobs, concurrency, log);
  console.log(`\n✓ 完成 ${ok}/${jobs.length}  用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failures.length) {
    console.log(`✗ 失败 ${failures.length}：`);
    for (const f of failures) console.log(`  ${f.job.out}: ${f.err.message}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err) => {
    console.error(`\n✗ ${err.message}\n`);
    process.exit(1);
  });
}
