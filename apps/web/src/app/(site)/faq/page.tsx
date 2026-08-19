// /faq is a PLATFORM frame with module contributions, on the same basis as
// /rules and /how-to-play. The platform owns the page furniture and the three
// questions that hold on any event whatsoever — can I compete solo, is there a
// prize, where do I find an organizer — and each enabled module contributes
// the questions that name its own artifacts.
//
// This page was 100% secure-development, and it is in the HEADER NAV: a
// quiz-only event linked contestants straight from its own navigation to a
// page telling them to fork a target, open a pull request, and wait for the
// scorer. Not an obscure corner.
//
// Server Component, and must stay one: `ModuleFaq` is a FUNCTION of the live
// event facts, called here so only plain data reaches the client accordion.
// See lib/modules.ts for why it never rides on a ResolvedModule.
import type { Metadata } from "next";
import PageHeader from "@/components/page-header";
import ModuleCopy from "@/components/module-copy";
import FaqAccordion, { type QA } from "@/components/faq-accordion";
import { enabledApps, joinAppNames } from "@/lib/apps";
import type { OrgContext } from "@/lib/modules";
import { getModuleFaq, getResolvedModules } from "@/lib/resolved-modules";
import { event } from "@/lib/site";
import { eventConfig } from "@/lib/event-config";

export const metadata: Metadata = {
  title: "FAQ",
  // Module-agnostic: this page's questions come from whichever modules the
  // event enables, so the description cannot name one of them (it used to say
  // "secure development CTF" on every event, including one with no such
  // module).
  description: `Frequently asked questions about ${event.name}.`,
};

export default async function FaqPage() {
  const ctx: OrgContext = {
    appCount: enabledApps.length,
    appList: joinAppNames(enabledApps.map((a) => a.name)),
    githubOrg: eventConfig.githubOrg,
  };

  // Registry order, plain data: the `faq` blocks are invoked HERE, on the
  // server, and only the resulting `Copy` travels into <ModuleCopy>.
  const contributions = (await getResolvedModules()).flatMap((module) => {
    const faq = getModuleFaq(module.id);
    return faq ? [faq(ctx)] : [];
  });
  const fromModules = (section: "gettingStarted" | "prep" | "playing"): QA[] =>
    contributions
      .flatMap((c) => c[section] ?? [])
      .map((item) => ({ q: item.q, id: item.id, a: <ModuleCopy copy={item.a} /> }));

  // The platform's own questions are interleaved, not bolted on either end:
  // "Can I compete solo?" belongs between a module's "do I need experience"
  // and its "what do I need to bring", and the page reads wrong if every
  // module question is shunted to one end. That is what the buckets are for.
  const faqs: QA[] = [
    ...fromModules("gettingStarted"),
    {
      q: "Can I compete solo?",
      a: "Yes, and it's the default. Teams are optional: you can join or create one from your profile after signing in, up to four people.",
    },
    ...fromModules("prep"),
    ...fromModules("playing"),
    {
      q: "Is there a prize?",
      a: "Yes. Prizes go to the top individuals and top teams overall. You must be present at the closing ceremony to claim.",
    },
    {
      q: "Where do I ask for help during the event?",
      a: (
        <>
          Find an organizer at the OWASP CTF area
          {event.discordUrl && (
            <>
              , or join the{" "}
              <a
                href={event.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ds-link"
              >
                CTF Discord
              </a>
              , where scoring questions, stuck runs, and organizer announcements go
            </>
          )}
          .
        </>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Questions"
        title="FAQ"
        description={
          <>
            Quick answers to the things contestants ask most. Still stuck? Find an organizer at
            the OWASP CTF area
            {event.discordUrl && (
              <>
                , or ask in the{" "}
                <a
                  href={event.discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-link"
                >
                  CTF Discord
                </a>
              </>
            )}
            .
          </>
        }
      />
      <FaqAccordion items={faqs} />
    </div>
  );
}
