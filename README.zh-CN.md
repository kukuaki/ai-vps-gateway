# AI VPS Gateway

[English](./README.md)

面向个人本机使用的 VPS 资产管理、健康监测和 MCP 网关。目标是让 Codex 与 Claude Code 经由统一网关安全管理服务器，而不是获得私钥或直接 SSH 权限。

## 当前范围

- 手动新增、编辑、维护和归档 VPS，数据保存在本机 SQLite。
- 从现有 `all-vps` 文档同步 VPS 清单与已知域名健康检查。
- 不依赖 Ping 的测活：TCP、SSH Banner、HTTP(S) 服务检查。
- 健康历史、当前性能快照、30 天性能历史、SVG 趋势图、阈值告警、审计事件、维护状态和归档状态。
- 项目档案：关联 VPS、Docker/systemd/进程服务和结构化 Runbook。
- 只读盘点远程项目：发现 Docker、systemd、监听端口和常见项目清单，并生成或更新项目 Runbook。
- 默认只绑定 `127.0.0.1` 的 Vue WebUI。
- 供 Codex、Claude Code 使用的本机 stdio MCP 网关：读取可直接执行，远程命令必须先申请独占会话。

网关刻意不读取、上传或暴露私钥内容。Node 只解析逻辑凭据引用，由本机 `ssh` 进程从网关凭据目录读取密钥文件；显式导入命令仅执行本机文件复制，不解析密钥字节。

## 安全边界

- 仓库中不得保存私钥、`.env`、Token 或生产数据库导出。
- WebUI 与 API 默认仅本机可访问。
- MCP 命令执行只允许从本机发起，并且必须经过会话租约：同一 VPS 同时只有一个活动会话，后续请求排队；默认空闲 30 分钟释放，最长 8 小时。
- 高危命令会以 warning/critical 写入审计。少数不可逆命令会直接阻断，包括常见的根目录递归删除、文件系统格式化、块设备写入和 fork bomb 形式；这是一层保底规则，不是完整 Shell 沙箱。
- SSH 用户是 `root` 的 VPS，由 WebUI 一次点击启用 8 小时 root 访问并开启会话；有效期内 AI 不需要逐命令或逐会话再次确认，开启、过期和关闭都会审计。
- 命令和输出在保存前脱敏，默认保存 90 天后清理；资产、项目摘要和审计事件继续保存在本机 SQLite。
- ICMP Ping 失败不会直接判定 VPS 离线；SSH/TCP 和项目健康检查才是主判断依据。
- SSH 执行不会继承 HTTP/SOCKS 代理环境变量，并明确关闭 `ProxyCommand` 与 `ProxyJump`；单台 VPS 可以设置 `networkMode=direct`，让 SSH 绑定物理网卡，避免 macOS TUN 模式把国内云服务器的登录出口变成代理地址。
- `all-vps` 同步不会读取私钥，并会保留本机凭据引用和紧急 root 状态。

## 环境要求

- macOS 或 Linux
- Node.js 24+
- npm 11+

## 本地开发

