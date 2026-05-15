import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb',
        surface: '#ffffff',
        'on-surface': '#1f2937',
        'on-surface-variant': '#6b7280',
      },
    },
  },
  plugins: [],
} satisfies Config;