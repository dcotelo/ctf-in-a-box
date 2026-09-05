// The list-plus-editor state the quiz, classic and ai admin panels share.
// This repo's tests run `renderToStaticMarkup` in vitest's node environment:
// hooks render once and effects never run, so the async flows are proven
// through the two exported transport functions the hook is built on
// (`loadResource`, `postRow`, against a stubbed `fetch`) and the initial
// state through a probe component that renders what the hook hands back.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { describeAdminError } from "@/components/admin/fetch";
import type { RowAccessors } from "@/components/admin/ordered-rows";
import { loadResource, postRow, useAdminResource } from "@/components/admin/use-admin-resource";

type Item = { id: string; title: string; order: number };
type Row = { item: Item; secret: string };
type Editor = { id: string; title: string };
type Payload = { id: string; title: string; order: number };

const rows: RowAccessors<Row> = {
  id: (r) => r.item.id,
  order: (r) => r.item.order,
  withOrder: (r, order) => ({ ...r, item: { ...r.item, order } }),
};

const describeError = (status: number, message?: string) => describeAdminError(status, message, "fallback");

const config = {
  endpoint: "/api/admin/thing",
  describeError,
  rows,
  parseList: (data: Record<string, unknown>) => ({
    rows: Array.isArray(data.things) ? (data.things as Row[]) : [],
    categories: Array.isArray(data.categories) ? (data.categories as string[]) : [],
  }),
  loadErrorMessage: "Couldn't load things — check your connection and try again.",
  parseUpsert: (data: Record<string, unknown>, payload: Payload): Row | null =>
    data.item ? { item: data.item as Item, secret: (data.secret as string | undefined) ?? payload.title } : null,
  toPayload: (e: Editor): Payload => ({ id: e.id, title: e.title, order: 1 }),
  initialRows: [] as Row[],
  initialCategories: [] as string[],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadResource", () => {
  it("GETs the endpoint and returns the rows sorted by order with the categories", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        things: [
          { item: { id: "b", title: "B", order: 2 }, secret: "sb" },
          { item: { id: "a", title: "A", order: 1 }, secret: "sa" },
        ],
        categories: ["Web"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadResource(config);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/thing");
    expect(result.ok && result.rows.map((r) => r.item.id)).toEqual(["a", "b"]);
    expect(result.ok && result.categories).toEqual(["Web"]);
  });

  it("describes a non-2xx reply through the module's mapper", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, { error: "redis down" })));
    await expect(loadResource(config)).resolves.toEqual({ ok: false, message: "Store unavailable — redis down" });
  });

  it("returns the module's load sentence for a network failure, never throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(loadResource(config)).resolves.toEqual({ ok: false, message: config.loadErrorMessage });
  });
});

describe("postRow", () => {
  it("POSTs the payload and returns the STORED row the route echoes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { item: { id: "a", title: "A (trimmed)", order: 1 }, secret: "stored" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await postRow(config, { id: "a", title: "A ", order: 1 });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ id: "a", title: "A ", order: 1 }) });
    expect(result).toEqual({ ok: true, row: { item: { id: "a", title: "A (trimmed)", order: 1 }, secret: "stored" } });
  });

  it("treats a 2xx body without the record as a failure described with that status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { error: "odd" })));
    await expect(postRow(config, { id: "a", title: "A", order: 1 })).resolves.toEqual({ ok: false, message: "odd" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));
    await expect(postRow(config, { id: "a", title: "A", order: 1 })).resolves.toEqual({ ok: false, message: "fallback" });
  });

  it("surfaces a 400 as the store's own message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "title required" })));
    await expect(postRow(config, { id: "a", title: "", order: 1 })).resolves.toEqual({ ok: false, message: "title required" });
  });
});

describe("useAdminResource — initial state", () => {
  function Probe({ seed, seedCategories }: { seed: Row[]; seedCategories: string[] }) {
    const r = useAdminResource<Row, Item, Editor, Payload>({ ...config, initialRows: seed, initialCategories: seedCategories });
    return (
      <p>
        rows={r.rows.map((x) => x.item.id).join(",")} categories={r.categories.join(",")} next={r.nextOrder} loaded={String(r.loaded)}{" "}
        editing={String(r.editing)} deleting={String(r.deleteTarget)} error={String(r.listError)}
      </p>
    );
  }

  it("seeds the rows sorted, the categories, and the next position; nothing open, nothing loaded yet", () => {
    const html = renderToStaticMarkup(
      <Probe
        seed={[
          { item: { id: "b", title: "B", order: 5 }, secret: "" },
          { item: { id: "a", title: "A", order: 1 }, secret: "" },
        ]}
        seedCategories={["Web"]}
      />,
    );
    expect(html).toContain("rows=a,b");
    expect(html).toContain("categories=Web");
    expect(html).toContain("next=6");
    expect(html).toContain("loaded=false");
    expect(html).toContain("editing=null");
    expect(html).toContain("deleting=null");
    expect(html).toContain("error=null");
  });

  it("starts an empty seed at position 1", () => {
    expect(renderToStaticMarkup(<Probe seed={[]} seedCategories={[]} />)).toContain("next=1");
  });
});
