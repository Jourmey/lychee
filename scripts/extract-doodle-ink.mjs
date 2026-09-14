/**
 * extract-doodle-ink —— 从录课回放里抠出「老师真实笔迹」，写成涂鸦数据。
 *
 * 老师的圈画/下划线/手写批注只存在于录课视频的像素里（ITS 没有任何结构化涂鸦数据，
 * 见 MEMORY），所以逐页这么做：在本页时间窗内采样若干帧，自动挑「白页可见 + 墨迹最多」
 * 的那一帧当终态，按饱和度识别红/蓝墨迹 → 6px 网格连通域 → 每块导出一张**透明 PNG**
 * （原样保留老师当时写的形状与颜色），并按各块在采样帧里的覆盖率定出「首次出现」时刻。
 *
 * 结果写回 <DATASET>/pages.json 的 `doodles`（kind=ink，坐标是**课件画布 1365×768 的比例**），
 * 图片落在 public/courseware/doodle/<DATASET>/。改完记得 `pnpm build-course` 重建 data.json。
 *
 * 用法：
 *   DATASET=data4 node scripts/extract-doodle-ink.mjs                 # 全部有 start/end 的页
 *   DATASET=data4 node scripts/extract-doodle-ink.mjs --only 3,6,9    # 只做指定 ITS 页码
 *   DATASET=data4 node scripts/extract-doodle-ink.mjs --dry           # 只分析，不写文件
 *
 * 回放源解析：<DATASET>/replay.mp4 → 数据集目录下唯一的 *.mp4 → 报错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATASET, DS, ROOT, loadConfig, readJson, writeJson } from './lib/dataset.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const onlyArg = args.indexOf('--only');
const only = onlyArg >= 0 ? new Set(String(args[onlyArg + 1] || '').split(',').map((s) => Number(s.trim())).filter(Number.isFinite)) : null;

const OUTDIR = path.join(ROOT, 'public', 'courseware', 'doodle', DATASET);
const PREFIX = `/courseware/doodle/${DATASET}`;

/* --------------------------------------------------------------- 回放源 */
function resolveSource() {
  const fixed = DS('replay.mp4');
  if (fs.existsSync(fixed)) return fixed;
  const mp4s = fs.readdirSync(DS()).filter((f) => f.toLowerCase().endsWith('.mp4'));
  if (mp4s.length === 1) return DS(mp4s[0]);
  throw new Error(`${DATASET}/ 下找不到唯一的回放 mp4（当前 ${mp4s.length} 个）——请放一个 ${DATASET}/replay.mp4`);
}
const SRC = resolveSource();

const config = loadConfig();
const sceneLimit = Number(config.sceneLimit) > 0 ? Number(config.sceneLimit) : Infinity;

/* ----------------------------------------------------------- 逐页数据 */
const overrides = readJson('pages.json');
const isArray = Array.isArray(overrides);
/** 遍历出 { pageNo, get(), set(doodles) } —— 兼容 pages.json 的数组/对象两种形态。 */
const entries = [];
if (isArray) {
  overrides.forEach((o, i) => {
    const pageNo = Number(o?.page) || i + 1;
    entries.push({ kind: 'array', pageNo, i, o });
  });
} else {
  for (const [k, o] of Object.entries(overrides)) entries.push({ kind: 'object', pageNo: Number(k), key: k, o });
}

const toSec = (t) => {
  const p = String(t || '').trim().split(':').map(Number);
  if (p.length < 2 || p.length > 3 || p.some((n) => !Number.isFinite(n))) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};
const mmss = (s) => `${Math.floor(s / 60)}:${String((s % 60).toFixed(1)).padStart(4, '0')}`;

