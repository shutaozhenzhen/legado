#!/usr/bin/env node
/**
 * assemble-repo.cjs — 把各 scope 图谱合并为仓库级 .ua/knowledge-graph.json
 *
 * 输入: .ua/scopes/{api,core,data,help,lib,model,service,ui,utils}-knowledge-graph.json
 * 输出: .ua/knowledge-graph.json
 *
 * 去重规则: node 以 id 去重(先到先得), edge 以 source|type|target 去重,
 *           任一端点不存在的边丢弃。层与导览在本脚本内重建(模块级 9 层 + 精选 14 步),
 *           不使用各 scope 自带 layers/tour。
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SCOPES = [
  { key: 'ui', dir: 'app/src/main/java/io/legado/app/ui/', name: '界面层', desc: 'Activity/Fragment/ViewModel 与全部页面：书架、阅读器与翻页排版、书源/替换/词典/RSS 管理、导入、发现、我的、自定义控件。' },
  { key: 'model', dir: 'app/src/main/java/io/legado/app/model/', name: '模型层', desc: '领域模型：书源规则解析(analyzeRule)、网络书源与 RSS 解析、本地书籍解析、阅读会话、远程书库(WebDAV)、缓存与下载。' },
  { key: 'help', dir: 'app/src/main/java/io/legado/app/help/', name: '支撑层', desc: '横切支撑：配置(AppConfig)、协程与事件、缓存、HTTP 与 Cookie、Glide 图片、JS 扩展、加解密、备份恢复、排版配置、更新。' },
  { key: 'data', dir: 'app/src/main/java/io/legado/app/data/', name: '数据层', desc: 'Room 数据库与迁移、21 个 DAO、@Entity 表、书源/书籍/RSS 实体与规则 JSON 列。' },
  { key: 'lib', dir: 'app/src/main/java/io/legado/app/lib/', name: '组件库', desc: '可复用组件：主题与主题化控件、prefs 与对话框、权限、MOBI/KF6/KF8 解析、cronet、icu4j 字符集检测、WebDAV 客户端。' },
  { key: 'utils', dir: 'app/src/main/java/io/legado/app/utils/', name: '工具库', desc: '通用工具：文件/编码/BOM、字符串与 JSON 扩展、SharedPreferences 缓存、位图与颜色、Canvas 录制与对象池、压缩包、View/Activity/WebView 扩展。' },
  { key: 'core', dir: 'app/src/main/java/io/legado/app/', name: '基础设施', desc: 'Activity/Fragment/ViewModel 基座、RecyclerView 适配器、偏好键与常量、异常体系、广播接收器、NanoHTTPD/WebSocket 内置服务；根包 App.kt 为进程入口。', prefixes: ['base', 'constant', 'exception', 'receiver', 'web', 'App.kt'] },
  { key: 'service', dir: 'app/src/main/java/io/legado/app/service/', name: '服务层', desc: '后台服务：Web 服务、下载、书源校验、听书/TTS、缓存书籍、导出书籍、定时任务。' },
  { key: 'api', dir: 'app/src/main/java/io/legado/app/api/', name: '进程间接口', desc: 'ContentProvider/ShortCuts 等对外入口：ReaderProvider、BookController、书源/RSS/替换规则控制器与统一 ReturnData 契约。' },
];

const now = new Date().toISOString();
const gitCommitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

const nodes = new Map();
const edges = new Map();
const perScope = {};

for (const s of SCOPES) {
  const file = `.ua/scopes/${s.key}-knowledge-graph.json`;
  if (!fs.existsSync(file)) { console.warn(`missing scope graph: ${file}`); continue; }
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  perScope[s.key] = { nodes: g.nodes.length, edges: g.edges.length, layers: (g.layers || []).length, tour: (g.tour || []).length };
  for (const n of g.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
  for (const e of g.edges) {
    const k = `${e.source}|${e.type}|${e.target}`;
    if (!edges.has(k)) edges.set(k, e);
  }
}

const keptEdges = [];
let dropped = 0;
for (const e of edges.values()) {
  if (nodes.has(e.source) && nodes.has(e.target)) keptEdges.push(e);
  else dropped++;
}

// ── 模块层：按 scopes 定义分配 file/document 节点 ──────────────────
const layers = [];
const inLayer = new Set();
for (const s of SCOPES) {
  const ids = [];
  for (const n of nodes.values()) {
    if (n.type !== 'file' && n.type !== 'document') continue;
    const p = n.filePath || '';
    let hit = false;
    if (s.prefixes) {
      hit = s.prefixes.some((pre) =>
        pre.endsWith('.kt')
          ? p === `app/src/main/java/io/legado/app/${pre}`
          : p.startsWith(`app/src/main/java/io/legado/app/${pre}/`)
      );
    } else {
      hit = p.startsWith(s.dir);
    }
    if (hit && !inLayer.has(n.id)) { ids.push(n.id); inLayer.add(n.id); }
  }
  ids.sort();
  layers.push({
    id: `layer:${s.key}`,
    name: s.name,
    description: s.desc,
    nodeIds: ids,
  });
}
const assigned = layers.reduce((a, l) => a + l.nodeIds.length, 0);
const fileTotal = [...nodes.values()].filter((n) => n.type === 'file' || n.type === 'document').length;
console.log(`file/document nodes: ${fileTotal}, assigned to module layers: ${assigned}`);

// ── 导览：14 步，按 filePath 后缀解析 ─────────────────────────────
const STEPS = [
  {
    title: '从主界面外壳开始',
    files: ['ui/main/MainActivity.kt', 'ui/main/MainFragmentInterface.kt'],
    lesson: 'Android 的「屏幕」是 Activity：系统按 onCreate→onStart→onResume 驱动它。legado 用 ViewPager2 + BottomNavigationView 承载书架/发现/RSS/我的四个页签，每个页签只是一个 Fragment。',
    text: 'MainActivity 把底部导航、四个页签和启动期事务（更新、隐私政策、崩溃上报、WebDAV 自动备份）串起来；它下面的所有页面都只是被这个壳装载的 Fragment。',
  },
  {
    title: '书架：分组、网格与选择态',
    files: ['ui/main/bookshelf/BaseBookshelfFragment.kt', 'ui/main/bookshelf/style1/BookshelfFragment1.kt', 'ui/main/bookshelf/BookshelfViewModel.kt'],
    lesson: 'Fragment 是「可复用的界面片段」，生命周期跟随宿主 Activity；ViewModel 则在配置变更（旋转、主题切换）时存活，用来持有列表状态。',
    text: '书架按分组 Tab 展示书籍，网格/列表两套布局共用同一套选择态与长按菜单；数据来自数据层的 BookDao Flow。',
  },
  {
    title: '打开一本书：阅读页调度',
    files: ['ui/book/read/ReadBookActivity.kt', 'model/ReadBook.kt'],
    lesson: '阅读页把「排版」与「渲染」拆开：ReadBook 负责阅读进度、章节切换、朗读等会话状态，Activity 只做界面与菜单。',
    text: 'ReadBookActivity 是最大的单个文件（1600 行），负责 ViewPager 章节容器、阅读菜单、手势与设置联动；真正的阅读会话状态在 model/ReadBook。',
  },
  {
    title: '排版引擎：从章节文本到屏幕分页',
    files: ['ui/book/read/page/provider/ChapterProvider.kt', 'ui/book/read/page/provider/TextPageFactory.kt'],
    lesson: '分页是「测量」问题：给定字体、行距、页边距，用 TextPaint 逐行测量文本，把章节切成若干页。这也是为什么改字号后要重建 TextChapter。',
    text: 'ChapterProvider 负责取章节文本、处理标题与正文、插入图片与注释；TextPageFactory 再把文本按当前排版配置切成 TextPage。',
  },
  {
    title: '书源规则的执行者：AnalyzeRule',
    files: ['model/analyzeRule/AnalyzeRule.kt', 'model/analyzeRule/AnalyzeUrl.kt'],
    lesson: 'legado 的书源是「数据 + 规则字符串」：@css/@xpath/@json/@js 前缀决定用哪个后端求值。AnalyzeRule 就是这条规则管线的调度器。',
    text: 'AnalyzeRule 持有内容、基准 URL、书籍/章节与规则变量上下文，缓存拆分后的规则、正则与编译脚本，并把求值分派到 XPath、JSoup、JSONPath 或 Rhino。',
  },
  {
    title: '网络书源：搜索、详情、目录、正文',
    files: ['model/webBook/WebBook.kt', 'model/webBook/BookList.kt', 'model/webBook/BookContent.kt'],
    lesson: '书源的四个动作对应四个规则组：搜索(explore/search)、详情(info)、目录(toc)、正文(content)。每一步都是「发请求 → 按规则取字段」。',
    text: 'WebBook 把书源规则翻译成 HTTP 请求，再用 AnalyzeRule 解析响应；BookList/BookInfo/BookChapterList/BookContent 分别覆盖搜索列表、详情、目录与正文。',
  },
  {
    title: '书源与规则长什么样：数据模型',
    files: ['data/entities/BookSource.kt', 'data/entities/rule/BookInfoRule.kt', 'data/entities/rule/TocRule.kt'],
    lesson: 'Room 实体用 @Entity 映射表；六套规则以 JSON 列存储，由 Converters 用 Gson 序列化，坏数据退化为 null 而不是崩溃。',
    text: 'BookSource 是书源的全部配置：URL、请求头、六套规则、登录与发现地址；BookSourcePart 是列表页的轻量投影，把 hasLoginUrl/hasExploreUrl 下推成 SQL 计算列。',
  },
  {
    title: '数据层：Room 与 DAO',
    files: ['data/AppDatabase.kt', 'data/dao/BookSourceDao.kt', 'data/dao/BookDao.kt'],
    lesson: 'Room 在编译期校验 SQL：@Dao 接口里的 @Query 会生成实现类；返回 Flow/LiveData 的查询可观察，表变了会自动重新发射。',
    text: 'AppDatabase 装配 21 张表与 31 段迁移；BookSourceDao 处理书源分组（逗号拼接字符串的四态匹配）、批量启停与排序；BookDao 提供书架 Flow 与分组统计。',
  },
  {
    title: '配置与偏好键：AppConfig 与 PreferKey',
    files: ['help/config/AppConfig.kt', 'constant/PreferKey.kt'],
    lesson: 'Android 的 SharedPreferences 是键值存储；legado 用 PreferKey 集中声明键名、AppConfig 提供类型化读写与默认值，避免字符串散落。',
    text: 'AppConfig 是全局配置门面（阅读、主题、备份、网络…），PreferKey 声明近 200 个键；设置页 SwitchPreference 的 key 直接引用这些常量。',
  },
  {
    title: '网络与缓存：HttpHelper 一路到 Cookie',
    files: ['help/http/HttpHelper.kt', 'help/http/CookieStore.kt', 'help/CacheManager.kt'],
    lesson: 'OkHttp 的拦截器链把请求逐层加工：加请求头、读缓存、存 Cookie。legado 用自定义 CookieJar 把 Cookie 落到 Room，书源登录态才能跨进程复用。',
    text: 'HttpHelper 封装 OkHttp 客户端与并发策略；CookieStore 把 Cookie 持久化；CacheManager 管理章节与图片缓存。',
  },
  {
    title: '本地书籍：TXT / EPUB / MOBI / PDF 统一入口',
    files: ['model/localBook/LocalBook.kt', 'model/localBook/EpubFile.kt', 'model/localBook/TextFile.kt'],
    lesson: '策略模式：BaseLocalBookParse 定义 upBookInfo/getChapterList/getContent/getImage 四个契约方法，各格式用 companion object 实现，LocalBook 按扩展名分发。',
    text: 'LocalBook 是本地书门面：导入、解析、取正文、生成封面都从这里进；EpubFile/MobiFile/PdfFile/UmdFile 各管一种容器格式，纯文本走 TextFile。',
  },
  {
    title: '导入本地书：从目录扫描到分组',
    files: ['ui/book/import/local/ImportBookViewModel.kt', 'ui/book/import/local/ImportBookActivity.kt'],
    lesson: 'SAF(DocumentFile) 让应用在无存储权限时也能读写用户选择的目录；这里用它递归扫描目录、按父文件夹名建分组。',
    text: 'ImportBookActivity 浏览目录，ImportBookViewModel 批量导入并按 folderName 映射到 BookGroup；分组按名字复用，同名目录会合并。',
  },
  {
    title: '基础设施：基类、常量与内置 Web 服务',
    files: ['base/BaseActivity.kt', 'base/BaseViewModel.kt', 'web/HttpServer.kt', 'exception/NoStackTraceException.kt'],
    lesson: 'NanoHTTPD 是一个单文件嵌入式 HTTP 服务器；legado 用它在本机提供 Web 阅读界面与书源调试接口，端口与路由都在 HttpServer 里。',
    text: 'BaseActivity/BaseViewModel 统一主题、系统栏、协程作用域；HttpServer 提供 15 个 POST/12 个 GET 路由；NoStackTraceException 用于解析/导入失败时省掉堆栈开销。',
  },
  {
    title: '后台能力：服务、RSS 与进程间入口',
    files: ['service/AudioPlayService.kt', 'model/rss/Rss.kt', 'api/controller/BookController.kt'],
    lesson: 'Service 是没有界面的长生命周期组件，适合播放、下载这类任务；ContentProvider(ReaderProvider) 则把应用数据以 URI 暴露给桌面小组件等外部调用方。',
    text: 'AudioPlayService 承担听书与 TTS；Rss 与两个解析器处理订阅源；BookController 通过 ReaderProvider 暴露书架/阅读进度给外部。',
  },
];

const nodeByPath = new Map();
for (const n of nodes.values()) {
  if (n.type === 'file' && n.filePath) nodeByPath.set(n.filePath, n.id);
}

const tour = [];
const used = new Set();
for (const st of STEPS) {
  const ids = [];
  for (const suf of st.files) {
    const hits = [...nodeByPath.entries()].filter(([p]) => p.endsWith(suf) && !used.has(nodeByPath.get(p)));
    if (!hits.length) { console.warn(`tour: no file node for ${suf}`); continue; }
    const id = hits[0][1];
    used.add(id);
    ids.push(id);
  }
  const step = { order: tour.length + 1, title: st.title, description: st.text, nodeIds: ids };
  if (st.lesson) step.languageLesson = st.lesson;
  tour.push(step);
}

const out = {
  version: '1.0.0',
  kind: 'codebase',
  project: {
    name: 'legado 全仓知识图谱',
    languages: ['kotlin', 'java', 'markdown', 'xml'],
    frameworks: ['Android'],
    description:
      '阅读 App legado（阅读3.0）的整体知识图谱：11 个模块、约 1000 个 Kotlin/Java 文件。覆盖 UI、模型、支撑、数据、组件库、工具、基础设施、服务与进程间接口，并与 Android 框架概念（Activity/Fragment/ViewModel、Room、SharedPreferences、Service、ContentProvider）对齐。',
    analyzedAt: now,
    gitCommitHash,
    nodeCount: nodes.size,
    edgeCount: keptEdges.length,
    scopes: perScope,
  },
  nodes: [...nodes.values()],
  edges: keptEdges,
  layers,
  tour,
};

fs.writeFileSync('.ua/knowledge-graph.json', JSON.stringify(out, null, 2));
const byType = {};
for (const n of nodes.values()) byType[n.type] = (byType[n.type] || 0) + 1;
const byEdge = {};
for (const e of keptEdges) byEdge[e.type] = (byEdge[e.type] || 0) + 1;
console.log(`repo graph: ${nodes.size} nodes, ${keptEdges.length} edges, ${layers.length} layers, ${tour.length} tour steps (dropped ${dropped} dangling edges)`);
console.log('nodeTypes', JSON.stringify(byType));
console.log('edgeTypes', JSON.stringify(byEdge));
const unassigned = fileTotal - assigned;
if (unassigned > 0) console.warn(`WARN: ${unassigned} file/document nodes not in any layer`);

