"use client";

// The classic (jeopardy-style flag) module's interactive surface. Owns the
// per-challenge flag input and dispatches to /api/classic/submit, which
// authenticates the session and is the sole authority on grading, the
// already-solved guard, and the cooldown (see src/lib/classic-store.ts). This
// component never sees — and cannot render — a flag: `ClassicChallengeView`
// has no field that could carry one.
//
// State split, same shape as quiz-board.tsx: `challenges` (the prop) is the
// server's source of truth for each challenge's status; `inputs` / `pending`
// / `feedback` are UI-only, keyed by challenge id, and survive a
// `router.refresh()` (which re-renders the server parent with fresh props)
// since this component instance isn't remounted.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Markdown from "@/components/markdown";
import { formatCompact, getRemaining, type Remaining } from "@/lib/countdown";

/** Per-challenge progress, mutually exclusive. Every branch carries only
 *  public-safe data — never a flag, in either form. */
export type ClassicStatus =
  | { status: "unsolved" }
  | { status: "solved"; earnedPoints: number }
  | { status: "cooldown"; retryAt: string };

/** What the board needs to render one challenge — deliberately just the
 *  public `Challenge` fields, this challenge's solve count, and this
 *  viewer's derived status. Built by the server page from `listChallenges()`
 *  + `getViewerClassic()` + `getSolveCounts()`, field by field — never from a
 *  spread of a raw store record, which is how a flag would leak. */
export type ClassicChallengeView = {
  id: string;
  title: string;
  category: string;
  description: string;
  points: number;
  solveCount: number;
} & ClassicStatus;

type SubmitResponse =
  | { correct: true; points: number; already?: boolean }
  | { correct: false }
  | { error: string; retryAt?: string };

type Feedback = { kind: "success" | "error" | "info"; text: string };

/** Feedback for an accepted (correct) submission. The `already` branch is NOT
 *  cosmetic — mirrors `describeCorrect` in quiz-board.tsx: `/api/classic/
 *  submit` reports an idempotent re-submission of a flag this login had
 *  already banked as `correct: true, points: 0`, and rendering that through
 *  the normal template would announce "Correct — +0 points." — the opposite
 *  of the truth. Exported for direct testing. */
export function describeCorrect(points: number, already?: boolean): string {
  if (already) return "You already solved this one — those points are already yours.";
  return `Correct — +${points} point${points === 1 ? "" : "s"}.`;
}

function describeRefusal(reason: string): string {
  switch (reason) {
    case "paused":
      return "Scoring is paused right now. Try again later.";
    case "solved":
      return "You already solved this one.";
    case "cooldown":
      // Deliberately no instant here. The challenge's own cooldown line runs
      // a live countdown; a second, frozen copy of the same deadline in the
      // feedback area would be stale the moment it rendered.
      return "On cooldown right now — the timer above shows when you can retry.";
    case "unavailable":
      return "Couldn't verify that right now. Try again in a moment.";
    default:
      return "That submission wasn't accepted.";
  }
}

/** Ticks a challenge's cooldown once a second. Identical shape to
 *  `quiz-board.tsx`'s `useCooldown` — see its comment for why `mounted` stays
 *  false through the server render AND the client's first paint (so both
 *  produce identical markup and hydration can't mismatch), and why parking
 *  (no `retryAt`) still calls the hook unconditionally. */
