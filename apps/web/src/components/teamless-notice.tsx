// Told BEFORE the submit, not after it (issue #357).
//
// Scoring is per team, and every submit route refuses a teamless login with
// `403 no-team`. Contestants never see this: `redirectIfTeamless` sends them
// to team setup before a module page renders. Admins are exempt from that
// redirect on purpose — an organizer checking that their content renders is
// not playing — but the exemption used to cover the information too, so the
// form appeared, the submission was refused, and the rule arrived attached to
// a solve that did not count.
//
// This is the missing half of that exemption: keep the pass-through, drop the
// surprise. Rendered above the form on every page that has one, for a viewer
// `redirectIfTeamless` let through without a team.
//
// It names **Play solo** because that is the one-click answer and the refusal
// copy does not say it: a team of one is a team, and the profile's own control
// creates one with no invite and no waiting.

import Link from "next/link";
import { TEAM_SETUP_PATH } from "@/lib/post-signin";

export default function TeamlessNotice({ what = "solves" }: { what?: string }) {
  return (
    <div
      className="ds-card rounded-lg border border-[#d4a017]/30 bg-[#d4a017]/[0.06] p-5"
      // Not `role="alert"`: this is page furniture present from first paint,
      // not something that just happened, and an alert would interrupt a
      // screen reader mid-heading on every module page an organizer opens.
      data-testid="teamless-notice"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-[#d4a017]">
        You are not on a team
      </p>
      <p className="mt-1 text-sm leading-relaxed text-zinc-300">
        Organizers can browse every module without one, so nothing below is blocked — but
        scoring is per team, and {what} submitted while you are on no team are refused and
        count for nobody.{" "}
        <Link href={TEAM_SETUP_PATH} className="underline underline-offset-2 hover:text-white">
          Create or join one on your profile
        </Link>
        , or hit <strong className="font-medium text-zinc-200">Play solo</strong> there for a
        one-click team of one.
      </p>
    </div>
  );
}