/* --------------------------------------------------------------- 图像 */
const [VW, VH] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', SRC]).toString().trim().split(',').map(Number);
const rawAt = (t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', SRC, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });

/** 单像素是否墨迹（红/蓝），0/1/2。饱和度门控用来剔除课件自带的浅色装饰（粉底/浅紫边）。 */
function inkAt(raw, p) {
  const i = p * 3, r = raw[i], g = raw[i + 1], b = raw[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
  if (sat > 0.42 && r - Math.max(g, b) > 45) return 1;
  if (sat > 0.45 && b - Math.max(r, g) > 55) return 2;
  return 0;
}
/** 白页边界 = 课件画布在屏幕上的位置（每帧都重新算，因为画布是 contain 居中）。 */
function pageBounds(raw) {
  const isWhite = (i) => raw[i] > 232 && raw[i + 1] > 232 && raw[i + 2] > 232;
  const colW = new Array(VW).fill(0), rowW = new Array(VH).fill(0);
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) { const i = (y * VW + x) * 3; if (isWhite(i)) { colW[x]++; rowW[y]++; } }
  let L = 0, R = VW - 1, T = 0, B = VH - 1;
  while (L < VW && colW[L] < VH * 0.5) L++;
  while (R > 0 && colW[R] < VH * 0.5) R--;
  while (T < VH && rowW[T] < VW * 0.3) T++;
  while (B > 0 && rowW[B] < VW * 0.3) B--;
  return { L, R, T, B };
}
const boundsOk = (b) => {
  const w = b.R - b.L + 1, h = b.B - b.T + 1;
  return w > 600 && w / h > 1.6 && w / h < 1.95;
};
function inkCount(raw, b) {
  let n = 0;
  for (let y = b.T; y <= b.B; y += 2) for (let x = b.L; x <= b.R; x += 2) if (inkAt(raw, y * VW + x)) n++;
  return n;
}
/** 连通域（8 邻域 / 6px 网格），返回外接框像素坐标。 */
function components(raw, b) {
  const CELL = 6, gw = Math.ceil(VW / CELL), gh = Math.ceil(VH / CELL);
  const cell = new Uint8Array(gw * gh);
  for (let y = b.T; y <= b.B; y++) for (let x = b.L; x <= b.R; x++) if (inkAt(raw, y * VW + x)) cell[Math.floor(y / CELL) * gw + Math.floor(x / CELL)] = 1;
  const seen = new Uint8Array(gw * gh), comps = [];
  for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
    const c0 = cy * gw + cx;
    if (!cell[c0] || seen[c0]) continue;
    const st = [[cx, cy]]; seen[c0] = 1;
    let minX = cx, maxX = cx, minY = cy, maxY = cy, n = 0;
    while (st.length) {
      const [x, y] = st.pop(); n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const c = ny * gw + nx;
        if (cell[c] && !seen[c]) { seen[c] = 1; st.push([nx, ny]); }
      }
    }
    if (n >= 4) comps.push({ minX, maxX, minY, maxY });
  }
  comps.sort((a, b2) => (a.minY - b2.minY) || (a.minX - b2.minX));
  return comps;
}

/* ------------------------------------------------------------ 主流程 */
if (!dry) fs.mkdirSync(OUTDIR, { recursive: true });
let done = 0, total = 0;

