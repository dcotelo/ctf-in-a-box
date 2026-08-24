// Banner explaining that the active leaderboard source is illustrative mock
// data. Only rendered while LEADERBOARD_SOURCE=mock — see getLeaderboardSourceMode.

import EventCountdown from "./event-countdown";
import { event } from "@/lib/site";

export default function MockDataNotice() {
  return (
    <div className="ds-card flex flex-col gap-4 rounded-lg border border-[#d29922]/30 bg-[#d29922]/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-xl">
        <p className="text-xs font-medium uppercase tracking-wider text-[#d29922]">
          Mock data
        </p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-300">
          The standings below are illustrative placeholder data, not real contestant results.
          Once the CTF opens and the first patches land, this board switches over to live scores.
        </p>
      </div>
      {event.ctfStartsAt && <EventCountdown variant="compact" hideWhenComplete />}
    </div>
  );
}
