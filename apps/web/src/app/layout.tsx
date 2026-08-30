import type { Metadata } from "next";
import { Poppins, Barlow, Geist_Mono } from "next/font/google";
import SiteHeader from "@/components/site-header";
import VisitBeacon from "@/components/visit-beacon";
import { event } from "@/lib/site";
import { enabledModules } from "@/lib/modules";
import { getNavGroups } from "@/lib/resolved-modules";
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

// What this event actually is, in the enabled modules' own words. This used to
// hardcode "patch real vulnerabilities in OWASP training apps" — secure-
// development's pitch, served as the description of EVERY page, including on
// an event that runs no such module. Taglines come off the registry (they are
// not organizer-overridable, unlike title/blurb), so this stays a static
// `metadata` object: no request-time read, nothing for the build to freeze.
// A module with no `home` contributes nothing, and an event whose modules all
// lack one falls back to the event name and its dates alone.
const moduleTaglines = enabledModules
  .map((m) => m.home?.tagline)
  .filter(Boolean)
  .join(" · ");

export const metadata: Metadata = {
  title: { default: event.name, template: `%s · ${event.name}` },
  description: `${event.name}${moduleTaglines ? ` — ${moduleTaglines}` : ""}${event.dates ? ` — ${event.dates}` : ""}${event.location ? `, ${event.location}` : ""}.`,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const navLinks = await getNavGroups();
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${barlow.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Skip link (WCAG 2.4.1). The header carries the wordmark, up to six
            module links, a dropdown and the auth control, so a keyboard or
            switch user had to tab through all of it on EVERY page before
            reaching the content — the bypass block is the whole remedy for
            that. Hidden until focused, then pinned over the sticky header so
            it isn't painted underneath it.

            It targets `#main-content`, which every main element in this app
            sets: the shared `(site)` layout, the landing page, the 404, and
            the error boundary each render their own. The parity is asserted
            in `app/__tests__/loading-and-errors.test.tsx` — a bypass link
            that lands nowhere still renders, and still looks fine. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[#2563eb] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#d4a017]"
        >
          Skip to content
        </a>
        <SiteHeader navLinks={navLinks} />
        {children}
        <VisitBeacon />
      </body>
    </html>
  );
}
