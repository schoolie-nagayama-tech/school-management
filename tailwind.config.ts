import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans-jp)",
          "var(--font-geist-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Hiragino Kaku Gothic ProN",
          "Meiryo",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        /* Surfaces */
        bg: "var(--bg)",
        background: "var(--bg)",
        surface: "var(--surface)",
        "surface-raised": "var(--surface-raised)",
        "surface-hover": "var(--surface-hover)",
        /* Text */
        foreground: "var(--text-body)",
        "text-heading": "var(--text-heading)",
        "text-body": "var(--text-body)",
        "text-muted": "var(--text-muted)",
        "text-faint": "var(--text-faint)",
        "text-on-primary": "var(--text-on-primary)",
        /* Borders */
        border: "var(--border-default)",
        "border-subtle": "var(--border-subtle)",
        "border-strong": "var(--border-strong)",
        /* Primary */
        primary: {
          DEFAULT: "var(--primary)",
          light: "var(--primary-light)",
          dark: "var(--primary-dark)",
          subtle: "var(--primary-subtle)",
          contrast: "var(--primary-contrast)",
        },
        /* Accent Ink（管理画面の副系ブランド色、旧 #1e3a5f の後継） */
        ink: {
          DEFAULT: "var(--accent-ink)",
          subtle: "var(--accent-ink-subtle)",
        },
        /* Status */
        success: {
          DEFAULT: "var(--success)",
          subtle: "var(--success-subtle)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          subtle: "var(--warning-subtle)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          subtle: "var(--danger-subtle)",
        },
        error: {
          DEFAULT: "var(--danger)",
          subtle: "var(--danger-subtle)",
        },
        info: {
          DEFAULT: "var(--info)",
          subtle: "var(--info-subtle)",
        },
      },
    },
  },
  plugins: [],
};
export default config;
