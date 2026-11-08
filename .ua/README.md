# `.ua/` — legado 知识图谱（Understand-Anything）

本目录是 [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) 为 legado 仓库生成的代码知识图谱，
供人或 AI 在不全文检索、不批量读文件的前提下快速建立「这仓库怎么组织、某功能在哪、改动会波及谁」的理解。

## 产物

| 文件 | 说明 |
|---|---|
| `knowledge-graph.json` | 全仓图谱：3732 个节点（814 file / 767 class / 2120 function / 21 table / 10 document）、5645 条边、9 个模块层、14 步导览。节点带中文 `summary` 与 `lineRange`，边带类型（contains/exports/imports/calls/inherits/implements/depends_on/defines_schema/migrates/serves/documents/related）。 |
| `meta.json` | 生成时间、基线 commit、覆盖的 scope、节点/边计数。 |
| `config.json` | dashboard 语言与自动更新开关（`outputLanguage: zh`）。 |
| `scopes/` | 各模块单独的图谱与切片产物（ui/model/help/data/lib/utils/core/service/api），可单独喂给 dashboard。 |
| `tools/` | 生成与查询脚本：`query.cjs`（search/show/file/impact/hub 五种低 token 查询）、`scope.cjs`（按前缀切 scope）、`assemble.cjs`（scope 图组装）、`assemble-repo.cjs`（全仓合并 + 模块层 + 导览）、`validate-graphs.cjs`（core `validateGraph` 校验）、`fix-import-edges.cjs`（修 importMap 回填边的 type 大小写）。 |

`intermediate/`、`tmp/`、`archive/` 是中间产物，不入库。

## 查询（推荐先跑这个，再决定读不读源码）

```bash
node .ua/tools/query.cjs search 书源           # 按名称/摘要/标签搜节点，带摘要与行号
node .ua/tools/query.cjs file BookSourceDao    # 文件摘要 + 成员清单（类/函数 + 行号）
node .ua/tools/query.cjs show <nodeId>         # 单节点详情 + 出入边
node .ua/tools/query.cjs impact AnalyzeRule    # 反向依赖：改这个文件会波及谁
node .ua/tools/query.cjs hub --limit 15        # fan-in 最高的文件（改动震中）
```

单次输出通常 < 1 KB，等价于一次 grep + 一次整文件阅读，但只花零头 token。图谱过期（基线之后有 `.ua/` 之外的改动）时会打印 `[stale]` 提示。

## 怎么用

1. **看**：`understand-dashboard` 技能起 dashboard（需 `GRAPH_DIR` 指向含 `.ua` 的目录），或 `understand-chat` 直接提问。
2. **查**：给 AI 的问题里点名节点，例如
   - 「`class:app/src/main/java/io/legado/app/model/analyzeRule/AnalyzeRule.kt:AnalyzeRule` 的求值流程」
   - 「改 `BookSourceDao` 会影响哪些 UI 页面」（看 imports/contains 反向边）
3. **scope 级图**：`scopes/` 下有各模块单独的 knowledge-graph（含各自的 layers/tour），默认不入库；`node .ua/tools/assemble-repo.cjs` 可随时重建全仓图。
4. **增量**：改动后用 `understand` 技能的 incremental 流程（`prepare-incremental.mjs` → 重跑受影响 batch → `finalize-incremental.mjs`），或整 scope 重跑并 `node .ua/tools/assemble-repo.cjs`。

## 已知局限

- 跨 scope 的边在 scope 合并阶段被丢弃（`merge-batch-graphs.py` 只保留两端都在本 scope 的边），因此全仓图里 `imports` 偏少（706 条），模块之间的耦合主要靠「模块层 + 导览 + 同名符号」推断。
- Kotlin 走 tree-sitter，重载方法合并为单节点；<10 行的 trivial 成员不建节点。
- `table` 节点只覆盖 `data/entities` 下 21 张 @Entity 表。
- 图谱是某次 commit 的快照；`meta.json.gitCommitHash` 与 `git rev-parse --short HEAD` 不一致时视为过期。

