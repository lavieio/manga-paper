#!/usr/bin/env node
/**
 * 博客 frontmatter 的 date / updated 自动注入（plan §6），双钩子协作：
 *
 * - pre-commit：A（新增）文件注入 date；半成品暂存报错中止；缺 frontmatter 报错。
 *   此阶段的 git add 会进入提交（lint-staged 同款时机）。
 * - post-commit：读取 HEAD 提交信息，按 type 决定 M（修改）文件是否刷新 updated——
 *   feat 公告刷新；fix/chore 静默；[skip-updated] 强制跳过。需要刷新时
 *   改写文件后 `git commit --amend --no-edit`（递归由 .git/ 标记文件守卫）。
 *
 * 为什么不挂 prepare-commit-msg / commit-msg：该阶段的 git add 不会进入本次提交
 * （实测：树已组装），只有 pre-commit 阶段有效。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CONTENT_DIR = "src/content/blog/";
/** commit message 含此标记时，跳过本次 updated 刷新（修订不公告） */
const SKIP_UPDATED_MARKER = "[skip-updated]";
/** 静默类型：fix/chore 的 M 文件不刷新 updated（语义：feat=公告，fix/chore=静默） */
const SILENT_TYPES = new Set(["fix", "chore"]);
const CONVENTIONAL_HEADER = /^(\w+)(\([^)]*\))?!?:/;
/** post-commit amend 的递归守卫标记（相对 .git 的路径） */
const AMEND_GUARD = ".git/.frontmatter-amending";
const TIME_ZONE = "Asia/Shanghai";
const EOL_CRLF = "\r\n";
const EOL_LF = "\n";

/** 是否跳过 updated 刷新：标记强制跳过；或 commit type 属于静默类型 */
export function shouldSkipUpdated(message: string): boolean {
  if (message.includes(SKIP_UPDATED_MARKER)) return true;
  const firstLine = message.split("\n", 1)[0];
  const match = CONVENTIONAL_HEADER.exec(firstLine);
  return match ? SILENT_TYPES.has(match[1]) : false;
}

export function todayShanghai(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

interface ParsedDoc {
  bom: string;
  eol: string;
  frontmatter: string | null;
  body: string;
}

export function parseDoc(raw: string): ParsedDoc {
  const bom = raw.startsWith("﻿") ? "﻿" : "";
  const text = bom ? raw.slice(bom.length) : raw;
  const eol = text.includes(EOL_CRLF) ? EOL_CRLF : EOL_LF;
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || match.index !== 0) {
    return { bom, eol, frontmatter: null, body: text };
  }
  return { bom, eol, frontmatter: match[1], body: text.slice(match[0].length) };
}

export function getField(frontmatter: string, name: string): string | null {
  const match = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

/** 设置（或新增）frontmatter 顶层字段，返回新 frontmatter 文本 */
export function setField(frontmatter: string, name: string, value: string): string {
  const line = `${name}: ${value}`;
  if (new RegExp(`^${name}:`, "m").test(frontmatter)) {
    return frontmatter.replace(new RegExp(`^${name}:.*$`, "m"), line);
  }
  return `${frontmatter}${EOL_LF}${line}`;
}

function rebuild(doc: ParsedDoc, frontmatter: string): string {
  return `${doc.bom}---${doc.eol}${frontmatter}${doc.eol}---${doc.body}`;
}

/**
 * 按 git 状态计算新内容；无需修改返回 null。
 * status: "A"（新增）| "M"（改动）
 */
export function transform(raw: string, status: "A" | "M", today: string): string | null {
  const doc = parseDoc(raw);
  if (doc.frontmatter === null) {
    throw new Error("缺少 frontmatter（--- 分隔块），无法注入日期");
  }
  const isDraft = getField(doc.frontmatter, "draft") === "true";
  if (status === "A") {
    if (isDraft || getField(doc.frontmatter, "date")) return null;
    return rebuild(doc, setField(doc.frontmatter, "date", today));
  }
  if (getField(doc.frontmatter, "updated") === today) return null;
  return rebuild(doc, setField(doc.frontmatter, "updated", today));
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

interface StagedFile {
  status: string;
  path: string;
}

function isBlogPost(path: string): boolean {
  return path.startsWith(CONTENT_DIR) && path.endsWith(".md");
}

function parseNameStatus(out: string): StagedFile[] {
  return out
    .split(EOL_LF)
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split("\t");
      return { status, path };
    })
    .filter((f) => isBlogPost(f.path));
}

