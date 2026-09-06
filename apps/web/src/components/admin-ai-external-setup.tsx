// "Wiring the external site" — the one place in the admin panel that says
// what the OTHER end has to do.
//
// The panel already handed an organizer the artifacts (endpoint URLs, a
// per-challenge signing key, a test curl, Send test) and the setup checklist
// told them to "stand up the external challenge site against the integration
// contract", with a link. That is enough for whoever writes that site and no
// help to the organizer standing between them and it, who has to answer
// "what do you need from me?" without reading the whole contract first.
//
// So: the handshake in five steps, and the two keys side by side. The keys
// are what operators conflate — one is public, module-wide and fetched, the
// other secret, per challenge and pasted — and mixing them up produces a
// signature failure indistinguishable from a wrong key.
//
// Presentational and secret-free: no store reads, and no signing key is ever
// referenced here (that stays in the per-row integration panel, masked). The
// origin is passed in, hydration-safe, from the same `useBrowserOrigin` the
// endpoints block uses.

import { DOCS_URL } from "@/lib/modules";

/** What the external site must do, in the order it happens. Exported so the
 *  copy is provable by direct call — this repo's component tests render with
 *  `renderToStaticMarkup` and cannot open a disclosure or click anything. */
export const EXTERNAL_STEPS: { title: string; body: string }[] = [
  {
    title: "Take the token out of the launch URL",
    body:
      "A challenge's launch URL must contain the literal {token} placeholder. The box mints a token naming one player and one challenge, substitutes it there, and sends the contestant to the result. No cookie crosses the boundary — that token is the whole identity.",
  },
  {
    title: "Verify it with the launch key",
    body:
      "Fetch the public key once from the launch-key endpoint below and cache it. Verify with hard-coded Ed25519, and pin the audience to the challenge id you expect — never let the token's own alg or kid choose the algorithm or the key.",
  },
  {
    title: "Read live progress, if you show any",
    body:
      "The token carries a snapshot taken at mint time. A session that outlives the page load should re-read the State endpoint rather than trust it.",
  },
  {
    title: "Report the solve, signed",
    body:
      "For an event-mode or both-mode challenge, POST the Event endpoint with the token and the challenge id. Sign the exact bytes \"<unix-timestamp>.<raw request body>\" with THAT challenge's signing key, send it as X-CTF-Signature: sha256=<hex>, and put the same timestamp in X-CTF-Timestamp — the box accepts ±300 seconds either way. Re-serializing the body before signing fails exactly like a wrong key, and is the most expensive mistake available on this endpoint.",
  },
  {
    title: "Expect one award per token",
    body:
      "The token's jti is a one-shot nonce: a replay answers 409, not a second award. Prove the whole path with Send test on a challenge below before the event opens — it runs every check and writes nothing.",
  },
];

/** The two keys, side by side. */
export const KEY_ROLES: { key: string; scope: string; secrecy: string; job: string }[] = [
  {
    key: "Launch key",
    scope: "One per event",
    secrecy: "Public — safe to publish",
    job: "You FETCH it, to verify a launch token",
  },
  {
    key: "Signing key",
    scope: "One per challenge",
    secrecy: "Secret — rotate it if it leaks",
    job: "You PASTE it in, to sign a solve event",
  },
];

export default function AiExternalSetup({ origin }: { origin: string }) {
  return (
    <details className="rounded-md border border-white/[0.06] bg-white/[0.015] px-3 py-3">
      <summary className="cursor-pointer text-sm text-white">
        Wiring the external site — what the other end has to do
      </summary>

      <div className="mt-3 flex flex-col gap-4">
        <p className="text-sm text-muted">
          The box hosts none of the challenge itself. Whoever runs the challenge site needs the endpoints above,
          that challenge&rsquo;s signing key from its own Integration row, and these five behaviours.
        </p>

        <ol className="flex list-decimal flex-col gap-2 pl-5">
          {EXTERNAL_STEPS.map((step) => (
            <li key={step.title} className="text-sm text-zinc-300">
              <span className="text-white">{step.title}.</span> <span className="text-muted">{step.body}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-1">
          <span className="text-sm text-white">The two keys are not interchangeable</span>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="py-1 pr-3 text-xs font-medium uppercase tracking-wide text-muted">Key</th>
                  <th className="py-1 pr-3 text-xs font-medium uppercase tracking-wide text-muted">Scope</th>
                  <th className="py-1 pr-3 text-xs font-medium uppercase tracking-wide text-muted">Secrecy</th>
                  <th className="py-1 text-xs font-medium uppercase tracking-wide text-muted">What you do with it</th>
                </tr>
              </thead>
              <tbody>
                {KEY_ROLES.map((role) => (
                  <tr key={role.key} className="border-b border-white/[0.04] last:border-b-0">
                    <td className="py-1.5 pr-3 text-xs text-white">{role.key}</td>
                    <td className="py-1.5 pr-3 text-xs text-zinc-300">{role.scope}</td>
                    <td className="py-1.5 pr-3 text-xs text-zinc-300">{role.secrecy}</td>
                    <td className="py-1.5 text-xs text-zinc-300">{role.job}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">Public launch key — the external site fetches this once</span>
          <code className="truncate rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-zinc-300">
            {origin}/api/ai/launch-key
          </code>
        </div>

        <p className="text-sm text-muted">
          The full contract — every claim, the error table, the verification snippets —{" "}
          <a
            href={`${DOCS_URL}ai-module`}
            target="_blank"
            rel="noreferrer"
            className="text-white underline hover:no-underline"
          >
            docs/ai-module.md
          </a>
          , which opens with an animated diagram of this handshake.
        </p>
      </div>
    </details>
  );
}
