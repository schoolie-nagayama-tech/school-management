import type { Config } from "tailwindcss";

const config: Config = {
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
        /* Base */
        background: "var(--background)",
        foreground: "var(--foreground)",
        "base-section": "var(--base-section)",
        border: "var(--border)",
        /* Primary (Navy) */
        primary: {
          DEFAULT: "var(--primary-main)",
          main: "var(--primary-main)",
          light: "var(--primary-light)",
          dark: "var(--primary-dark)",
        },
        /* Functional */
        success: {
          DEFAULT: "var(--success-main)",
          main: "var(--success-main)",
          light: "var(--success-light)",
          dark: "var(--success-dark)",
        },
        warning: {
          DEFAULT: "var(--warning-main)",
          main: "var(--warning-main)",
          light: "var(--warning-light)",
          dark: "var(--warning-dark)",
        },
        error: {
          DEFAULT: "var(--error-main)",
          main: "var(--error-main)",
          light: "var(--error-light)",
          dark: "var(--error-dark)",
        },
        info: {
          DEFAULT: "var(--info-main)",
          main: "var(--info-main)",
          light: "var(--info-light)",
          dark: "var(--info-dark)",
        },
        /* Text */
        "text-muted": "var(--text-muted)",
      },
    },
  },
  plugins: [],
};
export default config;
