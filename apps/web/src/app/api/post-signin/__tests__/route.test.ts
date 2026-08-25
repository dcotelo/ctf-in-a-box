// Route-level wiring for the first-login team steering (issue #217): session
// and stores mocked, asserting where the 302 actually points. The branch
// matrix itself is pinned in lib/__tests__/post-signin.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, hasTeam, isAdminLogin } = vi.hoisted(() => ({
  getSession: vi.fn(),
  hasTeam: vi.fn(),
  isAdminLogin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/team-store", () => ({ hasTeam }));
vi.mock("@/lib/admin-auth", () => ({ isAdminLogin }));

import { GET } from "@/app/api/post-signin/route";

const req = (next?: string) =>
  new Request(`http://box.test/api/post-signin${next ? `?next=${encodeURIComponent(next)}` : ""}`);

const location = (res: Response) => {
  const url = res.headers.get("location");
  expect(res.status).toBe(302);
  expect(url).toBeTruthy();
  return new URL(url as string);
};

beforeEach(() => {
  getSession.mockReset();
  hasTeam.mockReset();
  isAdminLogin.mockReset();
  getSession.mockResolvedValue({ user: { login: "alice" } });
  isAdminLogin.mockResolvedValue(false);
  hasTeam.mockResolvedValue(true);
});

describe("GET /api/post-signin", () => {
  it("sends a teamless contestant to the team card, keeping the fragment", async () => {
    hasTeam.mockResolvedValue(false);
    const url = location(await GET(req("/quiz")));
    expect(url.pathname).toBe("/profile");
    expect(url.hash).toBe("#team");
  });

  it("sends a teamed contestant to their original destination", async () => {
    const url = location(await GET(req("/quiz")));
    expect(url.pathname).toBe("/quiz");
  });

  it("lets a teamless admin through — checking content is not playing", async () => {
    hasTeam.mockResolvedValue(false);
    isAdminLogin.mockResolvedValue(true);
    const url = location(await GET(req("/admin")));
    expect(url.pathname).toBe("/admin");
  });

  it("passes a /join invite through for a teamless contestant", async () => {
    hasTeam.mockResolvedValue(false);
    const url = location(await GET(req("/join/ab12cd")));
    expect(url.pathname).toBe("/join/ab12cd");
  });

  it("refuses an absolute next — the parameter rides an OAuth round-trip", async () => {
    const url = location(await GET(req("https://evil.example/")));
    expect(url.origin).toBe("http://box.test");
    expect(url.pathname).toBe("/profile");
  });

  it("refuses URL-parser whitespace that would re-collapse into another origin", async () => {
    // /%09/evil.example decodes to "/\t/evil.example"; the URL parser strips
    // the tab, leaving protocol-relative //evil.example.
    const url = location(await GET(req("/\t/evil.example")));
    expect(url.origin).toBe("http://box.test");
    expect(url.pathname).toBe("/profile");
  });

  it("lands home when there is no session", async () => {
    getSession.mockResolvedValue(null);
    const url = location(await GET(req("/quiz")));
    expect(url.pathname).toBe("/");
    expect(hasTeam).not.toHaveBeenCalled();
  });

  it("defaults to /profile with no next at all", async () => {
    const url = location(await GET(req()));
    expect(url.pathname).toBe("/profile");
  });
});
