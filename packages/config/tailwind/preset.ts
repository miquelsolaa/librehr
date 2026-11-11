import tailwindcssAnimate from "tailwindcss-animate";

export const librehrTailwindPreset = {
  darkMode: ["class"],
  // Provides the animate-in / fade-* / zoom-* utilities the UI components use.
  plugins: [tailwindcssAnimate],

  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        "surface-raised": "hsl(var(--surface-raised) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        "muted-foreground": "hsl(var(--muted-foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        accent: "hsl(var(--accent) / <alpha-value>)",
        "brand-accent": {
          DEFAULT: "hsl(var(--brand-accent) / <alpha-value>)",
          foreground: "hsl(var(--brand-accent-foreground) / <alpha-value>)",
        },
        success: "hsl(var(--success) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        danger: "hsl(var(--danger) / <alpha-value>)",
        info: "hsl(var(--info) / <alpha-value>)",
        "focus-ring": "hsl(var(--focus-ring) / <alpha-value>)",
        // The veil behind dialogs and panels: pine-dark in both themes.
        scrim: "hsl(var(--scrim) / <alpha-value>)",
      },
      borderRadius: {
        input: "6px",
        card: "10px",
        dialog: "16px",
      },
      fontFamily: {
        sans: [
          // Self-hosted via @fontsource-variable/inter (imported by apps/web).
          '"Inter Variable"',
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
        // Page titles and large figures only (DESIGN.md §2.3). Self-hosted via
        // @fontsource-variable/bricolage-grotesque (imported by apps/web).
        display: [
          '"Bricolage Grotesque Variable"',
          '"Inter Variable"',
          "Inter",
          "sans-serif",
        ],
      },
    },
  },
};

export const openhrTailwindPreset = librehrTailwindPreset;
export default librehrTailwindPreset;
