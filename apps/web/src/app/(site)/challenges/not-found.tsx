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
// secure-development is runtime-toggleable now (issue #386): its switch
// locks only on a deployment with no scorer image, exactly like the other
// modules' switches lock for their own reasons. So this route means the same
// thing /flags and /quiz's boundaries do — "switched off, not gone" — for a
// deployment that HAS a scorer image, and carries the same copy.
//
// A deployment with NO scorer image at all is a different claim, not a
// harsher version of the same one (CodeRabbit round 1 finding D): this event
// never ran secure-development, an organizer never "turned it off", and it
// is not coming "back" from anywhere. Saying so anyway would be the same
// false promise the other boundaries exist to avoid making, just aimed at a
// different fact.
//
// Inherits the `(site)` layout, so the nav and footer are already there — the
// body deliberately renders neither.

import NotFoundBody, { getNotFoundRoutes } from "@/components/not-found-body";
import { moduleDefById } from "@/lib/modules";
import { secureDevAvailable } from "@/lib/module-defaults";

export default async function ChallengesNotFound() {
  const routes = await getNotFoundRoutes();
  const name = moduleDefById("secure-development")?.displayName ?? "This module";
  if (!secureDevAvailable(process.env)) {
    return (
      <NotFoundBody
        routes={routes}
        eyebrow="Not running"
        title={`${name} isn't available on this event`}
        description={`This event runs without a scorer, so ${name} can't be played here. Your link is fine and nothing you have already solved is affected. Here is what this event does have open.`}
      />
    );
  }
  return (
    <NotFoundBody
      routes={routes}
      eyebrow="Not running"
      title={`${name} is switched off`}
      description={`This event isn't running ${name} at the moment. Your link is fine and nothing you have already solved is affected — an organizer turned the module off, and it can come back just as quickly. Here is what this event does have open.`}
    />
  );
}
