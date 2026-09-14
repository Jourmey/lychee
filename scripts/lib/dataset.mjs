/**
 * dataset —— 一套数据的公共解析。
 *
 * 「一套数据」= 一个目录，默认 `data/`，用环境变量 `DATASET` 切换（如 `DATASET=data2`）：
 *
 *   <DATASET>/
 *     dataset.config.json    进 git  课程元信息 + ITS 嵌入配置 + 人工边界
 *     pages.json             进 git  逐页手工数据（title/start/end/audio/text/steps/highlights）
 *     raw/its-content.json   输入    ITS 课件原始 json
 *     transcripts.json       输入    课堂逐字稿
 *     data.json              产物    build-course.mjs 生成
 *     alignment.{json,md,csv} 产物   align-transcript.mjs 生成
 *
 * 用法：
 *   import { DATASET, DS, readJson, writeJson, loadConfig } from './lib/dataset.mjs';
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 数据集目录名（相对仓库根），默认 `data`。 */
export const DATASET = process.env.DATASET || 'data';

/** 拼一个数据集内的绝对路径。 */
export const DS = (...parts) => path.join(ROOT, DATASET, ...parts);

/** 相对仓库根的展示用路径。 */
export const rel = (abs) => path.relative(ROOT, abs);

/** 读数据集内的 json（传绝对路径则直接用）。 */
export function readJson(p) {
  const abs = path.isAbsolute(p) ? p : DS(p);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

/** 写数据集内的 json（自动建目录，末尾补换行）。 */
export function writeJson(p, obj) {
  const abs = path.isAbsolute(p) ? p : DS(p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n');
}

/** 数据集内的文件是否存在。 */
export function exists(p) {
  return fs.existsSync(path.isAbsolute(p) ? p : DS(p));
}

/** 读 <DATASET>/dataset.config.json；缺省返回 {}，让调用方兜底。 */
export function loadConfig() {
  try {
    return readJson('dataset.config.json');
  } catch {
    console.warn(`  ! ${DATASET}/dataset.config.json 不存在，课程元信息/ITS 配置将缺失`);
    return {};
  }
}
