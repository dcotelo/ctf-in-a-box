import type { Metadata } from "next";
import { Archivo, Public_Sans, Geist_Mono } from "next/font/google";
import SiteHeader from "@/components/site-header";
import VisitBeacon from "@/components/visit-beacon";
import { event } from "@/lib/site";
import { enabledModules } from "@/lib/modules";
import { getNavGroups } from "@/lib/resolved-modules";
import "./globals.css";

// Display: a grotesque with shoulders — signage, not the default geometric.
const archivo = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700", "900"],
});

// Body: built for dense civic/technical copy; survives grading text at 15px.
const publicSans = Public_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "600"],
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
      className={`${archivo.variable} ${publicSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader navLinks={navLinks} />
        {children}
        <VisitBeacon />
      </body>
    </html>
  );
}
