const fs = require('fs');
const core = require('C:/Users/lv/.understand-anything/repo/understand-anything-plugin/packages/core/dist/index.js');
for (const f of process.argv.slice(2)) {
  const g = JSON.parse(fs.readFileSync(f, 'utf8'));
  const r = core.validateGraph(g);
  console.log(f, '->', r.success ? 'OK' : 'FAIL', 'issues:', (r.issues||[]).length);
  for (const i of (r.issues||[]).slice(0,5)) console.log('   -', i.level, i.category, i.message.slice(0,120));
}
