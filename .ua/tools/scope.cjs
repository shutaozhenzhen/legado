#!/usr/bin/env node
/**
 * scope.cjs — 为某个代码范围（目录前缀）构建 UA 所需的 scan-result.json。
 *
 * 用法:
 *   node .ua/tools/scope.cjs <scopeName> <scopePrefix>
 *   node .ua/tools/scope.cjs help  app/src/main/java/io/legado/app/help/
 *
 * 前置: .ua/intermediate/scan-full.json 已由 scan-project.mjs 生成。
 * 产物:
 *   .ua/scopes/<scopeName>-inventory.json   (完整文件清单 + analysisPaths)
 *   .ua/scopes/<scopeName>-importmap.json   (extract-import-map.mjs 输出)
 *   .ua/scopes/<scopeName>-scan-result.json (compute-batches 的输入)
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const [scopeName, scopePrefixRaw] = process.argv.slice(2);
if (!scopeName || !scopePrefixRaw) {
  console.error('Usage: node scope.cjs <scopeName> <scopePrefix>');
  process.exit(1);
}
const scopePrefixes = scopePrefixRaw.split(/[;,]/).map((v) => v.replace(/\\/g, '/').replace(/\/?$/, '/')).filter(Boolean);
const root = process.cwd();
const skillDir = 'C:\\Users\\lv\\.agents\\skills\\understand';

const full = JSON.parse(fs.readFileSync('.ua/intermediate/scan-full.json', 'utf8'));
// 排除分析产物目录（含嵌套的 .ua/）
const inScope = (f) => scopePrefixes.some((p) => f.path.startsWith(p)) && !f.path.includes('/.ua/');
const code = full.files.filter((f) => inScope(f) && f.fileCategory === 'code');
const docs = full.files.filter((f) => inScope(f) && f.fileCategory === 'docs');
const scope = [...code, ...docs];
const scopePaths = new Set(scope.map((f) => f.path));

fs.mkdirSync('.ua/scopes', { recursive: true });
fs.writeFileSync(
  `.ua/scopes/${scopeName}-inventory.json`,
  JSON.stringify({ projectRoot: root, files: full.files, analysisPaths: [...scopePaths] }, null, 2),
);
execFileSync(process.execPath, [
  `${skillDir}\\extract-import-map.mjs`,
  `.ua/scopes/${scopeName}-inventory.json`,
  `.ua/scopes/${scopeName}-importmap.json`,
], { stdio: 'inherit' });

const im = JSON.parse(fs.readFileSync(`.ua/scopes/${scopeName}-importmap.json`, 'utf8'));
const importMap = {};
for (const [k, v] of Object.entries(im.importMap || {})) if (scopePaths.has(k)) importMap[k] = v;

const byLanguage = {};
const byCategory = {};
for (const f of scope) {
  byLanguage[f.language] = (byLanguage[f.language] || 0) + 1;
  byCategory[f.fileCategory] = (byCategory[f.fileCategory] || 0) + 1;
}
const out = {
  scriptCompleted: true,
  contentDigest: full.contentDigest,
  projectRoot: root,
  files: scope,
  totalFiles: scope.length,
  filteredByIgnore: full.filteredByIgnore,
  estimatedComplexity: scope.length > 120 ? 'large' : scope.length > 40 ? 'moderate' : 'small',
  stats: { filesScanned: scope.length, byCategory, byLanguage },
  importMap,
};
fs.writeFileSync(`.ua/scopes/${scopeName}-scan-result.json`, JSON.stringify(out, null, 2));
console.log(
  `[scope ${scopeName}] files=${scope.length} code=${code.length} docs=${docs.length} ` +
  `importEdges=${Object.values(importMap).reduce((a, b) => a + b.length, 0)}`,
);
