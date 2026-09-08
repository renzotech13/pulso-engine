import defaultTheme from "tailwindcss/defaultTheme";
import type { Config } from "tailwindcss";

/**
 * Design system "Brasa", el mismo del sitio de Amplifica (NEWWEB). Los
 * valores son los del tema OSCURO de allá, que es el registro que un panel
 * de trabajo necesita: se mira durante horas seguidas.
 *
 * Los nombres son semánticos a propósito — `surface`, `line`, `fg-2`,
 * `danger` — y no descriptivos como los que había antes (`ink-900`,
 * `status-pink`). Una pantalla dice qué papel cumple cada color, no qué
 * tono es, así que el día que la marca cambie de naranja se cambia acá y
 * no en cuarenta archivos.
 *
 * El contraste va anotado al costado, medido contra el fondo #0a0a0b según
 * WCAG 2.1, igual que en el sitio. Ningún color de texto baja de AA.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Superficies -------------------------------------------------
        ink: "#0a0a0b", // fondo de la página
        surface: "#151315", // tarjetas y paneles
        "surface-2": "#1c1819", // lo elevado sobre una tarjeta

        // Bordes. Van en rgb con alfa, como en el sitio, para que se
        // apoyen en el fondo que tengan debajo en vez de ser un gris
        // fijo. A cambio no admiten el modificador `/opacidad` de
        // Tailwind: si hace falta un borde más marcado, es `line-2`.
        line: "rgb(255 255 255 / 0.09)",
        "line-2": "rgb(255 255 255 / 0.16)",

        // Texto -------------------------------------------------------
        fg: "#faf8f6", // 18.68:1 AAA — títulos y texto principal
        "fg-2": "#a8a29e", //  7.85:1 AAA — texto secundario
        "fg-3": "#8a827c", //  5.24:1 AA  — apagado, el mínimo permitido

        // Acento: el color de acción, uno solo ------------------------
        accent: "#ff5a2b", // 6.36:1 AA — fondo de botón primario
        "accent-hover": "#ff6e44",
        "accent-fg": "#150703", // 6.35:1 sobre accent — texto encima de él
        "accent-deep": "#e5391e", // DECORATIVO: no pasa AA como fondo de texto
        "accent-ink": "#ff5a2b", // 6.36:1 AA — el naranja como TEXTO sobre ink

        // Semánticos --------------------------------------------------
        amber: "#ffb020", // 10.82:1 AAA — avisos y datos destacados
        danger: "#ff3b6b", //  5.74:1 AA  — SOLO errores
        success: "#3ddc84", // 11.09:1 AAA — confirmaciones
        info: "#60a5fa", //  7.78:1 AAA — informativo, sin urgencia
      },
      borderRadius: {
        btn: "12px",
        card: "20px",
        panel: "24px",
      },
      fontFamily: {
        sans: ["var(--font-manrope)", ...defaultTheme.fontFamily.sans],
        display: ["var(--font-archivo)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-plex-mono)", ...defaultTheme.fontFamily.mono],
      },
      fontSize: {
        // Etiquetas y datos — IBM Plex Mono. El tracking abierto es lo
        // que hace legible una mayúscula pequeña.
        label: ["0.6875rem", { lineHeight: "1.2", letterSpacing: "0.15em" }],
        data: ["0.8125rem", { lineHeight: "1.45" }],
        // Títulos — Archivo, con el tracking cerrado que le da densidad.
        d4: ["clamp(1.25rem, 2vw, 1.5rem)", { lineHeight: "1.15", letterSpacing: "-0.028em", fontWeight: "700" }],
        d5: ["1.0625rem", { lineHeight: "1.3", letterSpacing: "-0.02em", fontWeight: "700" }],
      },
      keyframes: {
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(255, 90, 43, 0.45)" },
          "100%": { boxShadow: "0 0 0 14px rgba(255, 90, 43, 0)" },
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
