/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--color-bg)',
        'bg-secondary': 'var(--color-bg-secondary)',
        surface: 'var(--color-surface)',
        'surface-hover': 'var(--color-surface-hover)',
        'surface-active': 'var(--color-surface-active)',
        border: 'var(--color-border)',
        'border-subtle': 'var(--color-border-subtle)',
        'border-faint': 'var(--color-border-faint)',
        accent: {
          DEFAULT: 'var(--color-accent)',
          light: 'var(--color-accent-light)',
          dark: 'var(--color-accent-dark)',
          bg: 'var(--color-accent-bg)',
          border: 'var(--color-accent-border)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          bg: 'var(--color-danger-bg)',
        },
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
      },
      textColor: {
        primary: 'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        tertiary: 'var(--color-text-tertiary)',
        muted: 'var(--color-text-muted)',
        faint: 'var(--color-text-faint)',
      },
      fontFamily: {
        // Windows 优先 Segoe UI（实测：原栈首位 SF Pro Text 在 Windows 不存在，
        // 英文会穿透落到 Noto Sans SC 的拉丁字形，观感发虚；Segoe UI 是 Windows
        // 原生 UI 字体，拉丁字形清晰，中文经字体链接回落到 Microsoft YaHei UI）。
        // macOS 侧 system-ui 自动映射 SF，不影响。
        sans: [
          '"Segoe UI"',
          'system-ui',
          '"SF Pro Text"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Noto Sans SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        // 原栈末位 generic monospace 在中文 Windows 上解析为 NSimSun（新宋体），
        // 路径/语言标签等 font-mono 文本发虚；显式列出 Cascadia Code → Consolas，
        // 均为实测可用的代码字体，末位才交给 generic monospace。
        mono: [
          '"Cascadia Code"',
          '"Cascadia Mono"',
          'Consolas',
          '"SF Mono"',
          'Menlo',
          'Monaco',
          'ui-monospace',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
