module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh"],
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
  },
  overrides: [
    // ── 新代码严格档（对应 tsconfig.core.json 的作用域）────────────────────
    // 为什么需要这段：`rewrite/STANDARDS.md` §4 一直宣称这些"机械检查"由 eslint 兜底，
    // 但 .eslintrc 里从未实现过 —— 于是 "eslint 0 告警" 是空心的，所有阈值实际只靠人工
    // 审查（G1）才发现。本次补齐，作用域与严格档一致（只覆盖新代码根，不动存量）。
    {
      files: ["src/core/**/*.ts", "src/core/**/*.tsx", "src/diagnostics/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        // 单文件 ≤400 行（口径 = wc -l，与 STANDARDS 一致：不跳过注释与空行）
        "max-lines": ["error", { max: 400 }],
        // 单函数 ≤50 行（口径 = 声明行到收尾大括号；函数上方文档注释不计入）
        "max-lines-per-function": ["error", { max: 50 }],
        complexity: ["error", 12],
        "max-depth": ["error", 4],
        // 禁裸定时器 / 直接时钟与随机数：唯一允许的注入边界在下一段 override 里放行
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "CallExpression[callee.name='setTimeout'], CallExpression[callee.name='setInterval']",
            message:
              "新代码禁裸定时器：必须经注入的 Clock（见 core/transport/systemClock.ts、core/audio/remoteAudioClock.ts）。X5。",
          },
          {
            selector:
              "MemberExpression[object.name='Date'][property.name='now']",
            message:
              "新代码禁直连系统时钟：必须经注入的 Clock。X5 / C-04（重试时延可复现）。",
          },
          {
            selector:
              "MemberExpression[object.name='Math'][property.name='random']",
            message:
              "新代码禁直连随机数：必须经注入的 Rng。X5 / C-04。",
          },
        ],
      },
    },
    // ── 注入边界白名单：系统时钟与随机数的唯一落点 ──────────────────────────
    // 这两个文件是新代码里**仅有的**允许直连系统能力的模块；它们的实现是纯转发，
    // 真正的语义（可注入）由接口保证。改动这两个文件时必须同步 T1（coreInjection 静态检查）。
    {
      files: [
        "src/core/transport/systemClock.ts",
        "src/core/audio/remoteAudioClock.ts",
      ],
      rules: {
        "no-restricted-syntax": "off",
      },
    },
  ],
}
