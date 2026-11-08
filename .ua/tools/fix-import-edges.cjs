const fs=require('fs'),path=require('path');
const dir='.ua/scopes';
let total=0;
for(const f of fs.readdirSync(dir)){
  if(!/-(knowledge-graph|assembled)\.json$/.test(f)) continue;
  const p=path.join(dir,f); const g=JSON.parse(fs.readFileSync(p,'utf8'));
  let n=0;
  for(const e of g.edges){ if(e.type==='import'){ e.type='imports'; n++; } }
  if(n){ fs.writeFileSync(p, JSON.stringify(g,null,2)); }
  total+=n; console.log(`${f}: fixed ${n}`);
}
console.log('total', total);
