// Banner explaining that the active leaderboard source is illustrative mock
// data. Only rendered while LEADERBOARD_SOURCE=mock — see getLeaderboardSourceMode.

import EventCountdown from "./event-countdown";

export default function MockDataNotice({
  startsAt,
}: {
  /** The countdown's target — the caller's `getSite().ctfStartsAt` (the
   *  leaderboard page already reads it for this same request). Required,
   *  like `EventCountdown`'s own prop. */
  startsAt: string | null;
}) {
  return (
    <div className="ds-card flex flex-col gap-4 rounded-lg border border-[#d4a017]/30 bg-[#d4a017]/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-xl">
        <p className="text-xs font-medium uppercase tracking-wider text-[#d4a017]">
          Mock data
        </p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-300">
          The standings below are illustrative placeholder data, not real contestant results.
          Once the CTF opens and the first patches land, this board switches over to live scores.
        </p>
      </div>
      {startsAt && <EventCountdown startsAt={startsAt} variant="compact" hideWhenComplete />}
    </div>
  );
}
