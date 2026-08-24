"use client";

// The landing hero's single primary action. Two shapes: a plain link, or the
// GitHub sign-in (which must run client-side through authClient). The
// `callbackURL` carries the visitor's intent across the OAuth redirect — a
// signed-out visitor who clicked "Sign in and play" lands on the board, not
// back on the marketing page (brief: "never lose someone's intended action
// across the redirect").

import Link from "next/link";
import { authClient } from "@/lib/auth-client";

const PRIMARY =
  "inline-flex items-center gap-2 rounded-md bg-[#2563eb] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1d4ed8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]";

export default function HeroCta({
  label,
  href,
  signIn = false,
  callbackURL = "/profile",
}: {
  label: string;
  href?: string;
  signIn?: boolean;
  callbackURL?: string;
}) {
  if (signIn) {
    return (
      <button
        type="button"
        onClick={() => {
          // Surface a failed redirect start instead of leaving the CTA
          // silently idle; the OAuth flow itself navigates away on success.
          void authClient.signIn.social({ provider: "github", callbackURL })
            .then((result) => {
              if (result?.error) {
                console.error("sign-in failed to start:", result.error);
              }
            })
            .catch((err) => {
              console.error("sign-in failed to start:", err);
            });
        }}
        className={PRIMARY}
      >
        {label}
      </button>
    );
  }
  return (
    <Link href={href ?? "/"} className={PRIMARY}>
      {label}
    </Link>
  );
}
