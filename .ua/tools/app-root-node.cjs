#!/usr/bin/env node
/**
 * app-root-node.cjs — 补齐根包 App.kt 的图谱节点（UA 分 scope 时遗漏的唯一文件）。
 * 幂等：已存在 file 节点则跳过。写入 .ua/scopes/core-knowledge-graph.json 与 .ua/knowledge-graph.json。
 */
const fs = require('fs');

const P = 'app/src/main/java/io/legado/app/App.kt';
const FILE = `file:${P}`;
const CLASS = `class:${P}:App`;
const LOGGER = `class:${P}:EventLogger`;

const nodes = [
  {
    id: FILE, type: 'file', name: 'App.kt', filePath: P,
    summary: '应用入口 Application：进程级初始化装配台。onCreate 里串起崩溃捕获、日夜主题、生命周期回调、配置监听，然后异步初始化日志、Cronet 预下载、通知渠道、LiveEventBus、默认数据升级、卡顿/调度监控、OkHttp 替换 URL 流处理器、Rhino 脚本引擎、缓存清理与简繁转换引擎，最后按需从 WebDAV 同步阅读进度。',
    tags: ['android', 'application', 'startup', 'initialization'], complexity: 'complex',
  },
  {
    id: CLASS, type: 'class', name: 'App', filePath: P, lineRange: [67, 262],
    summary: 'Application 子类，进程唯一实例；持有旧 Configuration 用于检测 UI mode 变化并重应用日夜主题，同时声明 attachBaseContext 走 AppContextWrapper 做语言/主题包裹。',
    tags: ['android', 'application', 'lifecycle'], complexity: 'complex',
  },
  {
    id: LOGGER, type: 'class', name: 'EventLogger', filePath: P, lineRange: [237, 252],
    summary: 'LiveEventBus 的日志适配器，把事件总线日志转发到 LogUtils，TAG 固定为 [LiveEventBus]。',
    tags: ['logging', 'eventbus'], complexity: 'simple',
  },
  {
    id: `function:${P}:onCreate`, type: 'function', name: 'onCreate', filePath: P, lineRange: [71, 128],
    summary: '进程启动主流程：CrashHandler → applyDayNightInit → 生命周期与配置监听注册 → Coroutine.async 内做日志/Cronet/通知渠道/EventBus/默认数据/监控/Rhino/缓存清理/简繁转换/WebDAV 同步。',
    tags: ['startup', 'initialization', 'android'], complexity: 'complex',
  },
  {
    id: `function:${P}:attachBaseContext`, type: 'function', name: 'attachBaseContext', filePath: P, lineRange: [130, 132],
    summary: '用 AppContextWrapper 包裹 base Context，使全局资源（语言、主题）对所有 Activity 生效。',
    tags: ['android', 'context', 'theme'], complexity: 'simple',
  },
  {
    id: `function:${P}:onConfigurationChanged`, type: 'function', name: 'onConfigurationChanged', filePath: P, lineRange: [134, 141],
    summary: '比较新旧 Configuration 的 CONFIG_UI_MODE 位，变化时调用 applyDayNight 重设日夜主题。',
    tags: ['android', 'configuration', 'theme'], complexity: 'moderate',
  },
  {
    id: `function:${P}:installGmsTlsProvider`, type: 'function', name: 'installGmsTlsProvider', filePath: P, lineRange: [153, 174],
    summary: 'Android 10 以下尝试加载 GMS 的 ProviderInstallerImpl 作为首选 JCE Provider，让 OkHttp 在旧系统启用 TLSv1.3；失败静默。',
    tags: ['tls', 'gms', 'security'], complexity: 'moderate',
  },
  {
    id: `function:${P}:createNotificationChannels`, type: 'function', name: 'createNotificationChannels', filePath: P, lineRange: [179, 222],
    summary: 'Android 8+ 创建下载、朗读、Web 服务三个通知渠道（关闭灯/振动/声音，锁屏可见）。',
    tags: ['notification', 'android'], complexity: 'moderate',
  },
  {
    id: `function:${P}:initRhino`, type: 'function', name: 'initRhino', filePath: P, lineRange: [224, 235],
    summary: '注册 Rhino 的 WrapFactory：BookSource/RssSource/HttpTTS 用 NativeBaseSource 包装（可调 Java 方法），规则 DTO 与 BookChapter/ReadConfig 用 ReadOnlyJavaObject 只读包装。',
    tags: ['rhino', 'javascript', 'sandbox'], complexity: 'moderate',
  },
];

const edges = [
  { source: FILE, target: CLASS, type: 'contains', direction: 'forward', weight: 1.0 },
  { source: FILE, target: LOGGER, type: 'contains', direction: 'forward', weight: 1.0 },
  ...['onCreate', 'attachBaseContext', 'onConfigurationChanged', 'installGmsTlsProvider', 'createNotificationChannels', 'initRhino'].map((f) => ({
    source: FILE, target: `function:${P}:${f}`, type: 'contains', direction: 'forward', weight: 1.0,
  })),
  { source: FILE, target: CLASS, type: 'exports', direction: 'forward', weight: 0.8 },
  { source: FILE, target: LOGGER, type: 'exports', direction: 'forward', weight: 0.8 },
  { source: CLASS, target: LOGGER, type: 'contains', direction: 'forward', weight: 1.0 },
  ...['help/config/AppConfig.kt', 'help/CrashHandler.kt', 'data/AppDatabase.kt', 'base/AppContextWrapper.kt', 'help/rhino/NativeBaseSource.kt', 'constant/PreferKey.kt'].map((t) => ({
    source: FILE, target: `file:app/src/main/java/io/legado/app/${t}`, type: 'imports', direction: 'forward', weight: 0.7,
  })),
];

function patch(file) {
  if (!fs.existsSync(file)) { console.log(`skip missing ${file}`); return; }
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (g.nodes.some((n) => n.id === FILE)) { console.log(`${file}: already has App.kt`); return; }
  const ids = new Set(g.nodes.map((n) => n.id));
  const newNodes = nodes.filter((n) => !ids.has(n.id));
  g.nodes.push(...newNodes);
  const known = new Set(g.nodes.map((n) => n.id));
  const newEdges = edges.filter((e) => known.has(e.source) && known.has(e.target) && !g.edges.some((x) => x.source === e.source && x.target === e.target && x.type === e.type));
  g.edges.push(...newEdges);
  fs.writeFileSync(file, JSON.stringify(g));
  console.log(`${file}: +${newNodes.length} nodes, +${newEdges.length} edges`);
}

const targets = process.argv.slice(2);
if (!targets.length) {
  patch('.ua/scopes/core-knowledge-graph.json');
  patch('.ua/knowledge-graph.json');
} else for (const t of targets) patch(t);
