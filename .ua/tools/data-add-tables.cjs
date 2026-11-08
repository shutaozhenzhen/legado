const fs=require('fs');
const p='.ua/scopes/data-assembled.json';
const g=JSON.parse(fs.readFileSync(p,'utf8'));
const specs=[
 ["app/src/main/java/io/legado/app/data/entities/Book.kt","books","Book"],
 ["app/src/main/java/io/legado/app/data/entities/BookGroup.kt","book_groups","BookGroup"],
 ["app/src/main/java/io/legado/app/data/entities/BookSource.kt","book_sources","BookSource"],
];
const have=new Set(g.nodes.map(n=>n.id));
let added=0, edges=0;
for(const [filePath,table,cls] of specs){
  const tid=`table:${filePath}:${table}`;
  if(!have.has(tid)){
    g.nodes.push({id:tid,type:'table',name:table,filePath,lineRange:null,summary:`Room 表 ${table}：由 @Entity ${cls} 映射，字段与索引定义见实体类；表结构随 AppDatabase 版本迁移演进。`,tags:['room','table','entity'],complexity:'simple'});
    have.add(tid); added++;
  }
  const fid=`file:${filePath}`;
  const ed=`${fid}->${tid}`;
  if(!g.edges.some(e=>e.source===fid&&e.target===tid)){
    g.edges.push({source:fid,target:tid,type:'defines_schema',direction:'forward',weight:0.8}); edges++;
  }
}
fs.writeFileSync(p, JSON.stringify(g,null,2));
console.log('added nodes',added,'edges',edges,'total',g.nodes.length,g.edges.length);
