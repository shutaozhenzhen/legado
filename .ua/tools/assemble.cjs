#!/usr/bin/env node
/**
 * assemble.cjs — 把 assembled-graph + layers + tour 组装成 UA 知识图谱。
 *
 * 用法:
 *   node .ua/tools/assemble.cjs <scopeName> <layersFile> <tourFile> <graphTitle>
 *
 * 输入:
 *   .ua/intermediate/assembled-graph.json    (merge-batch-graphs.py 产出)
 *   <layersFile>                             (architecture-analyzer 产出)
 *   <tourFile>                               (tour-builder 产出)
 * 输出:
 *   .ua/scopes/<scopeName>-knowledge-graph.json
 */
const fs = require('fs');
const { execSync } = require('child_process');

const [scopeName, layersFile, tourFile, graphTitle, descriptionArg, graphPathArg] = process.argv.slice(2);
if (!scopeName || !layersFile || !tourFile || !graphTitle) {
  console.error('Usage: node assemble.cjs <scopeName> <layersFile> <tourFile> <graphTitle> [description]');
  process.exit(1);
}

const assembled = JSON.parse(fs.readFileSync(graphPathArg || '.ua/intermediate/assembled-graph.json', 'utf8'));
const layers = JSON.parse(fs.readFileSync(layersFile, 'utf8'));
const tour = JSON.parse(fs.readFileSync(tourFile, 'utf8'));
const gitCommitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

const nodeIds = new Set(assembled.nodes.map((n) => n.id));
const missingLayer = layers.flatMap((l) => l.nodeIds).filter((id) => !nodeIds.has(id));
const missingTour = tour.flatMap((t) => t.nodeIds).filter((id) => !nodeIds.has(id));

const graph = {
  version: '1.0.0',
  kind: 'codebase',
  project: {
    name: graphTitle,
    languages: ['kotlin', 'java', 'markdown'],
    frameworks: ['Android'],
    description:
      descriptionArg ||
      'legado 模块知识图谱（Understand-Anything 生成）。',
    analyzedAt: new Date().toISOString(),
    gitCommitHash,
  },
  nodes: assembled.nodes,
  edges: assembled.edges,
  layers,
  tour,
};

const out = `.ua/scopes/${scopeName}-knowledge-graph.json`;
fs.writeFileSync(out, JSON.stringify(graph, null, 2));

const byType = {};
for (const n of graph.nodes) byType[n.type] = (byType[n.type] || 0) + 1;
const byEdge = {};
for (const e of graph.edges) byEdge[e.type] = (byEdge[e.type] || 0) + 1;

console.log(`[assemble ${scopeName}] ${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
  `${layers.length} layers, ${tour.length} tour steps -> ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
console.log('  nodeTypes:', JSON.stringify(byType));
console.log('  edgeTypes:', JSON.stringify(byEdge));
if (missingLayer.length) console.warn('  WARN missing layer nodeIds:', missingLayer.slice(0, 5));
if (missingTour.length) console.warn('  WARN missing tour nodeIds:', missingTour.slice(0, 5));