function useCooldown(retryAt: string | undefined): { mounted: boolean; remaining: Remaining | null } {
  const [state, setState] = useState<{ mounted: boolean; remaining: Remaining | null }>({
    mounted: false,
    remaining: null,
  });

  useEffect(() => {
    if (!retryAt) return;
    const targetMs = new Date(retryAt).getTime();
    const tick = () => setState({ mounted: true, remaining: getRemaining(targetMs) });
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [retryAt]);

  return state;
}

export default function ClassicBoard({
  categories,
  challenges,
  authenticated,
}: {
  /** The organizer's category display order — categories render in this
   *  order, and a category with no matching challenge is skipped entirely. */
  categories: string[];
  /** Already in the board's reading order (server-sorted); this component
   *  only filters by category, it never re-sorts. */
  challenges: ClassicChallengeView[];
  /** False for a signed-out visitor: challenges stay visible, but submitting
   *  requires a GitHub session (`/api/classic/submit` 401s otherwise), so an
   *  unsolved challenge renders a sign-in prompt instead of a flag input. */
  authenticated: boolean;
}) {
  const router = useRouter();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback | undefined>>({});

  // Rendered unconditionally — NOT nested inside a `challenges.length > 0`
  // branch, and not conditioned on `authenticated` either. A signed-out
  // visitor and an event with zero challenges are both real states this kit
  // has shipped regressions for by nesting this line; "0 of 0" and "0 of 1"
  // must both still show it.
  const solvedCount = challenges.filter((c) => c.status === "solved").length;

  async function submit(challenge: ClassicChallengeView) {
    const flag = (inputs[challenge.id] ?? "").trim();
    if (!flag || pending[challenge.id]) return;

    setPending((prev) => ({ ...prev, [challenge.id]: true }));
    setFeedback((prev) => ({ ...prev, [challenge.id]: undefined }));
    try {
      const res = await fetch("/api/classic/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id, flag }),
      });
      const data = (await res.json().catch(() => ({}))) as SubmitResponse;
      if (res.ok && "correct" in data) {
        setFeedback((prev) => ({
          ...prev,
          [challenge.id]: data.correct
            ? { kind: "success", text: describeCorrect(data.points, data.already) }
            : { kind: "error", text: "Not quite. Try again." },
        }));
      } else if ("error" in data && typeof data.error === "string") {
        setFeedback((prev) => ({
          ...prev,
          [challenge.id]: { kind: "info", text: describeRefusal(data.error) },
        }));
      } else {
        setFeedback((prev) => ({ ...prev, [challenge.id]: { kind: "error", text: "Something went wrong. Try again." } }));
      }
    } catch {
      setFeedback((prev) => ({ ...prev, [challenge.id]: { kind: "error", text: "Something went wrong. Try again." } }));
    } finally {
      setPending((prev) => ({ ...prev, [challenge.id]: false }));
      // Resyncs status (unsolved/solved/cooldown) from the server's own
      // derivation — this component never decides that for itself.
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-zinc-400">
        {solvedCount} of {challenges.length} solved.
      </p>
      {categories.map((category) => {
        const inCategory = challenges.filter((c) => c.category === category);
        if (inCategory.length === 0) return null; // A category with no challenges is hidden.
        return (
          <div key={category} className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-white">{category}</h2>
            <div className="flex flex-col gap-4">
              {inCategory.map((challenge) => (
                <ChallengeCard
                  key={challenge.id}
                  challenge={challenge}
                  authenticated={authenticated}
                  value={inputs[challenge.id] ?? ""}
                  pending={pending[challenge.id] ?? false}
                  feedback={feedback[challenge.id]}
                  onChange={(value) => setInputs((prev) => ({ ...prev, [challenge.id]: value }))}
                  onSubmit={() => submit(challenge)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChallengeCard({
  challenge,
  authenticated,
  value,
  pending,
  feedback,
  onChange,
  onSubmit,
}: {
  challenge: ClassicChallengeView;
  authenticated: boolean;
  value: string;
  pending: boolean;
  feedback?: Feedback;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const cooldown = useCooldown(challenge.status === "cooldown" ? challenge.retryAt : undefined);
  // Once the countdown reaches zero the form re-opens without a refresh. Safe
  // to do optimistically: the grading script re-checks the cooldown inside
  // the same atomic EVAL that records the attempt, so an early click is
  // refused server-side rather than granted.
  const cooledDown = cooldown.mounted && cooldown.remaining === null;
  const inputLocked = pending || (challenge.status === "cooldown" && !cooledDown);

  return (
    <div className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{challenge.title}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {challenge.solveCount} solve{challenge.solveCount === 1 ? "" : "s"}
          </p>
        </div>
        <span className="flex-none rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          {challenge.points} pts
        </span>
      </div>

      <Markdown source={challenge.description} />

      {challenge.status === "solved" && (
        <p className="mt-3 text-sm text-[#22c55e]">
          Solved — earned {challenge.earnedPoints} point{challenge.earnedPoints === 1 ? "" : "s"}.
        </p>
      )}

      {challenge.status === "cooldown" && (
        <p className={`mt-3 text-sm ${cooledDown ? "text-[#22c55e]" : "text-[#d4a017]"}`}>
          {!cooldown.mounted
            ? // Server render and the client's first paint. No clock is read
              // here: a live Date.now() during render disagrees with the
              // server's and trips a hydration mismatch.
              "On cooldown — you can try again shortly."
            : cooldown.remaining
              ? `On cooldown — you can try again in ${formatCompact(cooldown.remaining)}.`
              : "Cooldown's over — you can try again now."}
        </p>
      )}

      {challenge.status !== "solved" &&
        (authenticated ? (
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={value}
              disabled={inputLocked}
              onChange={(e) => onChange(e.target.value)}
              placeholder="CTF{...}"
              className="flex-1 rounded-md border border-white/10 bg-[#12121e] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={inputLocked || value.trim().length === 0}
              className="flex-none rounded-md bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
            >
              {pending ? "Submitting…" : "Submit flag"}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted">Sign in with GitHub to submit a flag.</p>
        ))}

      {feedback && (
        <p
          role="status"
          className={`mt-2 text-sm ${
            feedback.kind === "success" ? "text-[#22c55e]" : feedback.kind === "error" ? "text-[#e53e3e]" : "text-zinc-400"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
