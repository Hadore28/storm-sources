import { describe, expect, test } from "bun:test";
import { defineExtension, defineSource, SourceError, type MangaSource } from "@storm-sources/sdk";
import { SourceHost } from "../src/host";

function fake(overrides: Partial<MangaSource> = {}) {
  let calls = 0;
  const source = defineSource({
    id: "fake-en",
    name: "Fake",
    lang: "en",
    baseUrl: "https://example.com",
    listings: [{ id: "latest", label: "Latest" }],
    filters: [],
    async list() {
      calls++;
      await Bun.sleep(20);
      return { items: [{ id: "a", title: "  Alpha  ", cover: "https://example.com/a.jpg" }, { id: "a", title: "Dupe" }], hasNext: true };
    },
    async manga(_ctx, id) {
      return { id, title: "Alpha", altTitles: ["Alpha", "Alfa"], authors: [], artists: [], genres: [{ name: "Action", key: "action" }] };
    },
    async chapters() {
      return [
        { id: "c1", number: 1, lang: "en" },
        { id: "c3", number: 3, lang: "en", date: "not a date" },
        { id: "c2", number: 2, lang: "en" },
      ];
    },
    async pages() {
      return [];
    },
    ...overrides,
  });
  const ext = defineExtension({ pkg: "test.fake", name: "Fake", version: "1.0.0", app: "mangasto", sources: [source] });
  return { ext, calls: () => calls };
}

describe("SourceHost", () => {
  test("identical calls at the same moment share one request, then come from cache", async () => {
    const { ext, calls } = fake();
    const host = new SourceHost();
    host.register(ext);
    const [a, b] = await Promise.all([host.list("fake-en", "latest"), host.list("fake-en", "latest")]);
    expect(a).toEqual(b);
    await host.list("fake-en", "latest");
    expect(calls()).toBe(1);
  });

  test("answers are tidied: trimmed, de-duplicated, sorted newest first", async () => {
    const { ext } = fake();
    const host = new SourceHost();
    host.register(ext);
    const list = await host.list("fake-en", "latest");
    expect(list.items).toEqual([{ id: "a", title: "Alpha", cover: "https://example.com/a.jpg" } as never]);
    const m = await host.manga("fake-en", "a");
    expect(m.altTitles).toEqual(["Alfa"]);
    const chapters = await host.chapters("fake-en", "a");
    expect(chapters.map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
    expect(chapters[0].date).toBeUndefined();
  });

  test("a chapter without pages is reported as a changed site", async () => {
    const { ext } = fake();
    const host = new SourceHost();
    host.register(ext);
    await expect(host.pages("fake-en", "a", "c1")).rejects.toMatchObject({ kind: "changed" });
  });

  test("plain exceptions from an extension become 'changed', SourceErrors keep their kind", async () => {
    const host = new SourceHost();
    host.register(fake({ async manga() { throw new TypeError("cannot read x of undefined"); } }).ext);
    await expect(host.manga("fake-en", "a")).rejects.toMatchObject({ kind: "changed" });
    const other = new SourceHost();
    other.register(fake({ async manga() { throw new SourceError("blocked", "nope"); } }).ext);
    await expect(other.manga("fake-en", "a")).rejects.toMatchObject({ kind: "blocked" });
  });

  test("unknown sources and listings are not found; missing search is unsupported", async () => {
    const host = new SourceHost();
    host.register(fake().ext);
    await expect(host.list("nope", "latest")).rejects.toMatchObject({ kind: "not-found" });
    await expect(host.list("fake-en", "popular")).rejects.toMatchObject({ kind: "not-found" });
    await expect(host.search("fake-en", "x")).rejects.toMatchObject({ kind: "unsupported" });
  });

  test("a source id can't be claimed by two packages", () => {
    const host = new SourceHost();
    host.register(fake().ext);
    const thief = { ...fake().ext, pkg: "test.other" };
    expect(() => host.register(thief)).toThrow(/already belongs/);
  });
});
