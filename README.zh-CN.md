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
- 已登记凭据和主机指纹的 `root` VPS 可以直接开启普通会话。WebUI 的 8 小时 root 救援提示是可选的，只用于突出高危审计；它不是会话、性能、项目盘点或命令执行的前置条件，开启或关闭都不会中断已有会话。
- 命令和输出在保存前脱敏，默认保存 90 天后清理；资产、项目摘要和审计事件继续保存在本机 SQLite。
- ICMP Ping 失败不会直接判定 VPS 离线；SSH/TCP 和项目健康检查才是主判断依据。
- SSH 执行不会继承 HTTP/SOCKS 代理环境变量，并明确关闭 `ProxyCommand` 与 `ProxyJump`；all-vps 资产默认使用 `networkMode=direct`，让 SSH 绑定物理网卡，避免 macOS TUN 模式把云服务器的登录出口变成代理地址。公开 HTTP(S) 健康检查默认使用系统路由，用来验证域名公开路径，不会被误当成源站 SSH 流量。
- `all-vps` 同步不会读取私钥，并会保留本机凭据引用、维护状态和可选 root 救援状态。

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

只要网关进程持续运行，性能调度器默认每 5 分钟采集一次符合条件的 VPS（包括已登记的 root VPS），并保留 30 天。概览和 VPS 详情页会显示历史趋势；CPU 达到 90%、内存达到 90%、磁盘达到 85%，或性能从可用变为不可用时，会写入去重后的 warning 审计告警。

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

同步以 SSH 地址和端口建立稳定标识，并会更新名称、SSH 登录信息、用途、标签、网络路径与 HTTP 健康检查。VPS 记录会保持 `accessUrl` 为空：Web 地址属于项目，因为一台 VPS 可能承载多个互不相关的站点。本机的凭据引用、维护状态和可选 root 救援状态会保留。清单中已移除的资产只会在预览中提示，不会被自动归档。WebUI 应用同步时会校验预览摘要，文档发生变化后必须重新预览。

## 同步远程项目

项目盘点通过只读 SSH 执行，只收集有限元数据：主机名、系统、Docker 容器名称/镜像/状态/端口映射/挂载、非基础 systemd 服务、PM2/Node 进程名称、PID、工作目录和监听端口、项目清单路径和依赖名称，以及筛选后的 Web 路由指令（`server_name`、`listen`、`proxy_pass`、`root`）。不会读取环境变量、日志、私钥、Token 或完整配置文件。Nginx 路由会依据静态目录、反代上游端口、进程工作目录和服务管理器证据归并到项目；域名只记录为项目 Web 入口，不会单独生成“域名项目”。结果保存在本机，并按稳定的 `remote-inventory` 标识创建或更新项目档案，自动填写技术栈、项目级 Web 入口（发现到时）、详细服务清单、项目概览、部署步骤、验证步骤、排错手册和变更边界。消失的自动项目只会归档不会删除；如果盘点有警告，也不会执行缺失项目归档。

```bash
npm run sync:vps-projects
```

WebUI 和 MCP 都支持单台及全部 VPS 的项目盘点。

## SSH 网络路径

每台 VPS 有 `system` 或 `direct` 两种 SSH 网络模式。all-vps 资产和 WebUI 新增资产默认使用 `direct`，让 SSH/TCP 基线探针绑定检测到的物理网卡（也可以通过 `ALLVPS_SSH_DIRECT_INTERFACE` 指定，例如 `en0`），避免本机 TUN/代理路由；`system` 仍可在单台 VPS 上显式选择。公开 HTTP(S) 健康检查默认使用 `system`，按操作系统路由验证域名公开路径；若需要源站检查，可在单条健康检查中显式选择 `direct`，此时会连接 VPS 登记地址并保留域名 Host 与 TLS SNI。它只影响网关流量，不会修改 Clash/TUN 的全局规则。

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

正常执行流程是：先 `open_session`，如果返回排队就等待，再通过 `run_command` 执行，必要时使用 `collect_metrics` 获取当前性能，完成后 `close_session`。root VPS 通过正常凭据和主机指纹检查后即可走同一流程；WebUI 的 root 救援提示只是额外的高危告警和审计信号。API 和 MCP 适配器默认只绑定 `127.0.0.1`，AI 不会拿到私钥或任意本机 SSH 路径。

项目 Runbook 分为项目概览、部署步骤、验证步骤、排错手册和变更边界五部分。当前保存在本机 SQLite，供后续 AI 会话通过只读 MCP 查询；不要在 Runbook 中写入密码、Token、私钥或完整环境变量。

在当前这个仓库中，先启动本机 API/WebUI，再分别注册 MCP：

```bash
npm --prefix /Users/kukuaki/Desktop/ai-vps-gateway run dev

codex mcp add ai-vps-gateway -- npm --prefix /Users/kukuaki/Desktop/ai-vps-gateway run mcp
codex mcp get ai-vps-gateway

claude mcp add --scope user ai-vps-gateway -- npm --prefix /Users/kukuaki/Desktop/ai-vps-gateway run mcp
claude mcp get ai-vps-gateway
```

注册后如果客户端已经打开，重启对应客户端让工具列表刷新。在对话中直接要求 Agent 使用 `ai-vps-gateway`，例如：“先读取项目 Runbook，再盘点目标 VPS；需要改动时申请独占会话，通过网关执行，完成后释放会话。”正常流程是用 `get_project`/`list_servers` 获取上下文，用 `open_session` -> `run_command` 执行运维，最后调用 `close_session`。

## 许可证

[MIT](./LICENSE)
