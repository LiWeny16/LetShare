import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import viteCompression from "vite-plugin-compression"
import { resolve } from "path"
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        landing: resolve(__dirname, "landing.html"),
      },
      // 配置rollup的一些构建策略
      output: {
        assetFileNames: "static-[hash].[name].[ext]",
        manualChunks(id) {
          if (id.includes("style.css")) {
            // 需要单独分割那些资源 就写判断逻辑就行
            return "src/style.css"
          }
          // 最小化拆分包 — 但把很小的包合并，避免请求数爆炸
          if (id.includes("node_modules")) {
            const pkgName = id
              .toString()
              .split("node_modules/")[1]
              .split("/")[0]
              .toString()
              .replace(/^[.@]/, "") // 去掉 pnpm(.pnpm) 的 dot 前缀 / npm(@scope) 的 @ 前缀
            // 小体积包合并到 common-vendor，减少 modulepreload 请求数
            // ⚠️ scheduler/use-sync-external-store 是 React 内部依赖，不能合并
            const smallLibs = [
              "clsx", "mitt", "uuid", "hoist-non-react-statics",
              "prop-types", "dom-helpers", "void-elements",
              "html-parse-stringify", "@floating-ui",
            ]
            if (smallLibs.includes(pkgName)) {
              return "common-vendor"
            }
            return pkgName + "-vendor"
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
      //   enabled: false, // 在开发模式 (`npm run dev`) 中也启用 Service Worker,方便调试。
      // },
      registerType: 'autoUpdate',
      injectRegister: false,
      // 每60秒检查一次更新
      workbox: {
        // 立即激活新的 Service Worker
        clientsClaim: true,
        skipWaiting: true,
        // 设置检查更新的间隔(毫秒)
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/landing\.html(?:\?.*)?$/],
        // Landing page has its own entry and animation bundle. Keep it out of
        // app precache so the root sharing tool does not fetch GSAP in the
        // background during first use.
        globIgnores: [
          '**/landing.html',
          '**/*landing*.js',
          '**/*landing*.css',
          '**/*gsap*.js',
          '**/*gsap*.js.gz',
          '**/modulepreload-polyfill-*.js',
        ],
        // 设置运行时缓存策略
        runtimeCaching: [
          {
            // 缓存外部资源,使用 StaleWhileRevalidate 策略
            urlPattern: /^https:\/\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'external-cache-v5',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7天
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
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
            src: '/icons/192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/512x512.png',
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
