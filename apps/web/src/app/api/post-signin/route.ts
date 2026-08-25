// The landing step every GitHub sign-in routes through (issue #217). Sign-in
// buttons pass their real destination as ?next=, and this decides whether the
// visitor sees it directly or meets the team step first — see
// lib/post-signin.ts for the decision logic and its exemptions.
//
// A GET that only ever 302s: it writes nothing, so a prefetch or a link
// preview hitting it can at worst follow a redirect.
import { auth } from "@/lib/auth";
import { isAdminLogin } from "@/lib/admin-auth";
import { hasTeam } from "@/lib/team-store";
import { resolvePostSigninTarget, sanitizeNext } from "@/lib/post-signin";

export async function GET(request: Request) {
  const next = sanitizeNext(new URL(request.url).searchParams.get("next"));

  const session = await auth.api.getSession({ headers: request.headers });
  const login = (session?.user as { login?: string } | undefined)?.login;
  // No session on a post-signin hop means the sign-in didn't complete —
  // land home, where the CTA offers it again.
  if (!login) return Response.redirect(new URL("/", request.url), 302);

  // hasTeam fails OPEN on a store error (team-store.ts), so a Redis blip
  // sends people to their destination rather than herding everyone to the
  // team card; isAdminLogin returns false on error, which only means an
  // organizer sees the team card once — annoying, not wrong.
  const [isAdmin, teamed] = await Promise.all([isAdminLogin(login), hasTeam(login)]);
  const target = resolvePostSigninTarget({ next, isAdmin, teamless: !teamed });
  return Response.redirect(new URL(target, request.url), 302);
}
