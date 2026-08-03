import defaultTheme from "tailwindcss/defaultTheme";
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#18191c",
          900: "#1d1e22",
          800: "#202226",
          700: "#2f3136",
        },
        pulso: {
          primary: "#6256a9",
          primaryDim: "#4c418b",
          accent: "#04aec6",
          accentDim: "#00bcd5",
        },
        status: {
          blue: "#3d5afe",
          pink: "#ff2d78",
          orange: "#f09238",
          green: "#89e07d",
          grey: "#c9c9c9",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
        display: ["var(--font-display)", "sans-serif"],
      },
      keyframes: {
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(98, 86, 169, 0.45)" },
          "100%": { boxShadow: "0 0 0 14px rgba(98, 86, 169, 0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
