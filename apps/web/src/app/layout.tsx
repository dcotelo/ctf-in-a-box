import type { Metadata } from "next";
import { Poppins, Barlow, Geist_Mono } from "next/font/google";
import SiteHeader from "@/components/site-header";
import VisitBeacon from "@/components/visit-beacon";
import { event } from "@/lib/site";
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
  title: { default: event.name, template: `%s · ${event.name}` },
  description: `${event.name} — patch real vulnerabilities in OWASP training apps${event.dates ? ` — ${event.dates}` : ""}${event.location ? `, ${event.location}` : ""}.`,
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
        <VisitBeacon />
      </body>
    </html>
  );
}
