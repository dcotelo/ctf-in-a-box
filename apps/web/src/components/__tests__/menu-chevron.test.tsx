// Issue #411. The profile trigger in auth-nav.tsx carried the full menu-button
// ARIA (aria-haspopup="menu", aria-expanded) and drew nothing, so it announced
// itself to a screen reader and looked like a plain label to everyone else.
// The organizer running the live event could not find /admin, which the menu is
// the only header route to.
//
// What matters is therefore what a person can see WITHOUT interacting, and a
// closed-by-default static render is exactly that view — the same constraint
// nav-dropdown.test.tsx works under (no @testing-library/react, no jsdom).
//
// auth-nav itself is not rendered here: it reads the session through
// authClient and useRouter, and mocking a signed-in session to assert one
// child would test the mock more than the component. The two halves that CAN
// be proven are proven — the mark renders both states correctly, and the
// dropdown that already had it still does after the extraction — and the
// third, that auth-nav renders it, is a one-line JSX reference in the same
// trigger element as the ARIA it belongs to.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MenuChevron from "@/components/menu-chevron";
import NavDropdown from "@/components/nav-dropdown";

describe("MenuChevron", () => {
  it("is decorative to assistive tech, which already hears aria-haspopup", () => {
    expect(renderToStaticMarkup(<MenuChevron open={false} />)).toContain('aria-hidden="true"');
  });

  it("points down when closed and flips when open, so the mark carries the state", () => {
    const closed = renderToStaticMarkup(<MenuChevron open={false} />);
    const opened = renderToStaticMarkup(<MenuChevron open />);
    expect(closed).not.toContain("rotate-180");
    expect(opened).toContain("rotate-180");
  });
});

describe("NavDropdown after the extraction", () => {
  // The regression this guards: the chevron moved out of nav-dropdown.tsx into
  // a shared component, and a closed Challenges trigger must still draw one.
  it("still marks its closed trigger as a menu, visibly", () => {
    const html = renderToStaticMarkup(
      <NavDropdown
        label="Challenges"
        items={[{ href: "/challenges", label: "Secure Development" }]}
        isActive={() => false}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-testid="menu-chevron"');
  });
});
