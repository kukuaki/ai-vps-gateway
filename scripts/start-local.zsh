#!/bin/zsh

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${AI_VPS_GATEWAY_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SERVICE="${1:-}"

fail() {
  print -u2 "错误：$1"
  print -u2 "项目目录：$PROJECT_DIR"
  read -r "?按回车关闭窗口..."
  exit 1
}

case "$SERVICE" in
  api)
    SERVICE_LABEL="本地 API 服务"
    SERVICE_PORT=4318
    SERVICE_URL="http://127.0.0.1:4318/"
    SERVICE_COMMAND=(npm run dev:api)
    ;;
  webui)
    SERVICE_LABEL="WebUI"
    SERVICE_PORT=5173
    SERVICE_URL="http://127.0.0.1:5173/"
    SERVICE_COMMAND=(npm run dev:web)
    ;;
  *)
    fail "启动目标必须是 api 或 webui"
    ;;
esac

if [[ ! -d "$PROJECT_DIR" ]]; then
  fail "找不到项目目录"
fi

cd "$PROJECT_DIR" || fail "无法进入项目目录"

# Finder 双击 .command 时通常不会加载交互式 shell 的 Homebrew/fnm PATH。
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v npm >/dev/null 2>&1 && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell zsh)"
fi

command -v npm >/dev/null 2>&1 || fail "找不到 npm。请先安装 Node.js，或确认 fnm 已安装。"
command -v node >/dev/null 2>&1 || fail "找不到 node。请先安装 Node.js。"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
[[ "$NODE_MAJOR" == <-> && "$NODE_MAJOR" -ge 24 ]] || fail "当前 Node.js 为 $(node --version)，项目要求 Node.js 24 或更高版本。"

[[ -x "$PROJECT_DIR/node_modules/.bin/tsx" ]] || fail "缺少项目依赖。请在项目目录执行 npm install 后再启动。"
if [[ "$SERVICE" == "webui" ]]; then
  [[ -x "$PROJECT_DIR/node_modules/.bin/vite" ]] || fail "缺少 Vite 依赖。请在项目目录执行 npm install 后再启动。"
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$SERVICE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  print -u2 "端口 $SERVICE_PORT 已被占用，未重复启动 $SERVICE_LABEL。"
  print -u2 "检查地址：$SERVICE_URL"
  lsof -nP -iTCP:"$SERVICE_PORT" -sTCP:LISTEN
  read -r "?按回车关闭窗口..."
  exit 1
fi

print "========================================"
print "启动：$SERVICE_LABEL"
print "项目：$PROJECT_DIR"
print "地址：$SERVICE_URL"
print "停止：在本窗口按 Ctrl-C"
print "========================================"

"$SERVICE_COMMAND[@]"
EXIT_CODE=$?
print ""
print "服务已停止，退出码：$EXIT_CODE"
read -r "?按回车关闭窗口..."
exit "$EXIT_CODE"
