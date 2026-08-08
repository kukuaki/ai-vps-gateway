# AI VPS Gateway

[English](./README.md)

面向个人本机使用的 VPS 资产管理、健康监测和 MCP 网关。目标是让 Codex 与 Claude Code 经由统一网关安全管理服务器，而不是获得私钥或直接 SSH 权限。

## 当前范围

- 手动新增、编辑、维护和归档 VPS，数据保存在本机 SQLite。
- 不依赖 Ping 的测活：TCP、SSH Banner、HTTP(S) 服务检查。
- 健康历史、审计事件、维护状态和归档状态。
- 默认只绑定 `127.0.0.1` 的 Vue WebUI。
- 供 Codex、Claude Code 使用的只读 stdio MCP 服务。

首个版本刻意不读取、导入、上传或暴露私钥。远端写操作、凭据隔离、会话互斥锁和紧急 root 会在资产和测活层稳定后继续实现。

## 安全边界

- 仓库中不得保存私钥、`.env`、Token 或生产数据库导出。
- WebUI 与 API 默认仅本机可访问。
- `0.1.x` 的 MCP 工具只读。
- ICMP Ping 失败不会直接判定 VPS 离线；SSH/TCP 和项目健康检查才是主判断依据。

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

第一版提供：`list_servers`、`get_server`、`get_dashboard`。

## 许可证

[MIT](./LICENSE)
