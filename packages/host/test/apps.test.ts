import { describe, expect, test } from "bun:test";
import { defineAnimeSource, defineBookSource, defineExtension, defineFilmSource, defineNovelSource, type Extension } from "@storm-sources/sdk";
import { SourceHost } from "../src/host";

const base = { lang: "ar", baseUrl: "https://example.com", listings: [{ id: "latest", label: "Latest" }], filters: [] };

const anime = defineAnimeSource({
  ...base,
  id: "anime-x",
  name: "Anime",
  async list() {
    return { items: [{ id: "a", title: "Alpha", type: "tv", year: 1500 as number }], hasNext: false };
  },
  async details(_ctx, id) {
    return { id, title: "Alpha", altTitles: [], genres: [{ name: "أكشن", key: "action" }], studios: ["  Bones "], duration: 9999 };
  },
  async episodes() {
    return [
      { id: "e3", number: 3 },
      { id: "e1", number: 1 },
      { id: "e1", number: 1 },
      { id: "e2", number: 2, date: "bad" },
    ];
  },
  async servers() {
    return [
      { name: "ok", url: "https://ok.ru/videoembed/1", kind: "embed" },
      { name: "dupe", url: "https://ok.ru/videoembed/1", kind: "embed" },
      { name: "bad", url: "javascript:alert(1)", kind: "embed" },
      { name: "", url: "https://cdn.example.com/v.m3u8", kind: "hls", audio: "dub" },
    ];
  },
});

const film = defineFilmSource({
  ...base,
  id: "film-x",
  name: "Film",
  async list() {
    return { items: [{ id: "m", title: "Movie", kind: "movie", score: 11 }], hasNext: false };
  },
  async details(_ctx, id) {
    return { id, title: "Show", kind: "series", altTitles: [], genres: [], cast: [], directors: [], countries: [], languages: [], seasons: [{ id: "s1", number: 1 }, { id: "s1" }] };
  },
  async episodes(_ctx, _id, season) {
    return season === "s1" ? [{ id: "x1", number: 1 }] : [];
  },
  async servers(_ctx, _id, episode) {
    return episode ? [{ name: "a", url: "https://a.example/e/1", kind: "embed" }] : [{ name: "dl", url: "https://a.example/d/1", kind: "embed", download: true }];
  },
});

const novel = defineNovelSource({
  ...base,
  id: "novel-x",
  name: "Novel",
  async list() {
    return { items: [], hasNext: false };
  },
  async details(_ctx, id) {
    return { id, title: "Novel", altTitles: [], authors: [], translators: ["T"], genres: [] };
  },
  async chapters() {
    return [{ id: "1", number: 1, lang: "ar" }, { id: "2", number: 2, lang: "ar" }];
  },
  async content(_ctx, _n, chapter) {
    return chapter === "1"
      ? { title: " One ", blocks: [{ type: "p", text: "  hello   world " }, { type: "p", text: "" }, { type: "image", src: "data:x" }] }
      : { blocks: [{ type: "break" }] };
  },
});

const book = defineBookSource({
  ...base,
  id: "book-x",
  name: "Book",
  async list() {
    return { items: [{ id: "b", title: "Book", authors: [" A ", "A"] }], hasNext: false };
  },
  async details(_ctx, id) {
    return { id, title: "Book", authors: [], altTitles: [], genres: [], files: [{ format: "pdf", url: "https://x.example/b.pdf" }, { format: "pdf", url: "nope" }], readable: true };
  },
  async sections() {
    return [{ id: "b/2", number: 2, lang: "ar" }, { id: "b/1", number: 1, lang: "ar" }];
  },
});

const ext = (app: Extension["app"], sources: unknown[], sdk = 2) => ({ pkg: `test.${app}`, name: app, version: "1.0.0", sdk, app, sources }) as Extension;

