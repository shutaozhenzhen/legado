# AGENTS.md

本文件在每个会话自动注入，给在本仓库工作的 AI agent 用。目标是**少读源码、少走弯路**：先查现成的知识图谱，再定点读文件。

## 仓库是什么

- Android 阅读 App，Kotlin 为主：`app/src/main` 下 815 个 `.kt`/`.java`，约 10 万行；另有 492 个 XML（布局/菜单/偏好项）。
- 分层：`ui/`（界面）→ `model/`（书源规则求值 + 阅读会话 + 本地解析）→ `help/`（横切支撑：配置、HTTP、缓存、备份）→ `data/`（Room）、`lib/`（组件库）、`utils/`、`service/`、`api/`（ContentProvider 跨进程）、`core/`（基座与常量）。
- 本机没有 JDK / Android SDK / gradle 缓存，**不能编译**；构建验证靠 GitHub Actions。不要声称"编译通过"。

## 先查图，再读代码

仓库带一份 Understand-Anything 知识图谱：`.ua/knowledge-graph.json`（3741 节点 / 5658 边 / 9 个模块层 / 14 步导览，基线 commit 见 `.ua/meta.json`）。涉及"这功能在哪、谁调它、改它影响谁"时，**先跑查询**：

```bash
node .ua/tools/query.cjs search <关键词>          # 按名称/摘要/标签搜，带摘要与行号
node .ua/tools/query.cjs file <文件名或路径片段>   # 文件摘要 + 成员清单（类/函数 + 行号）
node .ua/tools/query.cjs show <nodeId>            # 单节点详情 + 出入边
node .ua/tools/query.cjs impact <名称> [--depth 2] # 反向依赖：改这个会波及谁
node .ua/tools/query.cjs hub [--limit 15]         # fan-in 最高的文件（改动震中）
```

规则：

1. `file` 输出（摘要 + 成员 + 行号）通常已经够回答"这个类干什么、有哪些方法"，**不要为了确认这些去整文件读**。
2. 需要具体实现细节（分支、常量、资源 id、正则）时，按节点给的 `lineRange` 定点读那几十行，不要整文件读。
3. 改代码前先 `impact`，评估影响面；不确定从哪下手时先 `hub`。

## 引用规范

- 结论里提到代码必须给 `相对路径:行号`，例如 `app/src/main/java/io/legado/app/model/localBook/LocalBook.kt:231`。
- 节点 id 形如 `class:<path>:<Name>`、`function:<path>:<name>`、`file:<path>`、`table:<tableName>` / `<tableName>`。不确定就用 `search`/`file` 查，别凭记忆拼。

## 图的边界（要么声明，要么别下结论）

- 跨模块的 `imports` 边在分 scope 合并时被丢弃（全图 `imports` 仅 708 条）。`impact` 只给出同模块引用者时，跨模块影响面要用 grep 补一次，并注明"图未覆盖，已 grep 补查"。
- Kotlin 由 tree-sitter 抽取：重载合并成一个节点，<10 行的成员不建节点；`table` 节点只覆盖 `data/entities` 下 21 张 @Entity。
- 图是快照。查询打印 `[stale]` 表示基线之后有 `.ua/` 之外的源码改动：可先用图定位，但结论以源码为准。

## 图谱维护

- 产物说明与重建方式见 `.ua/README.md`；`scopes/` 下是各模块图（不入库），全仓图用 `node .ua/tools/assemble-repo.cjs` 重建。
- 不要手改 `.ua/knowledge-graph.json`；要补节点/边就写脚本（既有先例：`.ua/tools/app-root-node.cjs`、`data-add-tables.cjs`、`fix-import-edges.cjs`）。

## 改动的常见落点

- 阅读页：`ui/book/read/ReadBookActivity.kt`（1600 行，按菜单/事件分支改）+ `ui/book/read/page/**`
- 书源规则求值：`model/analyzeRule/AnalyzeRule.kt`（按规则前缀分派 XPath / JSoup / JSONPath / Rhino）
- 本地书籍：`model/localBook/LocalBook.kt` 门面 + `BaseLocalBookParse` 的 `TextFile`/`EpubFile`/`MobiFile`/`PdfFile`/`UmdFile` 实现
- 全局配置：`help/config/AppConfig.kt` ↔ `constant/PreferKey.kt` ↔ `res/xml/pref_*.xml`，**三处要一起改**，默认值三处保持一致
- 数据库：`data/AppDatabase.kt` + `data/dao/**`；改表结构必须加 `DatabaseMigrations` 里的 Migration 并升 `version`

## 提交

- 中文 commit message，格式 `<type>: <说明>`（`feat` / `fix` / `ci` / `docs` / `chore` / `build`）。
- 不改写已推送的历史（不用 `--amend`、不强推）；修正用新提交。
