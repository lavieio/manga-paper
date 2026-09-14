import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseDoc,
  transform,
  todayShanghai,
  shouldSkipUpdated,
  preCommit,
  postCommit,
} from "./frontmatter-dates.ts";

const TODAY = todayShanghai();

// ── 纯函数 ────────────────────────────────────────────────────

test("parseDoc 识别 LF / CRLF / BOM / 缺失 frontmatter", () => {
  const lf = parseDoc("---\ntitle: a\n---\nbody");
  assert.equal(lf.eol, "\n");
  assert.equal(lf.frontmatter, "title: a");

  const crlf = parseDoc("---\r\ntitle: a\r\n---\r\nbody");
  assert.equal(crlf.eol, "\r\n");

  const bom = parseDoc("﻿---\ntitle: a\n---\nbody");
  assert.equal(bom.bom, "﻿");
  assert.equal(bom.frontmatter, "title: a");

  const none = parseDoc("# 没有 frontmatter");
  assert.equal(none.frontmatter, null);
});

test("A（新增）无 date → 注入今日，且不碰正文", () => {
  const out = transform("---\ntitle: 新文\ntags: [a]\n---\n正文不变", "A", TODAY);
  assert.ok(out!.includes(`date: ${TODAY}\n---`));
  assert.ok(out!.endsWith("正文不变"));
});

test("A 但 draft: true → 不注入", () => {
  assert.equal(transform("---\ntitle: 草稿\ndraft: true\n---\nx", "A", TODAY), null);
});

test("A 已有 date → 不动", () => {
  assert.equal(transform("---\ntitle: a\ndate: 2020-01-01\n---\nx", "A", TODAY), null);
});

test("M → updated 写为今日；已有 updated 则替换", () => {
  const add = transform("---\ntitle: a\ndate: 2020-01-01\n---\nx", "M", TODAY);
  assert.ok(add!.includes(`updated: ${TODAY}`));

  const replace = transform(`---\ntitle: a\nupdated: 2020-01-01\n---\nx`, "M", TODAY);
  assert.ok(replace!.includes(`updated: ${TODAY}`));
  assert.ok(!replace!.includes("2020-01-01"));
});

test("M 且 updated 已是今日 → 不动", () => {
  assert.equal(transform(`---\nupdated: ${TODAY}\n---\nx`, "M", TODAY), null);
});

test("缺 frontmatter → 抛错", () => {
  assert.throws(() => transform("# x", "A", TODAY), /缺少 frontmatter/);
});

test("CRLF 文件注入后行尾保持 CRLF", () => {
  const out = transform("---\r\ntitle: a\r\n---\r\nbody\r\n", "A", TODAY);
  assert.ok(out!.includes(`date: ${TODAY}\r\n---`));
  assert.ok(!out!.includes("date: " + TODAY + "\n---\n"));
});

test("shouldSkipUpdated：type 推断 + 标记优先", () => {
  assert.equal(shouldSkipUpdated("fix(blog): 修错别字"), true);
  assert.equal(shouldSkipUpdated("chore(blog): 调整标签"), true);
  assert.equal(shouldSkipUpdated("feat(blog): 补充章节"), false);
  assert.equal(shouldSkipUpdated("feat(blog): 发布新文 [skip-updated]"), true);
  assert.equal(shouldSkipUpdated("随便写的提交信息"), false); // 非约定式 → 默认公告
});

// ── 集成：临时 git 仓库（临时仓库无 .husky，直接调用 pre/post）──

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "fm-dates-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  mkdirSync(join(dir, "src/content/blog"), { recursive: true });
  return dir;
}

const POST = "src/content/blog/集成测试.md";

function commitAll(cwd: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", message], { cwd });
}

function blobOf(cwd: string, path: string): string {
  return execFileSync("git", ["show", `HEAD:${path}`], { cwd, encoding: "utf8" });
}

test("集成：pre-commit 注入 date 且进入提交 blob", () => {
  const cwd = makeRepo();
  writeFileSync(join(cwd, POST), "---\ntitle: 集成\n---\n正文\n");
  execFileSync("git", ["add", "."], { cwd });
  preCommit(cwd);
  assert.ok(readFileSync(join(cwd, POST), "utf8").includes(`date: ${TODAY}`), "工作区回写");
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "feat(blog): 发布"], { cwd });
  assert.ok(blobOf(cwd, POST).includes(`date: ${TODAY}`), "提交 blob 含 date");
});

test("集成：半成品暂存 → preCommit 抛错拒绝", () => {
  const cwd = makeRepo();
  writeFileSync(join(cwd, POST), "---\ntitle: v1\n---\nv1\n");
  commitAll(cwd, "init");
  writeFileSync(join(cwd, POST), "---\ntitle: v2\n---\nv2\n");
  execFileSync("git", ["add", POST], { cwd });
  writeFileSync(join(cwd, POST), "---\ntitle: v2\n---\nv2\n未暂存改动\n");
  assert.throws(() => preCommit(cwd), /半成品暂存/);
});

test("集成：post-commit——feat 刷新 updated 并 amend 进提交", () => {
  const cwd = makeRepo();
  writeFileSync(join(cwd, POST), "---\ntitle: 已发布\ndate: 2025-01-01\n---\n正文\n");
  commitAll(cwd, "feat(blog): 发布");
  writeFileSync(join(cwd, POST), "---\ntitle: 已发布\ndate: 2025-01-01\n---\n补充一段\n");
  commitAll(cwd, "feat(blog): 《已发布》补充章节");
  postCommit(cwd);
  assert.ok(blobOf(cwd, POST).includes(`updated: ${TODAY}`), "amend 后 blob 含 updated");
  assert.ok(readFileSync(join(cwd, POST), "utf8").includes(`updated: ${TODAY}`), "工作区同步");
});

test("集成：post-commit——fix 静默、feat+标记强制跳过", () => {
  const cwd = makeRepo();
  writeFileSync(join(cwd, POST), "---\ntitle: 已发布\ndate: 2025-01-01\n---\n正文\n");
  commitAll(cwd, "feat(blog): 发布");

  writeFileSync(join(cwd, POST), "---\ntitle: 已发布\ndate: 2025-01-01\n---\n修错别字\n");
  commitAll(cwd, "fix(blog): 《已发布》修正错别字");
  postCommit(cwd);
  assert.ok(!blobOf(cwd, POST).includes("updated:"), "fix 不刷新");

  writeFileSync(join(cwd, POST), "---\ntitle: 已发布\ndate: 2025-01-01\n---\n再次改动\n");
  commitAll(cwd, "feat(blog): 《已发布》改动 [skip-updated]");
  postCommit(cwd);
  assert.ok(!blobOf(cwd, POST).includes("updated:"), "标记强制跳过");
});
