import type { ReactNode } from "react";
import "./globals.css";

/**
 * No nav, no chrome — every page here exists to be screenshotted by
 * Puppeteer, not browsed by a person. Keep the shell to the bare minimum
 * so nothing leaks into the render.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="m-0 p-0">{children}</body>
    </html>
  );
}
