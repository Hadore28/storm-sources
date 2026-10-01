import {
  SDK_VERSION,
  SourceError,
  isSourceError,
  type Cache,
  type Chapter,
  type Context,
  type ErrorKind,
  type Extension,
  type FilterDef,
  type FilterValues,
  type MangaDetails,
  type MangaSource,
  type MangaSummary,
  type PageRef,
  type Paged,
  type SettingValues,
} from "@storm-sources/sdk";
import { MemoryCache, scoped } from "./cache";
import { parseHtml } from "./html";
import { createHttp, type FetchLike } from "./http";
import { RateLimiter } from "./rate-limit";
import { checkChapters, checkDetails, checkFilters, checkPaged, checkPages } from "./validate";

export const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type Operation = "filters" | "list" | "search" | "manga" | "chapters" | "pages";

export interface CallEvent {
  sourceId: string;
  op: Operation;
  ms: number;
  cached: boolean;
  ok: boolean;
  error?: { kind: ErrorKind; message: string };
}

export interface HostOptions {
  cache?: Cache;
  fetch?: FetchLike;
  /** admin settings for a source, merged over its defaults */
  settings?: (sourceId: string) => SettingValues | undefined;
  /** an outbound proxy for a source, e.g. "http://user:pass@host:port" */
  proxy?: (sourceId: string) => string | undefined;
  onCall?: (event: CallEvent) => void;
  log?: (sourceId: string, message: string, data?: unknown) => void;
  /** how long each kind of answer is kept, in ms */
  ttl?: Partial<Record<Operation, number>>;
}

const TTL: Record<Operation, number> = {
  filters: 24 * 3_600_000,
  list: 10 * 60_000,
  search: 10 * 60_000,
  manga: 60 * 60_000,
  chapters: 10 * 60_000,
  pages: 6 * 3_600_000,
};

export interface SourceInfo {
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
  icon?: string;
  rating?: MangaSource["rating"];
  pkg: string;
  extension: string;
  version: string;
  listings: MangaSource["listings"];
  search: boolean;
  searchFilters: boolean;
  /** series open on the source's own site */
  readOn: "storm" | "site";
  settings: NonNullable<MangaSource["settings"]>;
  images: { proxy: boolean; noReferrer: boolean; headers: Record<string, string> };
}

interface Entry {
  ext: Extension;
  source: MangaSource;
  limiter?: RateLimiter;
}

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

// Stable key for a filter set, whatever order its keys came in.
const filterKey = (f: FilterValues) => JSON.stringify(Object.keys(f).sort().map((k) => [k, f[k]]));

export class SourceHost {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown>>();
  readonly cache: Cache;
  private fetch: FetchLike;

