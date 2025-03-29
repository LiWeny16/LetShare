import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import viteCompression from "vite-plugin-compression"
import { resolve } from "path"

export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    rollupOptions: {
      // 配置rollup的一些构建策略
      output: {
        assetFileNames: "[hash].[name].[ext]",
        manualChunks(id) {
          if (id.includes("style.css")) {
            // 需要单独分割那些资源 就写判断逻辑就行
            return "src/style.css"
          }
          // // 最小化拆分包
          if (id.includes("node_modules")) {
            return id
              .toString()
              .split("node_modules/")[1]
              .split("/")[0]
              .toString()
          }
        },
      },
    },
    assetsInlineLimit: 4096000, // 4000kb  超过会以base64字符串显示
    outDir: "docs", // 输出名称
    assetsDir: "static", // 静态资源目录
  },
  resolve: {
    alias: {
      "@App": resolve(__dirname, "./src/app"),
      "@App/*": resolve(__dirname, "./src/app/*"),
    },
  },
  server: {
    host: "0.0.0.0",
  },
  plugins: [
    react(),
    // viteCompression({
    //   threshold: 16000, // 对大于 32kb 的文件进行压缩
    // }),
  ],
})
