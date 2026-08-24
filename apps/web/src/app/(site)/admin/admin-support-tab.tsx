"use client";

// Live-event support: act on ONE contestant or ONE team (issue #168).
//
// Before this, the only destructive control in the panel was the master reset,
// so an organizer facing a single stuck contestant chose between doing nothing
// and wiping the event. This tab is the missing middle.
//
// Look up first, then act. Every destructive control here stays disabled until
// a lookup has returned, because the whole failure mode this tab has to avoid
// is an organizer resetting the wrong person from a half-remembered username
// while a room waits. Seeing the score you are about to delete is the guard.
//
// Self-contained state, same reasoning as admin-admins-tab: this talks to its
// own endpoints with their own shapes, and folding it into the shell's shared
// settings `apply` would make that helper mean two different things.

import { useState } from "react";
import type { ConfirmState } from "./types";

type UserDetail = {
  login: string;
  team: { slug: string; name: string; captain: string | null; isCaptain: boolean; joinedAt: string | null } | null;
  firstTeamAt: string | null;
  quiz: { answered: number; points: number; attempts: number };
  classic: { solved: number; points: number; attempts: number };
  secureDev: { solves: number };
  hints: { bought: number; spent: number };
  known: boolean;
};

const FIELD =
  "w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white placeholder:text-muted focus-visible:border-[#d29922]/70 focus-visible:outline-none";
// Both action styles carry a DESIGNED disabled state, not an opacity fade.
// Every control on this tab is disabled at rest (nothing is actionable until
// a lookup returns or both team fields are filled), so the disabled state is
// the one an organizer sees on arrival — and the old pair sent opposite
// signals for the same gating: a solid-blue "Transfer captaincy" that looked
// live next to a faded "Disband team" that looked dead (issue #200, 3.2).
// Same treatment as team-card.tsx's PAIRED_ACTION_CLASS, the #195 fix.
const BTN =
  "flex-none rounded-md bg-[#e6edf3] px-3 py-1.5 text-xs font-medium text-[#0b0e14] transition-colors hover:bg-white " +
  "disabled:cursor-not-allowed disabled:border disabled:border-white/10 disabled:bg-transparent disabled:text-zinc-500";
const DANGER =
  "flex-none rounded-md border border-[#f85149]/50 px-3 py-1.5 text-xs text-[#f85149] transition-colors hover:bg-[#f85149]/10 " +
  "disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-transparent disabled:text-zinc-500";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-mono text-sm tabular-nums text-white">{value}</p>
    </div>
  );
}

