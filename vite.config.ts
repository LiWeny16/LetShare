import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import viteCompression from "vite-plugin-compression"
import { resolve } from "path"
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs';
import path from 'path';
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    rollupOptions: {
      // 配置rollup的一些构建策略
      output: {
        assetFileNames: "static-[hash].[name].[ext]",
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
              .toString() + "-vendor"
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
      "@lib": resolve(__dirname, "./src/app/lib"),
      "@lib/*": resolve(__dirname, "./src/app/lib/*"),
      "@Com": resolve(__dirname, "./src/components/"),
      "@Com/*": resolve(__dirname, "./src/components/*"),
      "@Style": resolve(__dirname, "./src/style/"),
      "@Style/*": resolve(__dirname, "./src/style/*"),
    },
  },
  server: {
    // https: {
    //   key: fs.readFileSync(path.resolve(__dirname, 'certs/192.168.1.8+3-key.pem')),
    //   cert: fs.readFileSync(path.resolve(__dirname, 'certs/192.168.1.8+3.pem')),
    // },
    open: true, // 设置服务启动时是否自动打开浏览器
    cors: true, // 允许跨域
    // port: 8080,
    host: "0.0.0.0",
  },
  plugins: [
    react(),
    VitePWA({
      // devOptions: {
      //   enabled: false, // 在开发模式 (`npm run dev`) 中也启用 Service Worker，方便调试。
      // },
      registerType: 'autoUpdate',
      // includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: 'LetShare',
        short_name: 'LetShare',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'public/icons/192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'public/icons/512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    }),
    viteCompression({
      threshold: 16000, // 对大于 32kb 的文件进行压缩
    }),
  ],
})
