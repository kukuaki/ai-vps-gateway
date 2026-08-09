# AI VPS Gateway

[English](./README.md)

面向个人本机使用的 VPS 资产管理、健康监测和 MCP 网关。目标是让 Codex 与 Claude Code 经由统一网关安全管理服务器，而不是获得私钥或直接 SSH 权限。

## 当前范围

- 手动新增、编辑、维护和归档 VPS，数据保存在本机 SQLite。
- 从现有 `all-vps` 文档同步 VPS 清单与已知域名健康检查。
- 不依赖 Ping 的测活：TCP、SSH Banner、HTTP(S) 服务检查。
- 健康历史、审计事件、维护状态和归档状态。
- 项目档案：关联 VPS、Docker/systemd/进程服务和结构化 Runbook。
- 默认只绑定 `127.0.0.1` 的 Vue WebUI。
- 供 Codex、Claude Code 使用的本机 stdio MCP 网关：读取可直接执行，远程命令必须先申请独占会话。

网关刻意不读取、导入、上传或暴露私钥内容。Node 只解析逻辑凭据引用，由本机 `ssh` 进程从网关凭据目录读取密钥文件。

## 安全边界

- 仓库中不得保存私钥、`.env`、Token 或生产数据库导出。
- WebUI 与 API 默认仅本机可访问。
- MCP 命令执行只允许从本机发起，并且必须经过会话租约：同一 VPS 同时只有一个活动会话，后续请求排队；默认空闲 30 分钟释放，最长 8 小时。
- 高危命令会以 warning/critical 写入审计。少数不可逆命令会直接阻断，包括常见的根目录递归删除、文件系统格式化、块设备写入和 fork bomb 形式；这是一层保底规则，不是完整 Shell 沙箱。
- SSH 用户是 `root` 的 VPS，必须先由 WebUI 开启限时紧急 root 救援；默认有效 30 分钟，开启、过期和关闭都会审计。
- 命令和输出在保存前脱敏，默认保存 90 天后清理；资产、项目摘要和审计事件继续保存在本机 SQLite。
- ICMP Ping 失败不会直接判定 VPS 离线；SSH/TCP 和项目健康检查才是主判断依据。
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

当前提供：`list_servers`、`get_server`、`get_dashboard`、`list_projects`、`get_project`、`list_sessions`、`open_session`、`get_session`、`run_command`、`close_session`、`collect_metrics`。

正常执行流程是：先 `open_session`，如果返回排队就等待，再通过 `run_command` 执行，必要时使用 `collect_metrics` 获取当前性能，完成后 `close_session`。API 和 MCP 适配器默认只绑定 `127.0.0.1`，AI 不会拿到私钥或任意本机 SSH 路径。

项目 Runbook 分为项目概览、部署步骤、验证步骤、排错手册和变更边界五部分。当前保存在本机 SQLite，供后续 AI 会话通过只读 MCP 查询；不要在 Runbook 中写入密码、Token、私钥或完整环境变量。

## 许可证

[MIT](./LICENSE)
