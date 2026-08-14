"use client";

// Team join/create/leave control on the profile page. All writes go through
// the /api/team route handlers, which authenticate the session and enforce
// the team-size cap server-side (see src/lib/team-store.ts) — this component
// is display + dispatch only.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TeamInfo } from "@/lib/team-store";

async function postTeam(path: string, body?: Record<string, string>) {
  const res = await fetch(`/api/team${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Request failed");
}

export default function TeamCard({
  team,
  writesEnabled,
  maxMembers,
}: {
  team: TeamInfo | null;
  writesEnabled: boolean;
  maxMembers: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "join">("join");
  const [value, setValue] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      setValue("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Team</h2>
        {!writesEnabled && (
          <span className="rounded border border-[#d4a017]/40 bg-[#d4a017]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#d4a017]">
            mock mode
          </span>
        )}
      </div>

      {team ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate font-mono text-white">{team.name}</p>
              {team.slug !== team.name && (
                <p className="truncate text-xs text-muted">slug: {team.slug}</p>
              )}
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => postTeam("/leave"))}
              className="flex-none rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-[#e53e3e]/50 hover:text-white disabled:opacity-50"
            >
              Leave team
            </button>
          </div>
          {team.members.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {team.members.map((member) => (
                <span
                  key={member}
                  className="rounded-full border border-white/10 bg-[#12121e] px-2.5 py-1 font-mono text-xs text-zinc-300"
                >
                  {member}
                </span>
              ))}
              <span className="text-xs text-muted">
                {team.members.length} / {maxMembers} players
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMode("join")}
              className={`rounded-full border px-2.5 py-0.5 ${mode === "join" ? "border-[#2563eb] text-[var(--accent-blue-link)]" : "border-white/10 text-zinc-400"}`}
            >
              Join
            </button>
            <button
              type="button"
              onClick={() => setMode("create")}
              className={`rounded-full border px-2.5 py-0.5 ${mode === "create" ? "border-[#2563eb] text-[var(--accent-blue-link)]" : "border-white/10 text-zinc-400"}`}
            >
              Create
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === "join" ? "team slug" : "team name"}
              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white placeholder:text-muted focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
            />
            <button
              type="button"
              disabled={pending || !value.trim()}
              onClick={() =>
                run(() =>
                  mode === "join" ? postTeam("/join", { slug: value }) : postTeam("", { name: value }),
                )
              }
              className="flex-none rounded-md bg-[#2563eb] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2563eb]/90 disabled:opacity-50"
            >
              {mode === "join" ? "Join" : "Create"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-[#e53e3e]">{error}</p>}
    </div>
  );
}