function hasUnstagedChanges(cwd: string, path: string): boolean {
  try {
    git(cwd, ["diff", "--quiet", "--", path]);
    return false;
  } catch {
    return true;
  }
}

/** 把 transform 结果落盘并暂存；返回是否有改动 */
function applyTransform(cwd: string, path: string, raw: string, status: "A" | "M", today: string): boolean {
  const result = transform(raw, status, today);
  if (result === null) return false;
  writeFileSync(join(cwd, path), result, "utf8"); // 回写工作区
  git(cwd, ["add", "--", path]); // 重新暂存
  return true;
}

// ── pre-commit：A 文件注入 date ────────────────────────────────

export function preCommit(cwd: string): void {
  const staged = parseNameStatus(git(cwd, ["diff", "--cached", "--name-status", "--diff-filter=AM"]));
  if (staged.length === 0) return;
  const partial = staged.filter((f) => hasUnstagedChanges(cwd, f.path));
  if (partial.length > 0) {
    const names = partial.map((f) => f.path).join(", ");
    throw new Error(
      `检测到半成品暂存（git add -p）：${names}。请先全量 git add 这些文件后再提交，以保证工作区与提交一致。`,
    );
  }
  const today = todayShanghai();
  for (const file of staged.filter((f) => f.status === "A")) {
    const stagedContent = git(cwd, ["show", `:${file.path}`]);
    if (applyTransform(cwd, file.path, stagedContent, "A", today)) {
      console.log(`[frontmatter-dates] ${file.path}: 注入 date → ${today}`);
    }
  }
}

// ── post-commit：按提交信息决定 M 文件的 updated ───────────────

export function postCommit(cwd: string): void {
  const guardPath = join(cwd, AMEND_GUARD);
  if (existsSync(guardPath)) return; // 正处于钩子自发的 amend，防止递归
  // 合并提交不处理（diff 语义不明确）
  const parents = git(cwd, ["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ");
  if (parents.length !== 2) return;
  const message = git(cwd, ["log", "-1", "--format=%B"]);
  if (shouldSkipUpdated(message)) return;
  const changed = parseNameStatus(
    git(cwd, ["diff", "--name-status", "--diff-filter=M", "HEAD~1", "HEAD", "--", CONTENT_DIR]),
  ).filter((f) => f.status === "M");
  if (changed.length === 0) return;

  const today = todayShanghai();
  let touched = false;
  for (const file of changed) {
    if (hasUnstagedChanges(cwd, file.path)) {
      console.warn(`[frontmatter-dates] ${file.path}: 工作区与提交不一致，跳过 updated 刷新`);
      continue;
    }
    const raw = readFileSync(join(cwd, file.path), "utf8");
    if (applyTransform(cwd, file.path, raw, "M", today)) {
      console.log(`[frontmatter-dates] ${file.path}: 刷新 updated → ${today}（amend）`);
      touched = true;
    }
  }
  if (!touched) return;

  writeFileSync(guardPath, "", "utf8");
  try {
    git(cwd, ["commit", "--amend", "--no-edit", "-q"]);
  } finally {
    unlinkSync(guardPath);
  }
}

// ── 入口 ────────────────────────────────────────────────────────

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const mode = process.argv[2];
  try {
    if (mode === "pre") preCommit(process.cwd());
    else if (mode === "post") postCommit(process.cwd());
    else throw new Error("用法：node frontmatter-dates.ts <pre|post>");
  } catch (err) {
    console.error(`[frontmatter-dates] ${(err as Error).message}`);
    process.exit(1);
  }
}
