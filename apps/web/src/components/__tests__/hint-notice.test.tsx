// The hint banner's copy depends on two pieces of state it used to ignore
// (issue #200, 3.1/3.5): whether the visitor is already signed in ("Sign in
// with GitHub to reveal them" told signed-in visitors to sign in), and
// whether ANY challenge actually carries a hint ("Challenges marked 💡"
// promised marks that a board with no hint content never renders).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HintNotice from "@/components/hint-notice";

describe("HintNotice", () => {
  it("tells a signed-out visitor to sign in, and drops the clause once they have", () => {
    const signedOut = renderToStaticMarkup(<HintNotice active cost={10} signedIn={false} anyMarked />);
    expect(signedOut).toContain("Sign in with GitHub to reveal them.");

    const signedIn = renderToStaticMarkup(<HintNotice active cost={10} signedIn anyMarked />);
    expect(signedIn).not.toContain("Sign in with GitHub");
    // The rest of the how-it-works copy survives the dropped clause.
    expect(signedIn).toContain("offer a paid hint");
  });

  it("does not promise 💡 marks when no challenge carries a hint", () => {
    const html = renderToStaticMarkup(<HintNotice active cost={10} signedIn anyMarked={false} />);
    expect(html).not.toContain("Challenges marked");
    expect(html).toContain("no challenge is offering one yet");
    // The price still shows — it's the part an organizer configured.
    expect(html).toContain("10");
  });

  it("keeps the pre-event countdown variant untouched", () => {
    const html = renderToStaticMarkup(<HintNotice active={false} cost={10} />);
    expect(html).toContain("Hints unlock at kickoff");
  });
});
