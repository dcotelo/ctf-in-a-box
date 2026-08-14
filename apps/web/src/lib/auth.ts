import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

/**
 * Stateless better-auth instance: no `database` key, so sessions live entirely
 * in signed/encrypted cookies. The only persistent backend this app has is a
 * read-only Upstash token, so there is nowhere to put user/session tables —
 * and for a weekend event, cookie sessions are all we need. Bump
 * `session.cookieCache.version` to force-invalidate every session at once.
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 7 * 24 * 60 * 60, // survive the whole con weekend
      strategy: "jwe",
      refreshCache: true,
      version: "1",
    },
  },
  account: {
    // Without a `database`, better-auth force-enables this
    // (context/create-context.mjs: `if (!options.database) ... storeAccountCookie: true`),
    // which writes the GitHub access AND refresh token into a client-side
    // `better-auth.account_data` cookie for 7 days. It's JWE-encrypted with a
    // key derived from BETTER_AUTH_SECRET, so it isn't readable by the client
    // — but this app never calls the GitHub API. It only ever reads
    // session.user.{login,name,email,image}. Shipping token material we have
    // no use for is unnecessary attack surface (OWASP A04, data minimisation),
    // so turn it off. An explicit `false` correctly overrides the forced
    // default, since better-auth merges with defu, which only fills in
    // undefined/null.
    storeAccountCookie: false,
  },
  // better-auth mounts its full default endpoint set behind the catch-all at
  // app/api/auth/[...all]. This app only ever calls four of them: /sign-in/social,
  // /callback/:id, /get-session and /sign-out. Everything below is a default
  // endpoint that this app never calls and that either mutates the signed-in
  // identity or hands back provider data, so it is closed at the network edge.
  //
  // disabledPaths is enforced in the router's onRequest (api/index.mjs) as an
  // unconditional 404, before originCheck, before rate limiting, and before
  // sessionMiddleware. Three consequences worth knowing:
  //   - Matching is an exact string compare against normalizePathname(), which
  //     returns the literal request path. It is NOT route-pattern matching, so
  //     a parameterized route like "/reset-password/:token" can never be closed
  //     this way — listing it would look like protection and be none.
  //   - It is a denylist. Adding an auth plugin can introduce new endpoints
  //     that are NOT covered here. auth.test.ts fails when that happens.
  //   - It guards the HTTP boundary only. A server-side auth.api.updateUser()
  //     call bypasses it entirely. No app code makes one; that is an invariant,
  //     not something this setting enforces.
  disabledPaths: [
    // THE IMPORTANT ONE. /update-user takes an arbitrary
    // `z.record(z.string(), z.any())` body behind nothing but sessionMiddleware,
    // runs it through parseUserInput — which accepts any additionalField whose
    // `input` is not false, i.e. `login` — and then, because this app configures
    // no `database`, falls through internalAdapter.updateUser()'s
    // `?? { ...session.user, ...additionalFields }` and re-signs the session
    // cookie. With no server session store that cookie IS the identity, so any
    // signed-in contestant could POST {"login":"someone-else"} and thereafter
    // spend that person's points on hints or move them between teams. Six
    // handlers key their store writes off session.user.login.
    "/update-user",
    // Same shape as /update-user: an arbitrary body behind sessionMiddleware,
    // parsed into the re-signed session. Inert only because this app declares
    // no session.additionalFields, so the parse always comes back empty.
    // Declaring one would make this writable, silently.
    "/update-session",
    // Identity and credential mutation. Verified inert today — /sign-up/email
    // answers EMAIL_PASSWORD_SIGN_UP_DISABLED and /request-password-reset
    // answers RESET_PASSWORD_DISABLED, because no email/password provider is
    // configured. They stay closed so that enabling one later cannot quietly
    // introduce a second identity path where `login` is settable at sign-up.
    "/sign-up/email",
    "/sign-in/email",
    "/change-email",
    "/change-password",
    "/verify-password",
    "/verify-email",
    "/send-verification-email",
    "/request-password-reset",
    "/reset-password",
    "/delete-user",
    "/delete-user/callback",
    // Session enumeration and revocation. Sessions here live only in the
    // client's cookie, so there is no server-side store for these to act on.
    "/list-sessions",
    "/revoke-session",
    "/revoke-sessions",
    "/revoke-other-sessions",
    // Account linking, and the linked-provider disclosure endpoints.
    "/link-social",
    "/unlink-account",
    "/list-accounts",
    "/account-info",
    // These two exist purely to hand a provider token back to the caller.
    // /get-access-token decrypts the account cookie server-side and returns the
    // raw access token as JSON to anyone holding a valid session cookie — a
    // decrypt-on-demand oracle that turns a stolen session into a usable GitHub
    // token. Disabling them means that even if storeAccountCookie is ever
    // flipped back on, a session compromise can't be escalated into a GitHub
    // token.
    "/get-access-token",
    "/refresh-token",
  ],
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      // The GitHub login is the leaderboard row key (the scorer records the
      // PR author's login), so capture it — name/email/image aren't enough.
      mapProfileToUser: (profile) => ({ login: profile.login }),
    },
  },
  user: {
    additionalFields: {
      // SECURITY-RELEVANT FIELD. `login` is the contestant's identity: it keys
      // the leaderboard row, hint spend, and team membership.
      //
      // `input: true` (the default) is required here, and is NOT an oversight.
      // better-auth's parseAdditionalUserInputFromProviderProfile
      // (db/schema.mjs, `if (schema[key]?.input === false) continue`) skips
      // `input: false` fields when mapping the OAuth profile, which leaves
      // session.user.login undefined and breaks the /profile gate. Do not
      // "harden" this to `input: false` — verified against the installed
      // better-auth 1.6.23, it regresses sign-in.
      //
      // The consequence is that `login` remains writable by any endpoint that
      // funnels a request body through parseUserInput. The only such endpoint
      // is /update-user, which is closed above. If you add an auth plugin that
      // registers another one (phone-number and email-otp both do), it inherits
      // the same write path and must be closed too. The durable fix, if this
      // app ever grows a database, is to resolve `login` from the linked GitHub
      // account rather than trusting the session copy.
      login: { type: "string", required: false },
    },
  },
  plugins: [nextCookies()], // keep last
});

export type Session = typeof auth.$Infer.Session;
