// Contract tests every source runs. By default they replay recorded answers, so
// they are fast and stable in CI; STORM_LIVE=1 runs them against the real site
// (the daily health check), and STORM_RECORD=1 saves fresh recordings.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnimeDetails, BookDetails, Extension, FilmDetails, Genre, NovelDetails } from "@storm-sources/sdk";
import { SourceHost } from "./host";
import type { FetchLike } from "./http";
import { fetchVia } from "./resolve";

const LIVE = process.env.STORM_LIVE === "1";
const RECORD = process.env.STORM_RECORD === "1";
const TIMEOUT = 150_000;

interface Recording {
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

// Sites embed their own sign-in client ids; recordings never keep anything key-shaped.
const redact = (body: string) => body.replace(/\b\d+-[a-z0-9]{32}\.apps\.googleusercontent\.com\b/g, "redacted.apps.googleusercontent.com");

function recorder(dir: string): FetchLike {
  const keyOf = (method: string, url: string, body?: unknown) =>
    createHash("sha1").update(`${method} ${url} ${typeof body === "string" ? body : ""}`).digest("hex").slice(0, 16);
  return async (url, init) => {
    const method = init.method ?? "GET";
    const file = join(dir, `${keyOf(method, url, init.body)}.json`);
    if (!LIVE) {
      if (!existsSync(file)) throw new Error(`No recording for ${method} ${url}. Run with STORM_LIVE=1 STORM_RECORD=1 to record.`);
      const r = JSON.parse(readFileSync(file, "utf8")) as Recording;
      return new Response(r.body, { status: r.status, headers: r.headers });
    }
    const { proxy: _proxy, resolve, ...rest } = init;
    const res = resolve ? await fetchVia(resolve, url, rest) : await fetch(url, rest);
    const body = await res.text();
    if (RECORD) {
      mkdirSync(dir, { recursive: true });
      const keep = ["content-type", "retry-after", "server", "location"];
      const headers = Object.fromEntries([...res.headers].filter(([k]) => keep.includes(k)));
      writeFileSync(file, JSON.stringify({ method, url, status: res.status, headers, body: redact(body) } satisfies Recording));
    }
    return new Response(body, { status: res.status, headers: res.headers });
  };
}

export interface ContractPlan {
  source: string;
  /** a manga that should stay on the source for a long time (not needed for sources read on their own site) */
  manga?: string;
  /** an anime, film, series, novel or book that should stay on the source for a long time */
  item?: string;
  search?: { query: string; expect: string };
  /** minimum items on the first page of each listing */
  minItems?: number;
  /** minimum chapters, episodes or sections of the item */
  minChapters?: number;
  /** the site has no covers for its titles */
  noCover?: boolean;
  /** the site gives this item no genres */
  noGenres?: boolean;
}

/** Most genres should map onto storm's own list. */
function expectGenres(genres: Genre[], plan: ContractPlan) {
  if (plan.noGenres) return;
  expect(genres.length).toBeGreaterThan(0);
  expect(genres.filter((g) => g.key).length / genres.length).toBeGreaterThanOrEqual(0.5);
}

export function contractTests(ext: Extension, plans: ContractPlan[], fixtures: string) {
  const host = new SourceHost({ fetch: recorder(fixtures) });
  host.register(ext);

  for (const plan of plans) {
    const id = plan.source;
    const info = host.sources().find((s) => s.id === id);

    describe(id, () => {
      test("is registered", () => expect(info).toBeDefined());

      test(
        "filters load",
        async () => {
          const filters = await host.filters(id);
          expect(Array.isArray(filters)).toBe(true);
        },
        TIMEOUT,
      );

      for (const listing of info?.listings ?? []) {
        test(
          `lists ${listing.id}`,
          async () => {
            const page = await host.list<{ cover?: string; url?: string }>(id, listing.id, 1);
            expect(page.items.length).toBeGreaterThanOrEqual(plan.minItems ?? 10);
            const withCover = page.items.filter((m) => m.cover).length;
            if (!plan.noCover) expect(withCover / page.items.length).toBeGreaterThanOrEqual(0.8);
            // series read on the source's site need a link to open
            if (info?.readOn === "site") expect(page.items.every((m) => m.url)).toBe(true);
          },
          TIMEOUT,
        );
      }

      if (plan.search) {
        const { query, expect: title } = plan.search;
        test(
          `search finds ${title}`,
          async () => {
            const res = await host.search<{ title: string }>(id, query, 1);
            expect(res.items.some((m) => m.title.toLowerCase().includes(title.toLowerCase()))).toBe(true);
          },
          TIMEOUT,
        );
      }

      if (ext.app === "mangasto") mangaTests(ext, host, id, plan);
      else if (plan.item) {
        const item = plan.item;
        if (ext.app === "anisto") animeTests(host, id, item, plan);
        if (ext.app === "movisto") filmTests(host, id, item, plan);
        if (ext.app === "novelsto") novelTests(host, id, item, plan);
        if (ext.app === "booksto") bookTests(host, id, item, plan);
      }
    });
  }
}

function mangaTests(ext: Extension, host: SourceHost, id: string, plan: ContractPlan) {
  if (!plan.manga) return;
  const manga = plan.manga;

  test(
    "series details",
    async () => {
      const m = await host.manga(id, manga);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.cover).toBeDefined();
      expectGenres(m.genres, plan);
    },
    TIMEOUT,
  );

