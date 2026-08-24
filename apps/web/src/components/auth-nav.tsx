"use client";

// GitHub sign-in control rendered inside <SiteHeader>. Reads the session
// reactively via authClient.useSession() — there's a brief signed-out flash
// on first paint (deliberate: fetching the session in the root layout would
// force every static marketing page to become dynamic).

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { eventConfig } from "@/lib/event-config";

// Client-side admin check for menu VISIBILITY only. The allowlist is baked
// into the config (public GitHub logins, not a secret); the real gate is
// server-side in requireAdmin(), so showing the item to a non-admin — or
// hiding it from an admin — never grants or denies access, it only affects
// the menu. Mirrors admin-auth.ts's case-insensitive compare.
//
// BAKED ONLY, and that is why the effect below exists: admins granted at
// runtime (issue #147) live in Redis, which a Client Component cannot read.
// The baked check answers instantly and covers the organizer; anyone else
// needs the round-trip.
const adminSet = new Set(eventConfig.admins.map((a) => a.toLowerCase()));
const isBakedAdmin = (login: string | undefined) =>
  typeof login === "string" && adminSet.has(login.toLowerCase());

export default function AuthNav() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Keyed by login so switching accounts cannot carry the previous viewer's
  // answer over. `null` = not asked yet.
  const [granted, setGranted] = useState<{ login: string; admin: boolean } | null>(null);

  const login = (session?.user as { login?: string } | undefined)?.login;
  const baked = isBakedAdmin(login);

  // Asked WHEN THE MENU OPENS, not on mount, and only when the baked list has
  // not already answered yes. A baked admin — the common case, and the only
  // one on a fresh event — never makes the request at all, and nobody makes it
  // just by loading a page. `/api/me/admin` returns one boolean about the
  // caller and nothing else; see that route for why it is not admin-gated.
  //
  // In a handler rather than an effect deliberately: this is a response to a
  // user action, not synchronisation with an external system.
  async function ensureAdminChecked() {
    if (!login || baked || granted?.login === login) return;
    try {
      const res = await fetch("/api/me/admin");
      const data = (res.ok ? await res.json().catch(() => ({})) : {}) as { admin?: boolean };
      setGranted({ login, admin: data.admin === true });
    } catch {
      // Menu visibility only: a failed check hides the link, which is the safe
      // direction and costs a runtime admin one extra navigation.
      setGranted({ login, admin: false });
    }
  }

  if (isPending) {
    return <div className="h-8 w-8 flex-none animate-pulse rounded-full bg-white/[0.06]" aria-hidden="true" />;
  }

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/profile" })}
        className="flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:border-[#2563eb]/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
      >
        <span className="text-[#22c55e]">$</span> sign-in --github
      </button>
    );
  }

  const displayName = login ?? session.user.name;
  const showAdmin = baked || (granted !== null && granted.login === login && granted.admin);

  return (
    <div className="relative flex-none">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          void ensureAdminChecked();
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
      >
        <Image
          src={session.user.image ?? `https://avatars.githubusercontent.com/${displayName}`}
          alt=""
          width={26}
          height={26}
          className="rounded-full border border-white/10"
          unoptimized
        />
        <span className="hidden font-mono text-xs text-zinc-300 sm:inline">{displayName}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-md border border-white/10 bg-[#16162a] py-1 shadow-xl"
        >
          <Link
            href="/profile"
            role="menuitem"
            className="block px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] hover:text-white"
          >
            Profile
          </Link>
          {showAdmin && (
            <Link
              href="/admin"
              role="menuitem"
              className="block px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] hover:text-white"
            >
              Admin
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await authClient.signOut();
              router.refresh();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.06] hover:text-white"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
