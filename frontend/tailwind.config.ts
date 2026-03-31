import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#f8fafc",
        panel: "#ffffff"
      }
    }
  },
  plugins: []
};

export default config;
