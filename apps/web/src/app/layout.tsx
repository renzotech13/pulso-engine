import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Montserrat, Oswald } from "next/font/google";
import "./globals.css";

const sansFont = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
});

const displayFont = Oswald({
  subsets: ["latin"],
  weight: ["200", "300", "500", "700"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Pulso Engine",
  description: "Agentes de marketing en loop para negocios locales",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${sansFont.variable} ${displayFont.variable}`}>
      <body className="bg-ink-950 font-sans text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