for (let sceneIdx = 0; sceneIdx < entries.length; sceneIdx++) {
  const { o, pageNo } = entries[sceneIdx];
  if (pageNo > sceneLimit) continue;
  if (only && !only.has(pageNo)) continue;
  const start = toSec(o.start), end = toSec(o.end);
  if (start == null || end == null || end <= start) { console.log(`  跳过 p${pageNo}：缺 start/end`); continue; }
  total++;

  const span = end - start;
  const step = Math.max(2.5, span / 36);
  const times = [];
  for (let t = start + 1; t < end - 0.5 && times.length < 40; t += step) times.push(+t.toFixed(1));
  times.push(+(end - 0.5).toFixed(1));

  const frames = times.map((t) => ({ t, raw: rawAt(t) }));
  const infos = frames.map((f) => {
    const b = pageBounds(f.raw);
    const ok = boundsOk(b);
    return { t: f.t, b, ok, ink: ok ? inkCount(f.raw, b) : -1 };
  });
  const good = infos.filter((i) => i.ok && i.ink > 0);
  if (good.length === 0) { console.log(`p${pageNo}：本页没有可识别的白页/墨迹（保持原样）`); continue; }

  const best = good.reduce((a, b) => (b.ink > a.ink ? b : a));
  const bd = best.b;
  const finalRaw = frames.find((f) => f.t === best.t).raw;
  const PW = bd.R - bd.L + 1, PH = bd.B - bd.T + 1;

  const blob = components(finalRaw, bd).map((c) => {
    const PAD = 3;
    const x0 = Math.max(bd.L, c.minX * 6 - PAD), y0 = Math.max(bd.T, c.minY * 6 - PAD);
    const x1 = Math.min(bd.R + 1, (c.maxX + 1) * 6 + PAD), y1 = Math.min(bd.B + 1, (c.maxY + 1) * 6 + PAD);
    const ptsN = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (inkAt(finalRaw, y * VW + x)) ptsN.push([(x - bd.L) / PW, (y - bd.T) / PH]);
    const stride = Math.max(1, Math.floor(ptsN.length / 300));
    return { x0, y0, x1, y1, ptsN: ptsN.filter((_, i) => i % stride === 0), cov: [] };
  }).filter((b) => b.ptsN.length >= 12);

  frames.forEach((f, fi) => {
    const ok = infos[fi].ok;
    for (const b of blob) {
      if (!ok) { b.cov.push(0); continue; }
      let hit = 0;
      for (const [nx, ny] of b.ptsN) {
        const x = Math.round(bd.L + nx * PW), y = Math.round(bd.T + ny * PH);
        if (inkAt(f.raw, y * VW + x)) hit++;
      }
      b.cov.push(hit / b.ptsN.length);
    }
  });

  // 同一页可能被老师回翻（如 p7 出现两次），故文件名用**场景序号**（不是页码）做区分。
  const tag = `scene${String(sceneIdx).padStart(2, '0')}`;
  if (!dry) for (const f of fs.readdirSync(OUTDIR)) if (f.startsWith(`${tag}-`)) fs.unlinkSync(path.join(OUTDIR, f));
  const doodles = blob.map((b, i) => {
    let at = +(best.t - start).toFixed(1);
    for (let k = 0; k < times.length; k++) if (b.cov[k] >= 0.4) { at = +(times[k] - start).toFixed(1); break; }
    const cw = b.x1 - b.x0, ch = b.y1 - b.y0;
    const file = `${tag}-b${String(i + 1).padStart(2, '0')}.png`;
    if (!dry) {
      const rgba = Buffer.alloc(cw * ch * 4);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const src = (b.y0 + y) * VW + (b.x0 + x), dst = (y * cw + x) * 4;
        const r = finalRaw[src * 3], g = finalRaw[src * 3 + 1], bl = finalRaw[src * 3 + 2];
        const k = inkAt(finalRaw, src);
        let a = 0;
        if (k === 1) a = Math.min(255, Math.round((r - Math.max(g, bl) - 45) * 4));
        else if (k === 2) a = Math.min(255, Math.round((bl - Math.max(r, g) - 55) * 4));
        rgba[dst] = r; rgba[dst + 1] = g; rgba[dst + 2] = bl; rgba[dst + 3] = a;
      }
      const tmp = path.join(OUTDIR, `.${file}.rgba`);
      fs.writeFileSync(tmp, rgba);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${cw}x${ch}`, '-i', tmp, '-y', path.join(OUTDIR, file)]);
      fs.unlinkSync(tmp);
    }
    return { kind: 'ink', at: mmss(at), src: `${PREFIX}/${file}`, x: +((b.x0 - bd.L) / PW).toFixed(4), y: +((b.y0 - bd.T) / PH).toFixed(4), w: +(cw / PW).toFixed(4), h: +(ch / PH).toFixed(4) };
  });
  doodles.sort((a, b) => toSec(a.at) - toSec(b.at));

  if (!dry) {
    if (doodles.length > 0) o.doodles = doodles; else delete o.doodles;
  }
  done++;
  console.log(`p${pageNo}: 终态 t=${best.t}s  页 ${PW}x${PH}  ${doodles.length} 笔  波次=[${[...new Set(doodles.map((d) => d.at))].join(' ')}]`);
}

if (!dry && done > 0) writeJson('pages.json', overrides);
console.log(`✓ ${DATASET}  处理 ${done}/${total} 页${dry ? '（--dry 未写文件）' : `，图片 → public/courseware/doodle/${DATASET}/，已写回 pages.json`}`);
console.log('  下一步：pnpm build-course（或 DATASET=... pnpm build-course）重建 data.json');
