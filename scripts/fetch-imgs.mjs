/**
 * fetch-imgs.mjs — 把某个数据集 ITS 课件里引用的图片（resource/imgs/*）抓到 public/courseware/imgs/。
 *
 * 左侧场景侧栏用 @openmaic/renderer 渲染每页缩略图，课件里的图片必须本地存在，否则缩略图缺图。
 * 课件图片在 CDN 上与 json 同级：<playerUrl 目录>/resource/imgs/<file>。
 *
 * 用法：
 *   DATASET=data2 node scripts/fetch-imgs.mjs          # 只下缺失的
 *   DATASET=data2 node scripts/fetch-imgs.mjs --force  # 全部重下
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATASET, DS, ROOT, readJson, loadConfig } from './lib/dataset.mjs';

const FORCE = process.argv.includes('--force');
const config = loadConfig();
const playerUrl = config.its?.playerUrl;
if (!playerUrl) {
  console.error(`✗ ${DATASET}/dataset.config.json 缺 its.playerUrl`);
  process.exit(1);
}
const baseDir = playerUrl.replace(/\/[^/]*$/, ''); // 去掉 index.html

const its = readJson('raw/its-content.json');
const files = new Set();
for (const page of its.data.mainCode.pages) {
  const walk = (items) => {
    for (const it of items || []) {
      if (it.type === 'group') { walk(it.groupItem); continue; }
      const re = /resource\/imgs\/([^")\s]+)/g;
      let m;
      while ((m = re.exec(it.content || ''))) files.add(m[1]);
    }
  };
  walk(page.items);
  const bm = /resource\/imgs\/([^")\s]+)/.exec((page.main && page.main.background) || '');
  if (bm) files.add(bm[1]);
}

const outDir = path.join(ROOT, 'public', 'courseware', 'imgs');
fs.mkdirSync(outDir, { recursive: true });

let ok = 0, skip = 0, fail = 0;
for (const f of [...files].sort()) {
  const dest = path.join(outDir, f);
  if (fs.existsSync(dest) && !FORCE) { skip += 1; continue; }
  const url = `${baseDir}/resource/imgs/${f}`;
  try {
    execFileSync('curl', ['-sS', '-L', '--fail', '-o', dest, url], { stdio: ['ignore', 'ignore', 'pipe'] });
    ok += 1;
  } catch (e) {
    fail += 1;
    console.error(`  ✗ ${f}  ${url}`);
  }
}
console.log(`✓ 课件图片  ${DATASET}: 新增 ${ok}  已存在 ${skip}  失败 ${fail}  → public/courseware/imgs/`);
