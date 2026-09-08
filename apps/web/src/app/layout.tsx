import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";

// Las tres tipografías del sitio de Amplifica, con los mismos roles:
// Archivo para títulos, Manrope para el cuerpo, Plex Mono para etiquetas y
// datos. El eje de ancho de Archivo es la razón por la que se eligió allá.
const displayFont = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
});

const sansFont = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Amplifica Studio",
  description: "Agentes de marketing en loop para negocios locales",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="es"
      className={`${sansFont.variable} ${displayFont.variable} ${monoFont.variable}`}
    >
      <body className="bg-ink font-sans text-fg antialiased">{children}</body>
    </html>
  );
}
