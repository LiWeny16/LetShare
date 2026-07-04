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
    // Old clients may still have stale SW with precached old index.html
    // referencing old chunks. Keep them until SW updates propagate.
    emptyOutDir: false,
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
        // Don't precache index.html — stale HTML from SW cache is the #1 source
        // of "loading failed" errors. Use NetworkFirst runtime route instead.
        navigateFallback: undefined,
        globIgnores: [
          '**/index.html',
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
            // version.json — sentinel: 客户端和 SW 通过它检测是否有新版本部署
            // 永远 NetworkFirst，不缓存，确保每次都能检测到版本变化
            urlPattern: /\/version\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'version-sentinel',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 0 // 不缓存
              },
            },
          },
          {
            // Navigation (HTML): StaleWhileRevalidate — 缓存瞬间返回，后台静默更新
            // 缓存期 365 天，因为 version.json 哨兵会在版本变化时触发刷新
            urlPattern: ({request}: {request: Request}) => request.mode === 'navigate',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'html-cache-v3',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 365天
              },
            },
          },
          {
            // 缓存外部资源,使用 StaleWhileRevalidate 策略
            urlPattern: /^https:\/\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'external-cache-v15',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 365天
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
