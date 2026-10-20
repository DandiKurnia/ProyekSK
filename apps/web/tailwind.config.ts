import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        aici: {
          lime: "#CBF34D",
          periwinkle: "#E0E7FF",
          "periwinkle-subtle": "#EEF2FF",
          canvas: "#F4F5F7",
          surface: "#FFFFFF",
          "surface-nested": "#F8F9FB",
          dark: "#111827",
          muted: "#6B7280",
          border: "#F3F4F6",
          "border-dark": "#E5E7EB",
          success: "#16A34A",
          "success-bg": "#DCFCE7",
          warning: "#F59E0B",
          "warning-bg": "#FEF3C7",
          error: "#EF4444",
          "error-bg": "#FEE2E2",
        },
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        xl: "16px",
        "2xl": "20px",
      },
    },
  },
  plugins: [],
};
export default config;
