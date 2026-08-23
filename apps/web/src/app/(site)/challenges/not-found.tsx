// 404 boundary for /challenges.
//
// The page calls `notFound()` for exactly ONE reason: this event is not
// running the secure-development module right now. So this says that, instead of the
// root 404's "the link is just wrong or out of date" — which is true for a
// typo and false here. A contestant who had this page open a minute ago, or
// who followed a link an organizer posted this morning, has a correct link and
// a working browser; telling them otherwise sends them hunting for a better
// URL that does not exist.
//
// Unlike quiz and classic, secure-development is NOT runtime-toggleable
// (ADR 52) — it needs its scorer, its poller and its provisioned forks. So on
// this route the module is not "switched off" but simply not part of this
// event, and the copy says so: there is no organizer action that brings it
// back mid-event, and implying otherwise would have contestants waiting.
//
// Inherits the `(site)` layout, so the nav and footer are already there — the
// body deliberately renders neither.

import NotFoundBody, { getNotFoundRoutes } from "@/components/not-found-body";
import { moduleDefById } from "@/lib/modules";

export default async function ChallengesNotFound() {
  const routes = await getNotFoundRoutes();
  const name = moduleDefById("secure-development")?.displayName ?? "This module";
  return (
    <NotFoundBody
      routes={routes}
      eyebrow="Not running"
      title={`This event doesn't run ${name}`}
      description={`${name} isn't part of this event. Your link is fine — it points at a module this particular CTF was not set up with, rather than at a page that is broken or gone. Here is what this event does have open.`}
    />
  );
}
