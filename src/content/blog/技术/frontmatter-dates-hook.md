---
title: 给博客装一个自动日期钩子：frontmatter-dates 的设计与实现
description: 手写发布日期一定会出错。这篇文章介绍 MangaPaper 的 git 钩子方案：提交时自动注入 date、刷新 updated，以及「修订不公告」的 skip 标记是怎么实现的。
tags: [Astro, git, 工具]
date: 2026-09-14
---

## 为什么手写日期一定会出事

写博客的人都经历过：文章发布了，frontmatter 里的日期是三天前开始动笔时随手写的；或者改了个错别字，顺手把 `updated` 改成昨天——反正差不多就行。

差不多是不行的。日期是博客的时间轴骨架，RSS 订阅、归档页、「最近更新」全都吃这个数据。这件事必须自动化，而且要在**提交那一刻**完成——只有 git 知道这次提交到底动了哪些文章。

## 设计目标

动手之前先定了四条规矩：

1. **工作区、暂存区、提交三者永远一致**。注入日期后不能出现「仓库里的文件有 date，我本地的文件没有」这种幽灵分叉
2. **时区钉死为 Asia/Shanghai**。本地、CI、任何协作者的机器上，`date` 都是同一天
3. **草稿不注入 date**。`draft: true` 的文章还没发布，不该拥有发布日期
4. **修订可以不公告**。改错别字不该把文章顶成「最近更新」

## 核心实现

钩子挂在 husky 上，调用一个 TypeScript 脚本 `scripts/frontmatter-dates.ts`。挑几个关键决策说说。

### 读暂存区，而不是读工作区

注入的依据是「这次提交的是什么内容」，所以读的是暂存区快照：

```bash
git show :src/content/blog/技术/某篇文章.md
```

而不是 `cat` 工作区文件。区别在于 `git add -p`：你可能只暂存了文件的一部分改动，此时工作区和暂存区是两份不同的内容。

### 拒绝半成品暂存

顺着上面那条：如果检测到同一文件**既有暂存改动又有未暂存改动**，钩子直接报错中止提交，提示先全量 `git add`。与其事后收拾分叉，不如当场拒绝：

```ts
const partial = files.filter((f) => hasUnstagedChanges(cwd, f.path));
if (partial.length > 0) {
  throw new Error(`检测到半成品暂存（git add -p）：${names}。请先全量 git add。`);
}
```

### 注入后回写工作区 + 重新 add

这是最容易被漏掉的一步：如果只改暂存区，提交的文件有日期、工作区的没有——下次任何 `git add -p` 或全局替换都会踩到幽灵 diff。所以脚本的每个文件处理都是三步：

```ts
const result = transform(stagedContent, status, today);
writeFileSync(join(cwd, file.path), result); // ① 回写工作区
git("add", "--", file.path);                  // ② 重新暂存
```

工作区、暂存区、即将生成的提交，三者始终是同一份字节。

### 双钩子：读消息与改内容的时机冲突

「修订不公告」需要读 commit message，但这里有个隐蔽的坑：**`git add` 只在 `pre-commit` 阶段才会进入本次提交**——在 `prepare-commit-msg` / `commit-msg` 阶段才 add，树已经组装完，改了也白改（实测踩过）。

所以拆成两个钩子各管一段：

```
pre-commit   →  A 文件注入 date（不需要看消息）+ 半暂存守卫
post-commit  →  读 HEAD 消息，按 type 决定 M 文件是否刷 updated，
                需要时改写文件后 git commit --amend --no-edit
```

`post-commit` 里的 amend 会再次触发钩子，用 `.git/` 下的标记文件防递归。判定规则：

```ts
// feat 公告刷新；fix/chore 静默；[skip-updated] 任何 type 强制跳过
export function shouldSkipUpdated(message: string): boolean {
  if (message.includes(SKIP_UPDATED_MARKER)) return true;
  const match = CONVENTIONAL_HEADER.exec(message.split("\n", 1)[0]);
  return match ? SILENT_TYPES.has(match[1]) : false;
}
```

注意静默只豁免 `M`（修改）文件的 `updated`——**新增文章的 `date` 注入在 pre-commit 完成，不受提交类型影响**。

### 正文一字节不动

frontmatter 的编辑不用任何 YAML 库，只做**行级操作**：找到 `---` 分隔块，在其中查找或插入 `date:` / `updated:` 行。BOM、CRLF、正文里的 `---` 水平线全部原样保留。这些边界条件都有测试守着：

```ts
test("CRLF 文件注入后行尾保持 CRLF", () => {
  const out = transform("---\r\ntitle: a\r\n---\r\nbody\r\n", "A", TODAY);
  assert.ok(out.includes(`date: ${TODAY}\r\n---`));
});
```

## 日常用法一览

| 场景 | 操作 | 结果 |
| --- | --- | --- |
| 发布新文章 | `feat(blog): 发布《标题》` | 只注入 `date: 今天` |
| 实质更新文章 | `feat(blog): 《标题》补充章节` | `updated` 刷新为今天 |
| 修错别字/错误代码 | `fix(blog): 《标题》修正错别字` | `updated` 不动 |
| 调整分类/标签等元数据 | `chore(blog): 《标题》调整标签` | `updated` 不动 |
| feat 但这次不想公告 | 消息加 `[skip-updated]` | 任何 type 都强制跳过 |
| 写草稿 | `draft: true` | 不注入 `date`，转正时首次提交自动补上 |
| `git add -p` 半暂存 | 提交 | 报错中止，提示全量 add |

一句话记忆：**feat 是公告，fix/chore 是静默修订**，`[skip-updated]` 是任何场景下的逃生门。

## 关于测试

脚本是发布流程的一部分，错了会污染每一篇文章的元数据，所以它有 11 个测试：8 个纯函数单测（解析、注入、行尾保留）+ 3 个**真实临时 git 仓库**的集成测试（init、add、commit 全流程跑一遍）。改脚本前跑 `npm test`，比祈祷可靠。

顺带一提：你现在读的这篇文章，发布日期就是钩子注入的——我没有在 frontmatter 里写 `date`。
