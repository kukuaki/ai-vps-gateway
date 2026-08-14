const translations = {
  zh: {
    documentTitle: "AI VPS Gateway | 本机优先的 MCP VPS 运维网关",
    skipLink: "跳到主要内容",
    primaryNavigation: "主导航",
    projectLinks: "项目链接",
    navProduct: "产品",
    navWorkflow: "流程",
    navSecurity: "边界",
    navOpenSource: "开源",
    navLocal: "仅本机",
    heroEyebrow: "本机优先的 MCP 控制平面",
    heroTitleOne: "运维",
    heroTitleTwo: "跟上",
    heroTitleThree: "上下文。",
    heroLead: "让 Codex 和 Claude Code 通过一个本机网关，管理你的 VPS、项目与运维知识。",
    heroPrimary: "下载 macOS 版本",
    heroSecondary: "查看源代码",
    consoleLive: "运行中",
    consoleKeyOne: "会话",
    consoleKeyTwo: "目标",
    consoleKeyThree: "审计",
    consoleNote: "私钥留在你的 Mac。AI 只获得被记录的执行路径。",
    scrollHint: "向下探索",
    demoDisclaimer: "展示图使用仓库内演示数据和保留 IP 地址。",
    productEyebrow: "一个本机运维上下文",
    productTitleOne: "不是再造一个",
    productTitleTwo: "终端。",
    productTitleThree: "是让每一次",
    productTitleFour: "动手",
    productTitleFive: "都有上下文。",
    productCopy: "服务器、端口、运行方式、公开入口和变更边界不再散落在不同会话里。网关把它们连成可查询、可审计的本机运维上下文。",
    signalCardOneTitle: "先知道它活着",
    signalCardOneCopy: "TCP、SSH Banner 和 HTTP(S) 共同判断状态，不把 ICMP Ping 当成唯一答案。",
    signalCardOneFoot: "健康 / 性能",
    signalCardTwoTitle: "再知道该碰什么",
    signalCardTwoCopy: "技术栈、服务、端口、域名入口和排错顺序，留在能被下一次会话读懂的项目档案里。",
    signalCardTwoFoot: "Runbook / 上下文",
    signalCardThreeTitle: "最后让 AI 动手",
    signalCardThreeCopy: "每台 VPS 独占租约，会话排队，命令脱敏审计，私钥永远不进入 Codex 或 Claude。",
    signalCardThreeFoot: "租约 / 审计",
    fleetEyebrow: "VPS 资产 / 信号",
    fleetTitle: "一台 VPS 可以没有网站，但不能没有状态。",
    fleetCopy: "手动登记资产，完成 SSH 绑定，再让网关按 TCP、SSH Banner 和 HTTP(S) 检查状态。性能快照和趋势留在本机，不需要给每台服务器安装常驻 Agent。",
    fleetPointOne: "不把 ICMP Ping 当成唯一在线判据",
    fleetPointTwo: "直连模式可绕过本机 TUN 的 SSH 误告警",
    fleetPointThree: "CPU、内存、磁盘与负载的历史趋势",
    dashboardAlt: "演示数据中的服务器仪表盘，展示健康状态和性能趋势",
    dashboardCaption: "VPS 清单、非 ICMP 依赖的测活、当前性能和阈值告警。",
    runbookEyebrow: "项目上下文 / Runbook",
    runbookTitle: "每次部署，留下下一位维护者能用的答案。",
    runbookCopy: "项目档案保存技术栈、服务管理器、端口映射、Web 入口和五段式 Runbook。后续 AI 会话先读上下文，再申请会话和执行操作。",
    runbookLink: "查看项目结构",
    projectsAlt: "演示项目的运维 Runbook、技术栈和服务清单",
    projectsCaption: "项目档案将服务、端口、入口与 Runbook 保留在同一个本机记录中。",
    workflowEyebrow: "更小的运维闭环",
    workflowTitle: "从首次绑定，到一次可复盘的 AI 运维。",
    workflowOneTitle: "添加并绑定",
    workflowOneCopy: "新 VPS 自动生成专用公钥。你只需通过云控制台或已有入口完成一次安装，再点击测试绑定。",
    workflowTwoTitle: "盘点并沉淀",
    workflowTwoCopy: "只读盘点 Docker、systemd、PM2、端口和 Nginx 路由，生成可编辑的项目档案与 Runbook。",
    workflowThreeTitle: "AI 申请独占会话",
    workflowThreeCopy: "同一台 VPS 同时仅一个执行会话，其余请求排队。AI 不会得到私钥或本机任意 SSH 路径。",
    workflowFourTitle: "执行后可追溯",
    workflowFourCopy: "命令、结果和高危提示经过脱敏后进入审计记录，运维摘要与 Runbook 留作后续上下文。",
    terminalState: "就绪",
    securityEyebrow: "安全模型 / 不说营销话",
    securityTitleOne: "No key.",
    securityTitleTwo: "No guessing.",
    securityTitleThree: "No loose ends.",
    securityIntro: "本机控制边界，不是“绝对安全”的包装。每一次执行都要经过网关、租约和审计。",
    securityOneTitle: "私钥不交给 AI",
    securityOneCopy: "凭据由本机网关持有，MCP 客户端只能请求受控操作。",
    securityTwoTitle: "受租约的 SSH 执行",
    securityTwoCopy: "每台 VPS 有独占会话、排队、空闲超时和最长时限。",
    securityThreeTitle: "高危操作可见",
    securityThreeCopy: "常见不可逆命令被阻断，高危行为留下审计警告。",
    securityFourTitle: "边界说清楚",
    securityFourCopy: "它不是 OS 沙箱。同一 macOS 用户下的不受信任进程仍应被隔离。",
    metricsEyebrow: "让下一步动作足够明确",
    metricsTitle: "先读状态，再让 Agent 动手。",
    metricsCopy: "网关为后续会话提供当前性能、健康检查、项目关联与已执行操作。AI 的执行入口仍是 MCP，而不是把私钥复制进每一个会话。",
    metricsLink: "查看 MCP 使用方式",
    metricsAlt: "演示 VPS 的健康检查、性能趋势和 AI 会话状态",
    metricsCaption: "性能、健康、项目盘点和 AI 会话在同一台 VPS 详情中汇合。",
    installEyebrow: "开源 / 默认仅本机访问",
    installTitle: "让本机成为你的控制平面。",
    installCopy: "桌面客户端把本机 API、WebUI、MCP 适配器和菜单栏入口合在一起。源码模式同样保持 API 仅监听 loopback。",
    installPrimary: "下载最新 macOS 版本",
    installSecondary: "在 GitHub 查看项目",
    installTerminalNote: "MCP / loopback / 可审计",
    footerCopy: "MIT 许可证。为本机优先的 AI VPS 运维而构建。",
    footerRelease: "发布版本",
    footerSecurity: "安全策略"
  },
  en: {
    documentTitle: "AI VPS Gateway | Local-first MCP control plane",
    skipLink: "Skip to main content",
    primaryNavigation: "Primary navigation",
    projectLinks: "Project links",
    navProduct: "Product",
    navWorkflow: "Protocol",
    navSecurity: "Boundary",
    navOpenSource: "Open source",
    navLocal: "LOCAL ONLY",
    heroEyebrow: "LOCAL-FIRST MCP CONTROL PLANE",
    heroTitleOne: "Operate",
    heroTitleTwo: "at the speed",
    heroTitleThree: "of context.",
    heroLead: "Give Codex and Claude Code one local gateway for your VPS fleet, projects, and operating knowledge.",
    heroPrimary: "Download for macOS",
    heroSecondary: "View source",
    consoleLive: "LIVE",
    consoleKeyOne: "SESSION",
    consoleKeyTwo: "TARGET",
    consoleKeyThree: "AUDIT",
    consoleNote: "Private keys stay on your Mac. AI receives a recorded execution path.",
    scrollHint: "Explore below",
    demoDisclaimer: "All screenshots use repository demo data and documentation-only IP ranges.",
    productEyebrow: "ONE LOCAL OPERATIONS CONTEXT",
    productTitleOne: "Not another",
    productTitleTwo: "terminal.",
    productTitleThree: "A context layer for",
    productTitleFour: "every move",
    productTitleFive: "you make.",
    productCopy: "Hosts, ports, deployment methods, public endpoints, and change boundaries no longer live in separate conversations. The gateway joins them into searchable, auditable local operations context.",
    signalCardOneTitle: "Know it is alive",
    signalCardOneCopy: "TCP, SSH banners, and HTTP(S) work together. ICMP ping is not the only answer.",
    signalCardOneFoot: "HEALTH / METRICS",
    signalCardTwoTitle: "Know what to touch",
    signalCardTwoCopy: "Stack details, services, ports, public endpoints, and troubleshooting order stay in a project record the next session can read.",
    signalCardTwoFoot: "RUNBOOK / CONTEXT",
    signalCardThreeTitle: "Then let AI operate",
    signalCardThreeCopy: "One VPS, one lease, queued sessions, redacted audit trails. Private keys never enter Codex or Claude.",
    signalCardThreeFoot: "LEASE / AUDIT",
    fleetEyebrow: "VPS INVENTORY / SIGNALS",
    fleetTitle: "A VPS may have no website, but it should always have a known state.",
    fleetCopy: "Register assets manually, complete SSH binding once, then let the gateway evaluate TCP, SSH banners, and HTTP(S). Snapshots and trends stay local, with no permanent agent on every server.",
    fleetPointOne: "Do not treat ICMP ping as the only availability signal",
    fleetPointTwo: "Direct mode avoids false SSH alerts caused by a local TUN route",
    fleetPointThree: "Track CPU, memory, disk, and load trends",
    dashboardAlt: "Demo server dashboard showing health status and performance trends",
    dashboardCaption: "VPS inventory, liveness without an ICMP dependency, current metrics, and threshold alerts.",
    runbookEyebrow: "PROJECT CONTEXT / RUNBOOK",
    runbookTitle: "Every deployment leaves the next maintainer an answer they can use.",
    runbookCopy: "Project records retain stack details, service managers, port mappings, web endpoints, and a five-part Runbook. Later AI sessions read that context before leasing a session and operating the host.",
    runbookLink: "Inspect the project shape",
    projectsAlt: "Demo project Runbook, technology stack, and service inventory",
    projectsCaption: "One local project record joins services, ports, endpoints, and the Runbook.",
    workflowEyebrow: "A SMALLER OPERATIONS LOOP",
    workflowTitle: "From initial binding to an AI operation you can review later.",
    workflowOneTitle: "Add and bind",
    workflowOneCopy: "A new VPS gets a dedicated public key. Install it once through a cloud console or an existing path, then test the binding.",
    workflowTwoTitle: "Inventory and retain",
    workflowTwoCopy: "Read-only discovery collects Docker, systemd, PM2, ports, and Nginx routes to generate editable project records and Runbooks.",
    workflowThreeTitle: "AI leases the VPS",
    workflowThreeCopy: "Only one execution session is active on a VPS. Later requests queue, and AI never receives a private key or arbitrary local SSH path.",
    workflowFourTitle: "Trace what happened",
    workflowFourCopy: "Redacted commands, results, and high-risk notices become audit records, while operational summaries and Runbooks remain as future context.",
    terminalState: "READY",
    securityEyebrow: "SECURITY MODEL / NO MARKETING CLAIMS",
    securityTitleOne: "No key.",
    securityTitleTwo: "No guessing.",
    securityTitleThree: "No loose ends.",
    securityIntro: "A local control boundary, not a layer of absolute security. Every execution passes through the gateway, a lease, and an audit trail.",
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
    metricsLink: "Read the MCP guide",
    metricsAlt: "Demo VPS health check, performance trends, and AI session state",
    metricsCaption: "Metrics, health, project inventory, and AI sessions meet on one VPS detail view.",
    installEyebrow: "OPEN SOURCE / LOCAL BY DEFAULT",
    installTitle: "Make your Mac the control plane.",
    installCopy: "The desktop client combines the local API, WebUI, MCP adapter, and menubar entry point. Source mode keeps the API on loopback too.",
    installPrimary: "Download latest macOS release",
    installSecondary: "View on GitHub",
    installTerminalNote: "MCP / loopback / auditable",
    footerCopy: "MIT licensed. Built for local-first AI-assisted VPS operations.",
    footerRelease: "Releases",
    footerSecurity: "Security"
  }
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
document.documentElement.classList.add("js-enabled");

function preferredLanguage() {
  try {
    const saved = window.localStorage.getItem("ai-vps-gateway-site-language");
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  }
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
    toggle.setAttribute("aria-label", next === "zh" ? "切换到中文" : "Switch to English");
    const label = toggle.querySelector(".language-label");
    if (label) label.textContent = next === "zh" ? "中文" : "EN";
  }
}

