# 社区发帖草稿（只供人工审核）

**状态：草稿，不自动发布。** 发布前请由维护者确认项目已经公开、下载链接可用、截图脱敏，并根据社区规则调整标题和标签。

## LinuxDo / Linux.do

### 标题

开源一个本机优先的 AI VPS 网关：让 Codex / Claude 通过 MCP 管理服务器

### 正文

最近把自己的 VPS 运维流程整理成了一个本机工具：[AI VPS Gateway](https://github.com/kukuaki/ai-vps-gateway)。

它不是把 SSH 私钥交给 AI，而是在 Mac 上运行一个 loopback-only 网关：

- Codex 和 Claude Code 通过 stdio MCP 调用；
- 每台 VPS 同时只允许一个活动会话，其他请求排队；
- 私钥由本机网关保管，MCP 响应不返回私钥和内部凭据引用；
- 支持首次添加 VPS 后生成专属 Ed25519 公钥安装命令，再回到 WebUI 测试绑定；
- 不依赖 Ping，支持 TCP、SSH Banner、HTTP(S) 测活；
- 有当前性能、30 天趋势、阈值告警和高危操作审计；
- 项目档案记录技术栈、Docker/systemd/PM2 服务、端口、项目 Web 入口和五段 Runbook；
- macOS 客户端带菜单栏常驻和 MCP 设置入口。

当前定位仍是单机、本地控制，不做公网共享，也不安装常驻 VPS Agent。Shell 保留少量不可逆操作阻断，但不是完整沙箱；同一 macOS 用户下的其他进程仍不属于网关的隔离范围。

仓库里有双语 README、demo 数据脚本和 MCP E2E 测试。欢迎反馈真实运维场景，尤其是项目盘点、Nginx 共享入口归属和 Runbook 维护方面的问题。

### 发布前检查

- [ ] 使用最新 GitHub Release 链接
- [ ] 删除所有真实 VPS、域名、截图和日志
- [ ] 明确这是本地工具，不承诺绝对安全或完整 Shell 沙箱
- [ ] 遵守 Linux.do 当前版规，人工提交

## V2EX / Reddit / 其他社区

不要直接复制 LinuxDo 文案。根据目标社区分别强调：

- 开发者社区：MCP 工具边界、会话租约、审计与测试；
- macOS 社区：菜单栏客户端、首次 SSH 绑定和绕过 TUN 的直连模式；
- 运维社区：项目盘点、共享 Nginx 归属、端口与 Runbook；
- 安全社区：明确这是控制边界和审计层，不是操作系统沙箱。
