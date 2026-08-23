import type { Config } from "tailwindcss";

// JMAN brand tokens, carried over from the AutoEDA product (parentfolder/autoeda-frontend)
// so ResourceIQ reads as a sibling JMAN tool, not a foreign add-on.
const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--foreground))" },
        brand: { DEFAULT: "hsl(var(--brand))", foreground: "hsl(var(--brand-foreground))" },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
        },
        "jman-midnight": { DEFAULT: "#19105B", 50: "#F2F2FF", 100: "#E8E7FF", 700: "#4916EB", 800: "#3411A3", 900: "#19105B" },
        "jman-rose": { DEFAULT: "#FF6196", 50: "#FFF0F5", 100: "#FFE3EA", 500: "#F93A7F", 700: "#C30D5C" },
        "jman-emerald": { DEFAULT: "#18978E", 50: "#F1FCFA", 500: "#21ADA0", 700: "#156F6B" },
        "jman-amber": { DEFAULT: "#D97706", 50: "#FFFBEB", 700: "#B45309" },
        "jman-gray": { 50: "#F3F3F7", 100: "#E8E7EF", 200: "#D1CFDE", 300: "#BAB7CE", 400: "#A39FBD", 500: "#8C87AD", 700: "#5E588C", 800: "#251C63" },
        // Real JMAN brand secondary colours (from the official brand guide) --
        // Turquoise/Light Blue/Amethyst weren't registered yet (only
        // Midnight Blue/Trypan Blue via "jman-midnight" and Rose via
        // "jman-rose" were). DEFAULT is the exact brand value; 50/500/700 are
        // derived tints/shades (same convention as jman-rose/jman-emerald
        // above, which also derive their own 50/500/700 around a single
        // brand-specified value) for light-mode chip backgrounds and
        // readable-contrast text/dark-mode variants.
        "jman-turquoise": { DEFAULT: "#71EAE1", 50: "#EFFDFC", 500: "#14B8AC", 700: "#0F8880" },
        "jman-lightblue": { DEFAULT: "#26D4F0", 50: "#EAFBFE", 500: "#0EA5C4", 700: "#0A7A93" },
        "jman-amethyst": { DEFAULT: "#A16BDB", 50: "#F5EFFC", 500: "#8B4FD1", 700: "#6D35AC" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: { "fade-in": "fade-in 0.2s ease-out" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
