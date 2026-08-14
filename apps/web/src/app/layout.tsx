import type { Metadata } from "next";
import { Poppins, Barlow, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import SiteHeader from "@/components/site-header";
import VisitBeacon from "@/components/visit-beacon";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OWASP CTF @ DEF CON 34",
  description:
    "OWASP Capture The Flag competition at DEF CON 34. Theme: Agency. August 7-9, 2026, Las Vegas Convention Center.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${barlow.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
        <Analytics />
        <VisitBeacon />
      </body>
    </html>
  );
}
