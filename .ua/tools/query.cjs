#!/usr/bin/env node
/**
 * query.cjs — 在 .ua/knowledge-graph.json 上做低 token 查询（替代 grep + 整文件阅读）。
 *
 * 用法:
 *   node .ua/tools/query.cjs search <关键词> [--limit N]      # 按 name/summary/tags/filePath 搜节点
 *   node .ua/tools/query.cjs show <nodeId>                    # 节点详情 + 邻居
 *   node .ua/tools/query.cjs file <path 片段>                 # 定位文件节点并列出其类/函数
 *   node .ua/tools/query.cjs impact <path 片段> [--depth N]   # 反向依赖：谁会受改动影响
 *   node .ua/tools/query.cjs hub [--limit N]                  # fan-in 最高的文件节点（改动的震中）
 *
 * 输出为紧凑文本，单次通常 < 1KB。图过期时（meta.json.gitCommitHash 与 HEAD 不同）会提示。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GRAPH = '.ua/knowledge-graph.json';
if (!fs.existsSync(GRAPH)) {
  console.error(`未找到 ${GRAPH}，先运行 node .ua/tools/assemble-repo.cjs`);
  process.exit(1);
}

const graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
const outAdj = new Map(); // id -> edges leaving
const inAdj = new Map(); // id -> edges entering
for (const e of graph.edges) {
  if (!outAdj.has(e.source)) outAdj.set(e.source, []);
  if (!inAdj.has(e.target)) inAdj.set(e.target, []);
  outAdj.get(e.source).push(e);
  inAdj.get(e.target).push(e);
}

function short(id) {
  return id.replace(/^(file|class|function|document|table):/, '').replace('app/src/main/java/io/legado/app/', '');
}
function one(n) {
  return `${n.type}:${short(n.id)}  [${n.tags ? n.tags.join(',') : ''}]`;
}
function brief(e) {
  const other = e.source === e.__src ? e.target : e.source;
  return `  ${e.type} -> ${short(other)}`;
}
function neighbors(id, limit = 8) {
  const outs = (outAdj.get(id) || []).filter((e) => e.type !== 'contains' && e.type !== 'exports');
  const ins = (inAdj.get(id) || []).filter((e) => e.type !== 'contains' && e.type !== 'exports');
  const lines = [];
  if (outs.length) {
    lines.push(`  出边(${outs.length}):`);
    for (const e of outs.slice(0, limit)) lines.push(`    ${e.type} -> ${short(e.target)}`);
  }
  if (ins.length) {
    lines.push(`  入边(${ins.length}):`);
    for (const e of ins.slice(0, limit)) lines.push(`    ${e.type} <- ${short(e.source)}`);
  }
  return lines.join('\n');
}

function checkFreshness() {
  try {
    const base = graph.project && graph.project.gitCommitHash;
    if (!base) return;
    // 只统计源码/资源变化；.ua/ 自身的提交不算过期
    const changed = execSync(`git diff --name-only ${base}..HEAD`, { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter((p) => p && !p.startsWith('.ua/'));
    if (changed.length) {
      console.error(`[stale] 图谱基线 ${base} 之后有 ${changed.length} 个源码文件变更（如 ${changed.slice(0, 3).join(', ')}）；结论可能过期，建议增量更新。`);
    }
  } catch {}
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i];
  else args.push(rest[i]);
}
checkFreshness();

switch (cmd) {
  case 'search': {
    const kw = (args[0] || '').toLowerCase();
    if (!kw) { console.error('用法: query.cjs search <关键词>'); process.exit(1); }
    const limit = Number(flags.limit || 12);
    const hits = [];
    for (const n of nodes.values()) {
      const hay = `${n.name} ${n.summary || ''} ${(n.tags || []).join(' ')} ${n.filePath || ''}`.toLowerCase();
      if (!hay.includes(kw)) continue;
      let score = 0;
      if ((n.name || '').toLowerCase() === kw) score += 6;
      else if ((n.name || '').toLowerCase().includes(kw)) score += 3;
      if ((n.filePath || '').toLowerCase().includes(kw)) score += 2;
      if (n.type === 'file' || n.type === 'class') score += 1;
      hits.push([score, n]);
    }
    hits.sort((a, b) => b[0] - a[0]);
    for (const [, n] of hits.slice(0, limit)) {
      console.log(one(n));
      console.log(`  ${(n.summary || '').slice(0, 120)}${n.lineRange ? `  @${n.lineRange[0]}-${n.lineRange[1]}` : ''}`);
    }
    if (hits.length > limit) console.log(`… 另有 ${hits.length - limit} 条，缩小关键词或加大 --limit`);
    break;
  }
  case 'show': {
    const n = nodes.get(args[0]) || [...nodes.values()].find((x) => short(x.id) === args[0]);
    if (!n) { console.error(`未找到节点 ${args[0]}`); process.exit(1); }
    console.log(one(n));
    console.log(n.summary || '');
    if (n.lineRange) console.log(`行号: ${n.lineRange[0]}-${n.lineRange[1]}  filePath: ${n.filePath || ''}`);
    for (const child of outAdj.get(n.id) || []) {
      if (child.type === 'contains' || child.type === 'defines_schema') console.log(`  ${child.type} -> ${short(child.target)}`);
    }
    console.log(neighbors(n.id, Number(flags.limit || 10)));
    break;
  }
  case 'file': {
    const frag = (args[0] || '').toLowerCase();
    const f = [...nodes.values()].find((n) => n.type === 'file' && (n.filePath || '').toLowerCase().includes(frag));
    if (!f) { console.error(`未找到文件节点，片段: ${args[0]}`); process.exit(1); }
    console.log(one(f));
    console.log(f.summary || '');
    const members = (outAdj.get(f.id) || []).filter((e) => e.type === 'contains' || e.type === 'defines_schema');
    for (const m of members) {
      const c = nodes.get(m.target);
      console.log(`  ${m.type} -> ${c ? short(c.id) : m.target}${c && c.lineRange ? ` @${c.lineRange[0]}-${c.lineRange[1]}` : ''}`);
    }
    console.log(neighbors(f.id, Number(flags.limit || 10)));
    break;
  }
  case 'impact': {
    const frag = (args[0] || '').toLowerCase();
    const target = [...nodes.values()].find((n) => n.type === 'file' && (n.filePath || '').toLowerCase().includes(frag));
    if (!target) { console.error(`未找到文件节点，片段: ${args[0]}`); process.exit(1); }
    const depth = Number(flags.depth || 2);
    console.log(`改动 ${short(target.id)} 的影响面（反向，深度 ${depth}）:`);
    let frontier = [target.id];
    const seen = new Set(frontier);
    for (let d = 1; d <= depth; d++) {
      const next = [];
      for (const id of frontier) {
        for (const e of inAdj.get(id) || []) {
          if (e.type === 'contains' || e.type === 'exports') continue;
          if (seen.has(e.source)) continue;
          seen.add(e.source); next.push(e.source);
          console.log(`  d${d} ${e.type} <- ${short(e.source)}`);
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    break;
  }
  case 'hub': {
    const limit = Number(flags.limit || 15);
    const files = [...nodes.values()].filter((n) => n.type === 'file');
    const scored = files.map((n) => {
      const fanIn = (inAdj.get(n.id) || []).filter((e) => e.type !== 'contains' && e.type !== 'exports').length;
      return [fanIn, n];
    });
    scored.sort((a, b) => b[0] - a[0]);
    for (const [fanIn, n] of scored.slice(0, limit)) console.log(`${String(fanIn).padStart(3)}  ${short(n.id)}`);
    break;
  }
  default:
    console.log('用法: node .ua/tools/query.cjs <search|show|file|impact|hub> <arg> [--limit N] [--depth N]');
}
