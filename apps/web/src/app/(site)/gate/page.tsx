import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PageHeader from "@/components/page-header";
import GateForm from "@/components/gate-form";
import { GATE_COOKIE, isGateActive, verifyGateCookie } from "@/lib/gate";
import { enabledModules, isModuleEnabled } from "@/lib/modules";

export const metadata: Metadata = {
  title: "Access",
  robots: { index: false },
};

/** The route this gate is standing in front of — the first enabled module's
 *  own route, in registry order.
 *
 *  DERIVED, because it used to be a hardcoded `/challenges`: on an event that
 *  doesn't run secure-development that route does not exist, so the lock
 *  screen's own redirect was a guaranteed 404. Read off the registry rather
 *  than through `getResolvedModules` on purpose — the lock screen is the one
 *  page a pre-event crowd hammers, and it has no business making a settings
 *  read to decide where to send someone. That costs the organizer's rename on
 *  this one screen; every other surface still honours it.
 *
 *  "/" is the floor for an event whose modules have no route at all. */
const gatedModule = enabledModules.find((m) => m.nav);
const UNLOCKED_DESTINATION = gatedModule?.nav?.href ?? "/";
const UNLOCK_LABEL = gatedModule ? `Unlock ${gatedModule.nav!.label.toLowerCase()}` : "Unlock";

// The lock screen speaks in secure-development's noun ("the challenge board")
// on an event that runs it, and neutrally otherwise. A third module wanting
// its own wording here should graduate this to a registry block, the way
// `emptyBoard` did for the leaderboard's empty state; two strings on a lock
// screen do not earn one yet.
const secureDev = isModuleEnabled("secure-development");

/** The pre-event lock screen the proxy sends visitors to. Reading cookies()
 *  makes this page dynamic on purpose: the redirect below is the self-heal for
 *  a stale prefetched proxy redirect, and it must see the fresh cookie. Its
 *  condition is the exact complement of the proxy's, so the two can never
 *  loop. */
export default async function GatePage() {
  const store = await cookies();
  if (!isGateActive() || verifyGateCookie(store.get(GATE_COOKIE)?.value)) {
    redirect(UNLOCKED_DESTINATION);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Access"
        title={secureDev ? "Challenges are locked" : "This event is locked"}
        description={
          secureDev
            ? "The challenge board opens when the conference starts. Have the access password from the organizers? Enter it below."
            : "The event opens when the conference starts. Have the access password from the organizers? Enter it below."
        }
      />
      <div className="ds-card max-w-md rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
        <GateForm destination={UNLOCKED_DESTINATION} unlockLabel={UNLOCK_LABEL} />
      </div>
    </div>
  );
}
