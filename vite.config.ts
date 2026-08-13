import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { gatewayApiToken, localGatewayBaseUrl } from "./server/auth.js";

const apiBaseUrl = localGatewayBaseUrl();

export default defineConfig(({ command }) => {
  const apiToken = command === "serve" ? gatewayApiToken() : null;
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiBaseUrl,
          configure(proxy) {
            if (!apiToken) return;
            proxy.on("proxyReq", (request) => request.setHeader("x-ai-vps-gateway-token", apiToken));
          }
        }
      }
    }
  };
});
