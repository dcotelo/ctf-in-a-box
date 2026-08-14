// Banner making the hint layer visible on the challenges page before it's on:
// until HINTS_ENABLED flips at the event, the per-challenge 💡 buttons don't
// render at all, so this is what tells contestants hints will exist here. Once
// hints are live it switches to a short "how it works" so the buttons below
// need no explanation. Static-safe Server Component (flag is baked at build).

import EventCountdown from "./event-countdown";

export default function HintNotice({ active, cost }: { active: boolean; cost: number }) {
  if (active) {
    return (
      <div className="ds-card flex items-start gap-3 rounded-lg border border-[#d4a017]/30 bg-[#d4a017]/[0.06] p-5">
        <span aria-hidden className="text-lg leading-none">💡</span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[#d4a017]">Hints are live</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            Stuck? Challenges marked 💡 offer a paid hint. Revealing one deducts{" "}
            <span className="font-mono tabular-nums text-[#d4a017]">−{cost} pts</span> from your
            leaderboard score. Sign in with GitHub to reveal them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ds-card flex flex-col gap-4 rounded-lg border border-[#d4a017]/30 bg-[#d4a017]/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex max-w-xl items-start gap-3">
        <span aria-hidden className="text-lg leading-none">💡</span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[#d4a017]">
            Hints unlock at kickoff
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            When the event starts, challenges on this page will offer paid hints: reveal one for{" "}
            <span className="font-mono tabular-nums text-[#d4a017]">−{cost} pts</span> off your
            leaderboard score. Spend wisely. The penalty is permanent, but so is the hint.
          </p>
        </div>
      </div>
      <EventCountdown variant="compact" hideWhenComplete />
    </div>
  );
}
