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
const adminSet = new Set(eventConfig.admins.map((a) => a.toLowerCase()));
const isAdminLogin = (login: string | undefined) =>
  typeof login === "string" && adminSet.has(login.toLowerCase());

export default function AuthNav() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (isPending) {
    return <div className="h-8 w-8 flex-none animate-pulse rounded-full bg-white/[0.06]" aria-hidden="true" />;
  }

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/profile" })}
        className="flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:border-[#2563eb]/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
      >
        <span className="text-[#22c55e]">$</span> sign-in --github
      </button>
    );
  }

  const login = (session.user as { login?: string }).login ?? session.user.name;
  const showAdmin = isAdminLogin((session.user as { login?: string }).login);

  return (
    <div className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
      >
        <Image
          src={session.user.image ?? `https://avatars.githubusercontent.com/${login}`}
          alt=""
          width={26}
          height={26}
          className="rounded-full border border-white/10"
          unoptimized
        />
        <span className="hidden font-mono text-xs text-zinc-300 sm:inline">{login}</span>
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