function setupReveal() {
  const revealItems = document.querySelectorAll("[data-reveal]");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealItems.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );

  revealItems.forEach((element) => observer.observe(element));
}

function setupSignalCanvas() {
  const canvas = document.querySelector("#signal-canvas");
  const hero = document.querySelector(".hero");
  if (!canvas || !hero) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const pointer = { x: 0.5, y: 0.45 };
  const nodes = Array.from({ length: 18 }, (_, index) => ({
    x: (index * 0.173 + 0.08) % 1,
    y: (index * 0.317 + 0.13) % 1,
    phase: index * 0.72,
    size: index % 4 === 0 ? 2.2 : 1.2
  }));

  function resize() {
    const rect = hero.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(time) {
    const rect = hero.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const elapsed = reducedMotion ? 0 : time * 0.001;

    context.clearRect(0, 0, width, height);
    context.lineWidth = 1;

    context.strokeStyle = "rgba(215, 255, 66, 0.075)";
    for (let x = (width * 0.5) % 120; x < width; x += 120) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = (height * 0.5) % 120; y < height; y += 120) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    const positions = nodes.map((node) => ({
      x: width * node.x + Math.sin(elapsed * 0.35 + node.phase) * 18 + (pointer.x - 0.5) * 28,
      y: height * node.y + Math.cos(elapsed * 0.28 + node.phase) * 14 + (pointer.y - 0.5) * 22,
      size: node.size
    }));

    positions.forEach((from, index) => {
      positions.slice(index + 1).forEach((to) => {
        const distance = Math.hypot(from.x - to.x, from.y - to.y);
        if (distance > 230) return;
        context.strokeStyle = `rgba(158, 181, 255, ${Math.max(0.02, 0.17 - distance / 1500)})`;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      });
    });

    positions.forEach((node) => {
      context.fillStyle = "rgba(215, 255, 66, 0.82)";
      context.fillRect(node.x - node.size / 2, node.y - node.size / 2, node.size, node.size);
    });

    if (!reducedMotion) window.requestAnimationFrame(draw);
  }

  hero.addEventListener("pointermove", (event) => {
    const rect = hero.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width;
    pointer.y = (event.clientY - rect.top) / rect.height;
    document.documentElement.style.setProperty("--pointer-x", `${pointer.x * 100}%`);
    document.documentElement.style.setProperty("--pointer-y", `${pointer.y * 100}%`);
  });

  hero.addEventListener("pointerleave", () => {
    pointer.x = 0.5;
    pointer.y = 0.45;
    document.documentElement.style.setProperty("--pointer-x", "50%");
    document.documentElement.style.setProperty("--pointer-y", "45%");
  });

  window.addEventListener("resize", resize, { passive: true });
  resize();
  draw(0);
}

function setupHeader() {
  const header = document.querySelector(".site-header");
  if (!header) return;

  const update = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

let language = preferredLanguage();
applyLanguage(language);
setupReveal();
setupSignalCanvas();
setupHeader();

document.querySelector("#language-toggle")?.addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  try {
    window.localStorage.setItem("ai-vps-gateway-site-language", language);
  } catch {
    // Language preference is optional when storage is unavailable.
  }
  applyLanguage(language);
});
