/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./pages/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./app/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#18173f",
        navy2: "#131230",
        magenta: "#f02d8a",
        pink: "#f84e9d",
        violet: "#6a2bb8",
        aqua: "#4dd9c8",
        textmain: "#0c1027",
        surface: "#ffffff",
        muted: "#6b7280",
      },
    },
  },
  plugins: [],
};
