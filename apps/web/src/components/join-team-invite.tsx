"use client";

// The action half of the shareable join link (issue #45).
//
// Joining is a POST to /api/team/join — never a side effect of visiting the
// URL. A GET that joined would fire on a link preview, a prefetch, or any
// crawler that followed the address, and the contestant would be on a team
// they never chose.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function JoinTeamInvite({
  code,
  teamName,
  signedIn,
  alreadyOnTeam,
}: {
  code: string;
  teamName: string;
  /** Resolved on the server, so the first paint is already correct — no
   *  signed-out flash on a link someone was sent. */
  signedIn: boolean;
  /** True when the viewer is already on a team. joinTeam would refuse anyway;
   *  saying so up front beats an error after a click. */
  alreadyOnTeam: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <button
        type="button"
        onClick={() =>
          // Back to THIS page after GitHub, not to /profile: the code lives in
          // the path, so the round-trip preserves it without a cookie or a
          // query parameter to lose.
          authClient.signIn.social({ provider: "github", callbackURL: `/join/${encodeURIComponent(code)}` })
        }
        className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-2 font-mono text-sm text-zinc-200 transition-colors hover:border-[#e6edf3]/45 hover:text-white"
      >
        <span className="text-[#3fb950]">$</span> sign-in --github
      </button>
    );
  }

  if (alreadyOnTeam) {
    return (
      <p className="text-sm text-zinc-400">
        You are already on a team. Leave it from your{" "}
        <a href="/profile" className="text-[#e6edf3] hover:underline">
          profile
        </a>{" "}
        before joining another.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = await fetch("/api/team/join", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code }),
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
              // The route already enforces the registration window and the
              // member cap, and its messages are contestant-facing. Showing
              // them verbatim beats inventing a second vocabulary for the same
              // refusals.
              setError(data.error ?? "Could not join the team");
              return;
            }
            router.push("/profile");
            router.refresh();
          } catch {
            setError("Could not join the team");
          } finally {
            setPending(false);
          }
        }}
        className="self-start rounded-md border border-[#e6edf3]/40 bg-white/[0.06] px-4 py-2 font-mono text-sm text-white transition-colors hover:border-[#e6edf3]/70 disabled:opacity-40"
      >
        {pending ? "Joining…" : `Join ${teamName}`}
      </button>
      {error && (
        <p role="alert" className="text-sm text-[#f85149]">
          {error}
        </p>
      )}
    </div>
  );
}
