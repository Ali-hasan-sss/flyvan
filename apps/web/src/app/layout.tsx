import type { Metadata } from "next";
import { Cairo, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

const display = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "فلاي فان",
  description: "منصة تنسيق نقل الركاب بين نقاط الالتقاط والجامعات والوجهات المحددة.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={`${arabic.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
