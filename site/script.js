const translations = {
  zh: {
    documentTitle: "AI VPS Gateway | 本机优先的 MCP VPS 运维网关",
    skipLink: "跳到主要内容",
    primaryNavigation: "主导航",
    projectLinks: "项目链接",
    keyCapabilities: "核心能力",
    operationPath: "操作路径",
    navProduct: "产品",
    navWorkflow: "工作流",
    navSecurity: "安全边界",
    navOpenSource: "开源",
    navGithub: "GitHub",
    heroEyebrow: "本机优先的 MCP 控制平面",
    heroLead: "让 Codex 和 Claude Code 通过一个本机网关，管理你的 VPS、项目与运维知识。",
    heroCopy: "私钥留在你的 Mac。AI 获得的是受租约、审计和项目 Runbook 约束的执行路径。",
    heroPrimary: "下载 macOS 版本",
    heroSecondary: "查看源代码",
    proofOne: "每台 VPS 独占 AI 会话",
    proofTwo: "实时性能、测活与告警",
    proofThree: "可持续维护的项目 Runbook",
    demoDisclaimer: "展示图使用仓库内演示数据和保留 IP 地址。",
    signalAi: "AI 客户端",
    signalAiDetail: "Codex / Claude Code",
    signalGateway: "本机网关",
    signalGatewayDetail: "MCP、租约、审计",
    signalVps: "你的 VPS 集群",
    signalVpsDetail: "SSH、TCP、HTTP(S)",
    productEyebrow: "一个本机运维上下文",
    productTitle: "从“能登录”变成“知道该怎么维护”",
    productCopy: "服务器、端口、运行方式、公开入口和变更边界分属不同地方时，下一次部署往往只能重新猜。AI VPS Gateway 把这些信息连成可查询、可审计的本机运维上下文。",
    fleetEyebrow: "VPS 资产与信号",
    fleetTitle: "一台 VPS 可以没有网站，但不能没有状态",
    fleetCopy: "手动登记资产，先完成 SSH 绑定，再让网关按 TCP、SSH Banner 和 HTTP(S) 检查状态。性能快照和趋势留在本机，不需要给每台服务器安装常驻 Agent。",
    fleetPointOne: "不把 ICMP Ping 当成唯一在线判据",
    fleetPointTwo: "直连模式可绕过本机 TUN 的 SSH 误告警",
    fleetPointThree: "CPU、内存、磁盘与负载的历史趋势",
    dashboardAlt: "演示数据中的服务器仪表盘，展示健康状态和性能趋势",
    dashboardCaption: "VPS 清单、非 ICMP 依赖的测活、当前性能和阈值告警。",
    runbookEyebrow: "跨会话保留的项目上下文",
    runbookTitle: "每次部署，留下下一位维护者能用的答案",
    runbookCopy: "项目档案保存技术栈、服务管理器、端口映射、Web 入口和五段式 Runbook。后续的 AI 会话先读上下文，再申请会话和执行操作。",
    runbookPointOne: "Docker、systemd、PM2 和直接进程统一归档",
    runbookPointTwo: "Nginx 反代属于项目入口，不被误判为独立项目",
    runbookPointThree: "部署、验证、排错和变更边界可长期复用",
    projectsAlt: "演示项目的运维 Runbook、技术栈和服务清单",
    projectsCaption: "项目档案将服务、端口、入口与 Runbook 保留在同一个本机记录中。",
    workflowEyebrow: "更小、更清晰的运维闭环",
    workflowTitle: "从首次绑定到一次可复盘的 AI 运维",
    workflowOneTitle: "添加并绑定",
    workflowOneCopy: "新 VPS 自动生成专用公钥。你只需通过云控制台或已有入口完成一次安装，再点击测试绑定。",
    workflowTwoTitle: "盘点并沉淀",
    workflowTwoCopy: "只读盘点 Docker、systemd、PM2、端口和 Nginx 路由，生成可编辑的项目档案与 Runbook。",
    workflowThreeTitle: "AI 申请独占会话",
    workflowThreeCopy: "同一台 VPS 同时仅一个执行会话，其余请求排队。AI 不会得到私钥或本机任意 SSH 路径。",
    workflowFourTitle: "执行后可追溯",
    workflowFourCopy: "命令、结果和高危提示经过脱敏后进入审计记录，运维摘要与 Runbook 留作后续上下文。",
    securityEyebrow: "安全模型，不说营销话",
    securityTitle: "本机控制边界，而不是一层“绝对安全”的包装",
    securityOneTitle: "私钥不交给 AI",
    securityOneCopy: "凭据由本机网关持有，MCP 客户端只能请求受控操作。",
    securityTwoTitle: "受租约的 SSH 执行",
    securityTwoCopy: "每台 VPS 有独占会话、排队、空闲超时和最长时限。",
    securityThreeTitle: "高危操作可见",
    securityThreeCopy: "常见不可逆命令被阻断，高危行为留下审计警告。",
    securityFourTitle: "边界说清楚",
    securityFourCopy: "它不是 OS 沙箱。同一 macOS 用户下的不受信任进程仍应被隔离。",
    metricsEyebrow: "让下一步动作足够明确",
    metricsTitle: "先读状态，再让 Agent 动手",
    metricsCopy: "网关为后续会话提供当前性能、健康检查、项目关联与已执行操作。AI 的执行入口仍是 MCP，而不是把私钥复制进每一个会话。",
    metricsAlt: "演示 VPS 的健康检查、性能趋势和 AI 会话状态",
    metricsCaption: "性能、健康、项目盘点和 AI 会话在同一台 VPS 详情中汇合。",
    metricsLink: "查看 MCP 使用方式",
    installEyebrow: "开源，且默认仅本机访问",
    installTitle: "从源码运行，或直接下载 macOS 客户端",
    installCopy: "桌面客户端把本机 API、WebUI、MCP 适配器和菜单栏入口合在一起。源码模式同样保持 API 仅监听 loopback。",
    installPrimary: "下载最新 macOS 版本",
    installSecondary: "在 GitHub 查看项目",
    footerCopy: "MIT 许可证。为本机优先的 AI VPS 运维而构建。",
    footerRelease: "发布版本",
    footerSecurity: "安全策略"
  },
  en: {
    documentTitle: "AI VPS Gateway | Local-first MCP control plane",
    skipLink: "Skip to main content",
    primaryNavigation: "Primary navigation",
    projectLinks: "Project links",
    keyCapabilities: "Key capabilities",
    operationPath: "Operation path",
    navProduct: "Product",
    navWorkflow: "Workflow",
    navSecurity: "Security",
    navOpenSource: "Open source",
    navGithub: "GitHub",
    heroEyebrow: "LOCAL-FIRST MCP CONTROL PLANE",
    heroLead: "Give Codex and Claude Code one local gateway for your VPS fleet, projects, and operating knowledge.",
    heroCopy: "Private keys stay on your Mac. AI receives a leased, audited execution path with project Runbooks as context.",
    heroPrimary: "Download for macOS",
    heroSecondary: "View source",
    proofOne: "One active AI session per VPS",
    proofTwo: "Live metrics, health checks, and alerts",
    proofThree: "Project Runbooks that survive sessions",
    demoDisclaimer: "All screenshots use repository demo data and documentation-only IP ranges.",
    signalAi: "AI client",
    signalAiDetail: "Codex / Claude Code",
    signalGateway: "Local gateway",
    signalGatewayDetail: "MCP, lease, audit",
    signalVps: "Your VPS fleet",
    signalVpsDetail: "SSH, TCP, HTTP(S)",
    productEyebrow: "ONE LOCAL OPERATIONS CONTEXT",
    productTitle: "Move from “I can log in” to “I know how to maintain it.”",
    productCopy: "When hosts, ports, deployment methods, public endpoints, and change constraints live in different places, every deployment starts with guesswork. AI VPS Gateway joins them into searchable, auditable local operations context.",
    fleetEyebrow: "VPS INVENTORY AND SIGNALS",
    fleetTitle: "A VPS may have no website, but it should always have a known state.",
    fleetCopy: "Register assets manually, complete SSH binding once, then let the gateway evaluate TCP, SSH banners, and HTTP(S). Snapshots and trends stay local, with no permanent agent on every server.",
    fleetPointOne: "Do not treat ICMP ping as the only availability signal",
    fleetPointTwo: "Direct mode avoids false SSH alerts caused by a local TUN route",
    fleetPointThree: "Track CPU, memory, disk, and load trends",
    dashboardAlt: "Demo server dashboard showing health status and performance trends",
    dashboardCaption: "VPS inventory, liveness without an ICMP dependency, current metrics, and threshold alerts.",
    runbookEyebrow: "PROJECT CONTEXT THAT SURVIVES SESSIONS",
    runbookTitle: "Every deployment leaves the next maintainer an answer they can use.",
    runbookCopy: "Project records retain stack details, service managers, port mappings, web endpoints, and a five-part Runbook. Later AI sessions read that context before leasing a session and operating the host.",
    runbookPointOne: "Keep Docker, systemd, PM2, and direct processes together",
    runbookPointTwo: "Treat Nginx reverse routes as project endpoints, not phantom projects",
    runbookPointThree: "Reuse deployment, verification, troubleshooting, and guardrails",
    projectsAlt: "Demo project Runbook, technology stack, and service inventory",
    projectsCaption: "One local project record joins services, ports, endpoints, and the Runbook.",
    workflowEyebrow: "A SMALLER, CLEARER OPERATIONS LOOP",
    workflowTitle: "From initial binding to an AI operation you can review later",
    workflowOneTitle: "Add and bind",
    workflowOneCopy: "A new VPS gets a dedicated public key. Install it once through a cloud console or an existing path, then test the binding.",
    workflowTwoTitle: "Inventory and retain",
    workflowTwoCopy: "Read-only discovery collects Docker, systemd, PM2, ports, and Nginx routes to generate editable project records and Runbooks.",
    workflowThreeTitle: "AI leases the VPS",
    workflowThreeCopy: "Only one execution session is active on a VPS. Later requests queue, and AI never receives a private key or arbitrary local SSH path.",
    workflowFourTitle: "Trace what happened",
    workflowFourCopy: "Redacted commands, results, and high-risk notices become audit records, while operational summaries and Runbooks remain as future context.",
    securityEyebrow: "SECURITY MODEL, WITHOUT THE MARKETING CLAIMS",
    securityTitle: "A local control boundary, not a layer of “absolute security.”",
    securityOneTitle: "Private keys stay away from AI",
    securityOneCopy: "The local gateway owns credentials. MCP clients request controlled operations only.",
    securityTwoTitle: "Leased SSH execution",
    securityTwoCopy: "Each VPS has an exclusive session, queueing, idle expiry, and a maximum duration.",
    securityThreeTitle: "High-risk work is visible",
    securityThreeCopy: "Common irreversible commands are blocked, and high-risk actions leave an audit warning.",
    securityFourTitle: "The boundary is explicit",
    securityFourCopy: "This is not an OS sandbox. Untrusted processes under the same macOS user still need isolation.",
    metricsEyebrow: "MAKE THE NEXT ACTION OBVIOUS",
    metricsTitle: "Read the state before asking an agent to change it.",
    metricsCopy: "The gateway gives future sessions current metrics, health signals, project links, and prior operations. MCP remains the execution entry point instead of copying private keys into every conversation.",
    metricsAlt: "Demo VPS health check, performance trends, and AI session state",
    metricsCaption: "Metrics, health, project inventory, and AI sessions meet on one VPS detail view.",
    metricsLink: "Read the MCP guide",
    installEyebrow: "OPEN SOURCE, LOCAL BY DEFAULT",
    installTitle: "Run from source, or download the macOS client.",
    installCopy: "The desktop client combines the local API, WebUI, MCP adapter, and menubar entry point. Source mode keeps the API on loopback too.",
    installPrimary: "Download latest macOS release",
    installSecondary: "View on GitHub",
    footerCopy: "MIT licensed. Built for local-first AI-assisted VPS operations.",
    footerRelease: "Releases",
    footerSecurity: "Security"
  }
};

function preferredLanguage() {
  const saved = window.localStorage.getItem("ai-vps-gateway-site-language");
  if (saved === "zh" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function applyLanguage(language) {
  const messages = translations[language];
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = messages.documentTitle;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (key && messages[key]) element.textContent = messages[key];
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
    const key = element.dataset.i18nAlt;
    if (key && messages[key]) element.setAttribute("alt", messages[key]);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    const key = element.dataset.i18nAria;
    if (key && messages[key]) element.setAttribute("aria-label", messages[key]);
  });
  const toggle = document.querySelector("#language-toggle");
  if (toggle) {
    const next = language === "zh" ? "en" : "zh";
    toggle.textContent = next === "zh" ? "中文" : "EN";
    toggle.setAttribute("aria-label", next === "zh" ? "切换到中文" : "Switch to English");
  }
}

let language = preferredLanguage();
applyLanguage(language);

document.querySelector("#language-toggle")?.addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  window.localStorage.setItem("ai-vps-gateway-site-language", language);
  applyLanguage(language);
});
