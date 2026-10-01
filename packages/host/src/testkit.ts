// Contract tests every source runs. By default they replay recorded answers, so
// they are fast and stable in CI; STORM_LIVE=1 runs them against the real site
// (the daily health check), and STORM_RECORD=1 saves fresh recordings.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Extension } from "@storm-sources/sdk";
import { SourceHost } from "./host";
import type { FetchLike } from "./http";
import { fetchVia } from "./resolve";

const LIVE = process.env.STORM_LIVE === "1";
const RECORD = process.env.STORM_RECORD === "1";
const TIMEOUT = 90_000;

interface Recording {
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

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
      const keep = ["content-type", "retry-after", "server"];
      const headers = Object.fromEntries([...res.headers].filter(([k]) => keep.includes(k)));
      writeFileSync(file, JSON.stringify({ method, url, status: res.status, headers, body } satisfies Recording));
    }
    return new Response(body, { status: res.status, headers: res.headers });
  };
}

export interface ContractPlan {
  source: string;
  /** a series that should stay on the source for a long time (not needed for sources read on their own site) */
  manga?: string;
  search?: { query: string; expect: string };
  /** minimum items on the first page of each listing */
  minItems?: number;
  minChapters?: number;
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
            const page = await host.list(id, listing.id, 1);
            expect(page.items.length).toBeGreaterThanOrEqual(plan.minItems ?? 10);
            const withCover = page.items.filter((m) => m.cover).length;
            expect(withCover / page.items.length).toBeGreaterThanOrEqual(0.8);
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
            const res = await host.search(id, query, 1);
            expect(res.items.some((m) => m.title.toLowerCase().includes(title.toLowerCase()))).toBe(true);
          },
          TIMEOUT,
        );
      }

      if (!plan.manga) return;
      const manga = plan.manga;

      test(
        "series details",
        async () => {
          const m = await host.manga(id, manga);
          expect(m.title.length).toBeGreaterThan(0);
          expect(m.cover).toBeDefined();
          expect(m.genres.length).toBeGreaterThan(0);
          // most genres should map onto storm's own list
          expect(m.genres.filter((g) => g.key).length / m.genres.length).toBeGreaterThanOrEqual(0.5);
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
    });
  }
}