export default function AdminSupportTab({
  setConfirm,
}: {
  setConfirm: (c: ConfirmState | null) => void;
}) {
  const [login, setLogin] = useState("");
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [teamSlug, setTeamSlug] = useState("");
  const [teamLogin, setTeamLogin] = useState("");

  /** Runs a request and folds the outcome into the shared notice/error state.
   *  `after` re-reads the contestant when one is on screen, so the panel never
   *  shows a score that an action on this very tab just deleted. */
  async function run(
    fn: () => Promise<Response>,
    describe: (data: Record<string, unknown>) => string,
    after?: () => Promise<void>,
  ) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Request failed");
        return;
      }
      setNotice(describe(data));
      if (after) await after();
    } catch {
      setError("Request failed");
    } finally {
      setPending(false);
    }
  }

  async function lookup(target = login) {
    const trimmed = target.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/ops/user?login=${encodeURIComponent(trimmed)}`);
      const data = (await res.json().catch(() => ({}))) as UserDetail & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Lookup failed");
        setDetail(null);
        return;
      }
      setDetail(data);
    } catch {
      setError("Lookup failed");
      setDetail(null);
    } finally {
      setPending(false);
    }
  }

  const refresh = async () => {
    if (detail) await lookup(detail.login);
  };

  /** Warnings the server returns (the Secure Development re-ingest caveat)
   *  ride along with the success notice — they are the part an organizer has
   *  to act on, so they must not be swallowed by a cheerful "done". */
  const withWarnings = (base: string, data: Record<string, unknown>) => {
    const warnings = Array.isArray(data.warnings) ? (data.warnings as string[]) : [];
    return warnings.length ? `${base} — ${warnings.join(" ")}` : base;
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Find a contestant</h3>
          <p className="text-xs text-muted">
            Look them up before acting. Every control below stays disabled until a lookup returns.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            id="support-login"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void lookup();
            }}
            placeholder="GitHub login"
            aria-label="GitHub login"
            className={FIELD}
          />
          <button type="button" disabled={pending || !login.trim()} onClick={() => void lookup()} className={BTN}>
            Look up
          </button>
        </div>
      </section>

      {detail && (
        <section className="flex flex-col gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-white">{detail.login}</p>
            {!detail.known && (
              <span className="rounded border border-[#d29922]/40 bg-[#d29922]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#d29922]">
                no data — check the spelling
              </span>
            )}
          </div>

          <p className="text-xs text-zinc-400">
            {detail.team ? (
              <>
                Team <span className="font-mono text-white">{detail.team.name}</span>
                <span className="text-muted"> ({detail.team.slug})</span>
                {detail.team.isCaptain && <span className="text-[#d29922]"> — captain</span>}
              </>
            ) : (
              "On no team."
            )}
            {detail.team?.joinedAt && (
              <span className="text-muted"> — joined {detail.team.joinedAt.slice(0, 16).replace("T", " ")}</span>
            )}
          </p>

          {detail.firstTeamAt && (
            <p className="text-[11px] text-muted">
              First on a team {detail.firstTeamAt.slice(0, 16).replace("T", " ")} UTC
              {detail.team?.joinedAt && detail.firstTeamAt !== detail.team.joinedAt && " (has switched teams since)"}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Quiz pts" value={detail.quiz.points} />
            <Stat label="Classic pts" value={detail.classic.points} />
            <Stat label="Quiz answered" value={detail.quiz.answered} />
            <Stat label="Classic solved" value={detail.classic.solved} />
            <Stat label="Sec-dev solves" value={detail.secureDev.solves} />
            <Stat label="Attempts" value={detail.quiz.attempts + detail.classic.attempts} />
            <Stat label="Hints bought" value={detail.hints.bought} />
            <Stat label="Hints spend" value={detail.hints.spent} />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            <button
              type="button"
              disabled={pending}
              className={DANGER}
              onClick={() =>
                setConfirm({
                  title: `Reset ${detail.login}'s progress?`,
                  danger: true,
                  requireType: detail.login,
                  confirmLabel: "Reset progress",
                  body: (
                    <>
                      Clears their quiz answers, classic solves, attempts and hints — {detail.quiz.points + detail.classic.points} points in total. Their account and team stay.
                      {detail.secureDev.solves > 0 && (
                        <>
                          {" "}
                          <strong>
                            Their {detail.secureDev.solves} Secure Development solves are re-ingested from PR comments and will come back if that PR is scored again.
                          </strong>{" "}
                          Close the PR or freeze scoring to make this stick.
                        </>
                      )}
                    </>
                  ),
                  onConfirm: () =>
                    run(
                      () =>
                        fetch("/api/admin/ops/user", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ login: detail.login, action: "reset" }),
                        }),
                      (data) => withWarnings(`Reset ${detail.login}.`, data),
                      refresh,
                    ),
                })
              }
            >
              Reset progress
            </button>

            <button
              type="button"
              disabled={pending}
              className={DANGER}
              onClick={() =>
                setConfirm({
                  title: `Delete ${detail.login}?`,
                  danger: true,
                  requireType: detail.login,
                  confirmLabel: "Delete contestant",
                  body: (
                    <>
                      Removes their progress, hints, team membership and account record. This cannot be undone.
                      {detail.team?.isCaptain && (
                        <>
                          {" "}
                          <strong>
                            They captain &ldquo;{detail.team.name}&rdquo; — transfer the captaincy or disband that team first.
                          </strong>
                        </>
                      )}
                    </>
                  ),
                  onConfirm: () =>
                    run(
                      () =>
                        fetch("/api/admin/ops/user", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ login: detail.login }),
                        }),
                      (data) => withWarnings(`Deleted ${detail.login}.`, data),
                      async () => setDetail(null),
                    ),
                })
              }
            >
              Delete contestant
            </button>

            {detail.team && !detail.team.isCaptain && (
              <button
                type="button"
                disabled={pending}
                className={DANGER}
                onClick={() =>
                  setConfirm({
                    title: `Remove ${detail.login} from ${detail.team?.name}?`,
                    danger: true,
                    confirmLabel: "Remove from team",
                    body: <>Their progress is kept — only the membership goes.</>,
                    onConfirm: () =>
                      run(
                        () =>
                          fetch("/api/admin/ops/team", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              slug: detail.team?.slug,
                              login: detail.login,
                              action: "remove-member",
                            }),
                          }),
                        () => `Removed ${detail.login} from ${detail.team?.slug}.`,
                        refresh,
                      ),
                  })
                }
              >
                Remove from team
              </button>
            )}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 border-t border-white/[0.06] pt-5">
        <div>
          <h3 className="text-sm font-semibold text-white">Team actions</h3>
          <p className="text-xs text-muted">
            The captain-only controls, for when the captain is unreachable — a captainless team
            cannot rename, remove anyone, regenerate its code, or disband on its own.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="support-team-slug"
            value={teamSlug}
            onChange={(e) => setTeamSlug(e.target.value)}
            placeholder="team-slug"
            aria-label="Team slug"
            className={FIELD}
          />
          <input
            id="support-team-login"
            value={teamLogin}
            onChange={(e) => setTeamLogin(e.target.value)}
            placeholder="new captain's login"
            aria-label="New captain's login"
            className={FIELD}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || !teamSlug.trim() || !teamLogin.trim()}
            className={BTN}
            onClick={() =>
              setConfirm({
                title: `Make ${teamLogin.trim()} captain of ${teamSlug.trim()}?`,
                confirmLabel: "Transfer captaincy",
                body: <>They must already be a member of that team.</>,
                onConfirm: () =>
                  run(
                    () =>
                      fetch("/api/admin/ops/team", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          slug: teamSlug.trim(),
                          login: teamLogin.trim(),
                          action: "transfer-captain",
                        }),
                      }),
                    () => `${teamLogin.trim()} now captains ${teamSlug.trim()}.`,
                    refresh,
                  ),
              })
            }
          >
            Transfer captaincy
          </button>

          <button
            type="button"
            disabled={pending || !teamSlug.trim()}
            className={DANGER}
            onClick={() =>
              setConfirm({
                title: `Disband ${teamSlug.trim()}?`,
                danger: true,
                requireType: teamSlug.trim(),
                confirmLabel: "Disband team",
                body: (
                  <>
                    Every member is released and the join code stops working. Nobody&rsquo;s points are
                    deleted — solves are per contestant, so the players keep what they earned and can
                    regroup.
                  </>
                ),
                onConfirm: () =>
                  run(
                    () =>
                      fetch("/api/admin/ops/team", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ slug: teamSlug.trim() }),
                      }),
                    (data) => `Disbanded ${teamSlug.trim()} (${String(data.members ?? 0)} released).`,
                    refresh,
                  ),
              })
            }
          >
            Disband team
          </button>
        </div>
      </section>

      {error && <p className="text-xs text-[#f85149]">{error}</p>}
      {notice && <p className="text-xs text-[#3fb950]">{notice}</p>}
    </div>
  );
}