  constructor(private opts: HostOptions = {}) {
    this.cache = opts.cache ?? new MemoryCache();
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  /** Adds an extension's sources, replacing an older version of the same package. */
  register(ext: Extension) {
    if (ext?.sdk !== SDK_VERSION) throw new Error(`${ext?.pkg ?? "extension"} targets sdk ${ext?.sdk}, host runs ${SDK_VERSION}`);
    if (!Array.isArray(ext.sources) || ext.sources.length === 0) throw new Error(`${ext.pkg} has no sources`);
    for (const s of ext.sources) {
      if (!ID.test(s.id)) throw new Error(`${ext.pkg}: bad source id "${s.id}"`);
      const owner = this.entries.get(s.id);
      if (owner && owner.ext.pkg !== ext.pkg) throw new Error(`${ext.pkg}: source id "${s.id}" already belongs to ${owner.ext.pkg}`);
    }
    this.unregister(ext.pkg);
    for (const source of ext.sources) {
      const limiter = source.rateLimit ? new RateLimiter(source.rateLimit.requests, source.rateLimit.perMs) : undefined;
      this.entries.set(source.id, { ext, source, limiter });
    }
  }

  unregister(pkg: string) {
    for (const [id, e] of this.entries) if (e.ext.pkg === pkg) this.entries.delete(id);
  }

  sources(): SourceInfo[] {
    return [...this.entries.values()].map(({ ext, source: s }) => ({
      id: s.id,
      name: s.name,
      lang: s.lang,
      baseUrl: s.baseUrl,
      icon: s.icon,
      rating: s.rating,
      pkg: ext.pkg,
      extension: ext.name,
      version: ext.version,
      listings: s.listings,
      search: typeof s.search === "function",
      readOn: s.readOn === "site" ? "site" : "storm",
      searchFilters: !!s.searchFilters,
      settings: s.settings ?? [],
      images: { proxy: !!s.images?.proxy, noReferrer: !!s.images?.noReferrer, headers: s.images?.headers ?? {} },
    }));
  }

  has(id: string) {
    return this.entries.has(id);
  }

  private entry(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new SourceError("not-found", `No source "${id}"`);
    return e;
  }

  context(id: string): Context {
    const { source, limiter } = this.entry(id);
    const defaults = Object.fromEntries((source.settings ?? []).map((s) => [s.id, s.default]));
    const settings = { ...defaults, ...this.opts.settings?.(id) };
    const cache = scoped(this.cache, `src:${id}:`);
    return {
      http: createHttp({
        sourceId: id,
        headers: { "User-Agent": DEFAULT_USER_AGENT, "Accept-Language": `${source.lang},en;q=0.8`, ...source.headers },
        limiter,
        cache,
        fetch: this.fetch,
        proxy: this.opts.proxy?.(id),
      }),
      html: parseHtml,
      cache,
      settings,
      log: (message, data) => this.opts.log?.(id, message, data),
    };
  }

  // Identical calls made at the same moment share one trip to the site.
  private run<T>(id: string, op: Operation, key: string, work: (s: MangaSource, ctx: Context) => Promise<T>): Promise<T> {
    const cacheKey = `res:${id}:${op}:${key}`;
    const pending = this.inflight.get(cacheKey);
    if (pending) return pending as Promise<T>;
    const p = this.runOnce(id, op, cacheKey, work).finally(() => this.inflight.delete(cacheKey));
    this.inflight.set(cacheKey, p);
    return p;
  }

  private async runOnce<T>(id: string, op: Operation, cacheKey: string, work: (s: MangaSource, ctx: Context) => Promise<T>): Promise<T> {
    const { source } = this.entry(id);
    const started = performance.now();
    const hit = await this.cache.get<T>(cacheKey);
    if (hit !== undefined) {
      this.opts.onCall?.({ sourceId: id, op, ms: performance.now() - started, cached: true, ok: true });
      return hit;
    }
    try {
      const value = await work(source, this.context(id));
      await this.cache.set(cacheKey, value, source.cache?.[op] ?? this.opts.ttl?.[op] ?? TTL[op]);
      this.opts.onCall?.({ sourceId: id, op, ms: performance.now() - started, cached: false, ok: true });
      return value;
    } catch (e) {
      // Anything that isn't a SourceError is a bug or a layout change in the extension.
      const err = isSourceError(e) ? e : new SourceError("changed", e instanceof Error ? e.message : String(e));
      this.opts.onCall?.({ sourceId: id, op, ms: performance.now() - started, cached: false, ok: false, error: { kind: err.kind, message: err.message } });
      throw err;
    }
  }

  filters(id: string): Promise<FilterDef[]> {
    return this.run(id, "filters", "", async (s, ctx) => checkFilters(typeof s.filters === "function" ? await s.filters(ctx) : s.filters, `${id} filters`));
  }

  list(id: string, listing: string, page = 1, filters: FilterValues = {}): Promise<Paged<MangaSummary>> {
    return this.run(id, "list", `${listing}:${page}:${filterKey(filters)}`, async (s, ctx) => {
      if (!s.listings.some((l) => l.id === listing)) throw new SourceError("not-found", `${id} has no "${listing}" list`);
      return checkPaged(await s.list(ctx, { listing, page, filters }), `${id} ${listing}`);
    });
  }

  search(id: string, query: string, page = 1, filters: FilterValues = {}): Promise<Paged<MangaSummary>> {
    return this.run(id, "search", `${query.trim().toLowerCase()}:${page}:${filterKey(filters)}`, async (s, ctx) => {
      if (!s.search) throw new SourceError("unsupported", `${id} has no search`);
      return checkPaged(await s.search(ctx, { query: query.trim(), page, filters }), `${id} search`);
    });
  }

  private readable(s: MangaSource) {
    if (s.readOn === "site") throw new SourceError("unsupported", `${s.name} is read on its own site`);
  }

  manga(id: string, mangaId: string): Promise<MangaDetails> {
    return this.run(id, "manga", mangaId, async (s, ctx) => {
      this.readable(s);
      return checkDetails(await s.manga(ctx, mangaId), `${id} manga ${mangaId}`);
    });
  }

  chapters(id: string, mangaId: string): Promise<Chapter[]> {
    return this.run(id, "chapters", mangaId, async (s, ctx) => {
      this.readable(s);
      return checkChapters(await s.chapters(ctx, mangaId), `${id} chapters of ${mangaId}`);
    });
  }

  pages(id: string, mangaId: string, chapterId: string): Promise<PageRef[]> {
    return this.run(id, "pages", `${mangaId}:${chapterId}`, async (s, ctx) => {
      this.readable(s);
      return checkPages(await s.pages(ctx, mangaId, chapterId), `${id} pages of ${chapterId}`);
    });
  }

  /** Drops cached answers for one source, e.g. after an admin changes its settings. */
  async forget(id: string) {
    if (this.cache instanceof MemoryCache) {
      this.cache.clear(`res:${id}:`);
      this.cache.clear(`src:${id}:`);
    }
  }
}
