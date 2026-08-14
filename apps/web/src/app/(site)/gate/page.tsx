import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PageHeader from "@/components/page-header";
import GateForm from "@/components/gate-form";
import { GATE_COOKIE, isGateActive, verifyGateCookie } from "@/lib/gate";

export const metadata: Metadata = {
  title: "Access · OWASP CTF @ DEF CON 34",
  robots: { index: false },
};

/** The pre-event lock screen the proxy sends /challenges visitors to. Reading
 *  cookies() makes this page dynamic on purpose: the redirect below is the
 *  self-heal for a stale prefetched proxy redirect, and it must see the fresh
 *  cookie. Its condition is the exact complement of the proxy's, so the two
 *  can never loop. */
export default async function GatePage() {
  const store = await cookies();
  if (!isGateActive() || verifyGateCookie(store.get(GATE_COOKIE)?.value)) redirect("/challenges");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Access"
        title="Challenges are locked"
        description="The challenge board opens when the conference starts. Have the access password from the organizers? Enter it below."
      />
      <div className="ds-card max-w-md rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
        <GateForm />
      </div>
    </div>
  );
}