  test(
    "chapters and pages",
    async () => {
      const chapters = await host.chapters(id, manga);
      expect(chapters.length).toBeGreaterThanOrEqual(plan.minChapters ?? 1);
      expect(chapters.filter((c) => c.number !== undefined).length / chapters.length).toBeGreaterThanOrEqual(0.9);
      const readable = chapters.find((c) => !c.external);
      // a source whose chapters all open on its own site must link every one
      if (!readable) {
        expect(chapters.every((c) => c.url)).toBe(true);
        return;
      }
      const pages = await host.pages(id, manga, readable.id);
      expect(pages.length).toBeGreaterThan(0);

      if (LIVE) {
        const direct = new SourceHost();
        direct.register(ext);
        const res = await direct.image(id, pages[0].url);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type") ?? "").toStartWith("image/");
      }
    },
    TIMEOUT,
  );
}

function animeTests(host: SourceHost, id: string, item: string, plan: ContractPlan) {
  test(
    "anime details",
    async () => {
      const a = await host.details<AnimeDetails>(id, item);
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.cover).toBeDefined();
      expectGenres(a.genres, plan);
    },
    TIMEOUT,
  );

  test(
    "episodes and servers",
    async () => {
      const episodes = await host.episodes(id, item);
      expect(episodes.length).toBeGreaterThanOrEqual(plan.minChapters ?? 1);
      expect(episodes.filter((e) => e.number !== undefined).length / episodes.length).toBeGreaterThanOrEqual(0.9);
      const servers = await host.servers(id, item, episodes[0].id);
      expect(servers.filter((s) => !s.download).length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
}

function filmTests(host: SourceHost, id: string, item: string, plan: ContractPlan) {
  test(
    "details, episodes and servers",
    async () => {
      const f = await host.details<FilmDetails>(id, item);
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.cover).toBeDefined();
      expectGenres(f.genres, plan);
      if (f.kind === "series" || f.seasons.length) {
        expect(f.seasons.length).toBeGreaterThan(0);
        const episodes = await host.episodes(id, item, f.seasons[0].id);
        expect(episodes.length).toBeGreaterThanOrEqual(plan.minChapters ?? 1);
        const servers = await host.servers(id, item, episodes[0].id);
        expect(servers.filter((s) => !s.download).length).toBeGreaterThan(0);
      } else {
        const servers = await host.servers(id, item);
        expect(servers.filter((s) => !s.download).length).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );
}

function novelTests(host: SourceHost, id: string, item: string, plan: ContractPlan) {
  test(
    "novel details",
    async () => {
      const n = await host.details<NovelDetails>(id, item);
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.cover).toBeDefined();
      expectGenres(n.genres, plan);
    },
    TIMEOUT,
  );

  test(
    "chapters and text",
    async () => {
      const chapters = await host.chapters(id, item);
      expect(chapters.length).toBeGreaterThanOrEqual(plan.minChapters ?? 1);
      expect(chapters.filter((c) => c.number !== undefined).length / chapters.length).toBeGreaterThanOrEqual(0.9);
      // the first chapter is the one least likely to move
      const text = await host.content(id, item, chapters[chapters.length - 1].id);
      const length = text.blocks.reduce((n, b) => n + ("text" in b ? b.text.length : 0), 0);
      expect(length).toBeGreaterThan(300);
    },
    TIMEOUT,
  );
}

function bookTests(host: SourceHost, id: string, item: string, plan: ContractPlan) {
  test(
    "book details and reading",
    async () => {
      const b = await host.details<BookDetails>(id, item);
      expect(b.title.length).toBeGreaterThan(0);
      if (!plan.noCover) expect(b.cover).toBeDefined();
      expect(b.readable || b.files.length > 0).toBe(true);
      if (!b.readable) return;
      const sections = await host.chapters(id, item);
      expect(sections.length).toBeGreaterThanOrEqual(plan.minChapters ?? 1);
      const text = await host.content(id, item, sections[0].id);
      expect(text.blocks.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
}