describe("sources for every app", () => {
  const host = new SourceHost();
  host.register(defineExtension({ pkg: "test.anime", name: "A", version: "1.0.0", app: "anisto", sources: [anime] }));
  host.register(defineExtension({ pkg: "test.film", name: "F", version: "1.0.0", app: "movisto", sources: [film] }));
  host.register(defineExtension({ pkg: "test.novel", name: "N", version: "1.0.0", app: "novelsto", sources: [novel] }));
  host.register(defineExtension({ pkg: "test.book", name: "B", version: "1.0.0", app: "booksto", sources: [book] }));

  test("each source knows its app", () => {
    expect(host.sources("anisto").map((s) => s.id)).toEqual(["anime-x"]);
    expect(host.appOf("book-x")).toBe("booksto");
    expect(host.sources()).toHaveLength(4);
  });

  test("list items are checked with their app's rules", async () => {
    const a = await host.list<{ year?: number; type?: string }>("anime-x", "latest");
    expect(a.items[0]).toMatchObject({ id: "a", type: "tv" });
    expect(a.items[0].year).toBeUndefined();
    const f = await host.list<{ score?: number }>("film-x", "latest");
    expect(f.items[0].score).toBeUndefined();
    const b = await host.list<{ authors: string[] }>("book-x", "latest");
    expect(b.items[0].authors).toEqual(["A"]);
  });

  test("anime: details tidied, episodes in order without repeats, unusable servers dropped", async () => {
    const d = await host.details<{ studios: string[]; duration?: number }>("anime-x", "a");
    expect(d.studios).toEqual(["Bones"]);
    expect(d.duration).toBeUndefined();
    const eps = await host.episodes("anime-x", "a");
    expect(eps.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(eps[1].date).toBeUndefined();
    const servers = await host.servers("anime-x", "a", "e1");
    expect(servers.map((s) => s.url)).toEqual(["https://ok.ru/videoembed/1", "https://cdn.example.com/v.m3u8"]);
    expect(servers[1]).toMatchObject({ name: "cdn.example.com", kind: "hls", audio: "dub" });
    await expect(host.servers("anime-x", "a")).rejects.toMatchObject({ kind: "not-found" });
  });

  test("films: seasons once each, episodes by season, a list of only downloads is not playable", async () => {
    const d = await host.details<{ seasons: { id: string }[] }>("film-x", "show");
    expect(d.seasons).toHaveLength(1);
    expect(await host.episodes("film-x", "show", "s1")).toHaveLength(1);
    await expect(host.episodes("film-x", "show")).rejects.toMatchObject({ kind: "not-found" });
    expect(await host.servers("film-x", "show", "x1")).toHaveLength(1);
    await expect(host.servers("film-x", "show")).rejects.toMatchObject({ kind: "changed" });
  });

  test("novels: text is cleaned, and a chapter without words is an error", async () => {
    const text = await host.content("novel-x", "n", "1");
    expect(text).toEqual({ title: "One", blocks: [{ type: "p", text: "hello world" }] });
    await expect(host.content("novel-x", "n", "2")).rejects.toMatchObject({ kind: "changed" });
  });

  test("books: bad files dropped, sections kept in the book's order, no text without content()", async () => {
    const d = await host.details<{ files: unknown[] }>("book-x", "b");
    expect(d.files).toHaveLength(1);
    expect((await host.chapters("book-x", "b")).map((s) => s.id)).toEqual(["b/2", "b/1"]);
    await expect(host.content("book-x", "b", "b/1")).rejects.toMatchObject({ kind: "unsupported" });
  });

  test("operations from another app are refused", async () => {
    await expect(host.pages("anime-x", "a", "e1")).rejects.toMatchObject({ kind: "unsupported" });
    await expect(host.episodes("novel-x", "n")).rejects.toMatchObject({ kind: "unsupported" });
    await expect(host.content("film-x", "m", "1")).rejects.toMatchObject({ kind: "unsupported" });
  });
});

describe("registering", () => {
  test("sdk 1 extensions can only be manga", () => {
    expect(() => new SourceHost().register(ext("anisto", [anime], 1))).toThrow(/manga/);
  });

  test("unknown apps and sdk versions are refused", () => {
    expect(() => new SourceHost().register(ext("tvsto" as Extension["app"], [anime]))).toThrow(/app/);
    expect(() => new SourceHost().register(ext("anisto", [anime], 3))).toThrow(/sdk 3/);
  });

  test("a source missing what its app needs is refused", () => {
    const broken = { ...anime, id: "broken-x", servers: undefined };
    expect(() => new SourceHost().register(ext("anisto", [broken]))).toThrow(/missing servers/);
  });
});