```bash
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。

```bash
npm run typecheck
npm run test
npm run build
```

运行数据默认放在仓库外：

```text
~/Library/Application Support/AI VPS Gateway/gateway.sqlite
```

开发或测试时可以设置 `ALLVPS_DATA_DIR` 覆盖该目录。

只要网关进程持续运行，性能调度器默认每 5 分钟采集一次符合条件的 VPS，并保留 30 天。root VPS 必须先在 WebUI 开启紧急访问窗口；未开启时不会被后台定时任务自动登录。概览和 VPS 详情页会显示历史趋势；CPU 达到 90%、内存达到 90%、磁盘达到 85%，或性能从可用变为不可用时，会写入去重后的 warning 审计告警。

SSH 执行默认使用以下本机目录：

```text
~/Library/Application Support/AI VPS Gateway/credentials/
~/.ssh/known_hosts
```

请由用户自己把密钥文件放入凭据目录，并在 VPS 的 `credentialRef` 中填写文件名，不填写路径。网关只检查文件元数据和权限，不读取密钥内容。可以设置 `ALLVPS_CREDENTIAL_DIR` 或 `ALLVPS_KNOWN_HOSTS_FILE` 使用其他位置。主机指纹必须已经登记在 `known_hosts` 中，网关不会静默接受新指纹。

## 同步现有 all-vps 清单

默认同步源是：

```text
~/Desktop/all-vps/VPS_INVENTORY.md
~/Desktop/all-vps/DOMAINS.md
```

可以在 WebUI 顶栏使用同步预览，也可以在终端运行：

```bash
npm run sync:all-vps -- --dry-run
npm run sync:all-vps
```

如需使用其他本机目录，设置 `ALLVPS_SOURCE_DIR`。同步器只会读取上述两份 Markdown 文档；不会扫描目录、读取 `.key`，或导入任何私钥、Token、密码和环境变量。

同步以 SSH 地址和端口建立稳定标识，并会更新名称、SSH 登录信息、用途、标签、访问地址与 HTTP 健康检查。本机的凭据引用和维护状态会保留。清单中已移除的资产只会在预览中提示，不会被自动归档。WebUI 应用同步时会校验预览摘要，文档发生变化后必须重新预览。

## 同步远程项目

项目盘点通过只读 SSH 执行，只收集有限元数据：主机名、系统、Docker 容器名称/镜像/状态/端口、非基础 systemd 服务、监听 TCP 端口，以及常见应用目录下浅层的项目清单文件路径。不会读取配置文件内容、环境变量、日志、私钥或 Token。结果保存在本机，并按稳定的 `remote-inventory` 标识创建或更新项目档案，自动填写项目概览、部署步骤、验证步骤、排错手册和变更边界。消失的自动项目只会归档不会删除；如果盘点有警告，也不会执行缺失项目归档。

```bash
npm run sync:vps-projects
```

WebUI 和 MCP 都支持单台及全部 VPS 的项目盘点。

## SSH 网络路径

每台 VPS 有 `system` 或 `direct` 两种网络模式。`system` 遵循操作系统路由；`direct` 让 OpenSSH 以及 TCP/HTTP 健康探针都绑定检测到的物理网卡，也可以通过 `ALLVPS_SSH_DIRECT_INTERFACE` 指定，例如 `en0`。direct 模式的 HTTPS 检查会连接 VPS 登记地址，同时保留健康检查中的域名和 TLS SNI，避免 TUN 的 Fake-IP DNS 结果。当前国内腾讯云资产已经在本机 SQLite 中设置为 `direct`，该配置不会写入仓库。它只影响网关流量，不会修改 Clash/TUN 的全局规则。

## 导入 all-vps 凭据

该命令是显式本机操作，不属于 Markdown 同步。它只在 `all-vps` 顶层查找文件名包含已登记 VPS 地址的 `.key` 或 `.pem`，每台服务器必须唯一匹配；不会读取、打印或上传密钥内容，也不会删除源文件、覆盖已有引用或覆盖网关中的同名文件。

```bash
npm run import:all-vps-credentials -- --dry-run
npm run import:all-vps-credentials
```

导入后的副本存放于 `~/Library/Application Support/AI VPS Gateway/credentials/`，目录权限为 `0700`，文件权限为 `0600`。数据库只记录逻辑文件名。

## MCP

先启动本机 API，再把 stdio 适配器注册到客户端：

```json
{
  "mcpServers": {
    "ai-vps-gateway": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/ai-vps-gateway", "run", "mcp"]
    }
  }
}
```

当前提供：`list_servers`、`get_server`、`get_dashboard`、`list_projects`、`get_project`、`list_sessions`、`open_session`、`get_session`、`run_command`、`close_session`、`collect_metrics`、`collect_all_metrics`、`get_metric_history`、`list_metric_alerts`、`sync_server_projects`、`sync_all_vps_projects`。

正常执行流程是：先 `open_session`，如果返回排队就等待，再通过 `run_command` 执行，必要时使用 `collect_metrics` 获取当前性能，完成后 `close_session`。root VPS 由 WebUI 启用一次 8 小时访问窗口；窗口内流程与普通 VPS 相同。API 和 MCP 适配器默认只绑定 `127.0.0.1`，AI 不会拿到私钥或任意本机 SSH 路径。

项目 Runbook 分为项目概览、部署步骤、验证步骤、排错手册和变更边界五部分。当前保存在本机 SQLite，供后续 AI 会话通过只读 MCP 查询；不要在 Runbook 中写入密码、Token、私钥或完整环境变量。

## 许可证

[MIT](./LICENSE)
