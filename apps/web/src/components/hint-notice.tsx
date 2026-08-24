// Banner making the hint layer visible on the challenges page before it's on:
// until hints are switched on at the event, the per-challenge 💡 buttons don't
// render at all, so this is what tells contestants hints will exist here. Once
// hints are live it switches to a short "how it works" so the buttons below
// need no explanation. Server Component; the page passes the two pieces of
// per-request state the copy depends on (issue #200, 3.1/3.5):
//
// - `signedIn` — "Sign in with GitHub to reveal them" told signed-in visitors
//   to sign in. Copy that names an action the reader has already taken reads
//   as either broken state detection or filler; the clause renders only for
//   the visitor it applies to.
// - `anyMarked` — "Challenges marked 💡" promised marks that don't exist when
//   hints are switched on but no challenge is offering one. The banner then
//   says exactly that instead of sending contestants hunting for bulbs.

import EventCountdown from "./event-countdown";
import { event } from "@/lib/site";

export default function HintNotice({
  active,
  cost,
  signedIn = false,
  anyMarked = true,
}: {
  active: boolean;
  cost: number;
  signedIn?: boolean;
  anyMarked?: boolean;
}) {
  if (active) {
    return (
      <div className="ds-card flex items-start gap-3 rounded-lg border border-[#d29922]/30 bg-[#d29922]/[0.06] p-5">
        <span aria-hidden className="text-lg leading-none">💡</span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[#d29922]">Hints are live</p>
          {anyMarked ? (
            <p className="mt-1 text-sm leading-relaxed text-zinc-300">
              Stuck? Challenges marked 💡 offer a paid hint. Revealing one deducts{" "}
              <span className="font-mono tabular-nums text-[#d29922]">−{cost} pts</span> from your
              leaderboard score.{!signedIn && <> Sign in with GitHub to reveal them.</>}
            </p>
          ) : (
            <p className="mt-1 text-sm leading-relaxed text-zinc-300">
              Hints are enabled for this event, but no challenge is offering one yet — when one
              does, a 💡 button appears on its row and revealing costs{" "}
              <span className="font-mono tabular-nums text-[#d29922]">−{cost} pts</span>.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ds-card flex flex-col gap-4 rounded-lg border border-[#d29922]/30 bg-[#d29922]/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex max-w-xl items-start gap-3">
        <span aria-hidden className="text-lg leading-none">💡</span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[#d29922]">
            Hints unlock at kickoff
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            When the event starts, challenges on this page will offer paid hints: reveal one for{" "}
            <span className="font-mono tabular-nums text-[#d29922]">−{cost} pts</span> off your
            leaderboard score. Spend wisely. The penalty is permanent, but so is the hint.
          </p>
        </div>
      </div>
      {event.ctfStartsAt && <EventCountdown variant="compact" hideWhenComplete />}
    </div>
  );
}
