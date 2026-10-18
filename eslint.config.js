import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'reference/**', 'src-tauri/target/**', 'release/**', 'output/**', 'release-check/**', 'acceptance-release/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // 后端、Electron 外壳、脚本与测试都是 ES 模块的 JS：它们此前一条 lint 都没跑过，
  // 所以 `requestCancel is not defined`、`spawn is not defined` 这类未定义变量能一路通过
  // （tsc 不检查这些文件，前端构建也不会打包它们）。这里按 Node 环境纳入检查。
  {
    files: ['backend/**/*.mjs', 'electron/**/*.{mjs,cjs}', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // 未定义变量是这两轮真实事故的直接成因，保持高位告警；其余规则沿用 recommended。
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // 这些模块里大量 `catch {}` 是「失败就当作没有」的刻意写法，不算漏写处理。
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 日志与文件名的清洗正则本来就要匹配控制字符。
      'no-control-regex': 'off',
    },
  },
])
