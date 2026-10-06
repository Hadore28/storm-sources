import {
  APPS,
  SUPPORTED_SDKS,
  SourceError,
  isSourceError,
  type AnySource,
  type AppKind,
  type Cache,
  type Chapter,
  type Context,
  type Episode,
  type ErrorKind,
  type Extension,
  type FilterDef,
  type FilterValues,
  type MangaDetails,
  type MangaSource,
  type Operation,
  type PageRef,
  type Paged,
  type SettingValues,
  type SourceByApp,
  type TextContent,
  type VideoServer,
} from "@storm-sources/sdk";
import { MemoryCache, scoped } from "./cache";
import { parseHtml } from "./html";
import { createHttp, type FetchLike } from "./http";
import { RateLimiter } from "./rate-limit";
import { fetchVia } from "./resolve";
import {
  checkAnime,
  checkBook,
  checkChapters,
  checkContent,
  checkDetails,
  checkEpisodes,
  checkFilm,
  checkFilters,
  checkNovel,
  checkPaged,
  checkPages,
  checkServers,
} from "./validate";

export const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type { Operation };

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
  details: 60 * 60_000,
  chapters: 10 * 60_000,
  episodes: 10 * 60_000,
  pages: 6 * 3_600_000,
  servers: 15 * 60_000,
  content: 6 * 3_600_000,
};

export interface SourceInfo {
  id: string;
  app: AppKind;
  name: string;
  lang: string;
  baseUrl: string;
  icon?: string;
  rating?: AnySource["rating"];
  pkg: string;
  extension: string;
  version: string;
  listings: AnySource["listings"];
  search: boolean;
  searchFilters: boolean;
  /** series open on the source's own site (manga only) */
  readOn: "storm" | "site";
  settings: NonNullable<AnySource["settings"]>;
  images: { proxy: boolean; noReferrer: boolean; headers: Record<string, string> };
}

type Entry = { [A in AppKind]: { app: A; ext: Extension; source: SourceByApp[A]; limiter?: RateLimiter } }[AppKind];

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

// What each kind of source must be able to do.
const REQUIRED: Record<AppKind, string[]> = {
  mangasto: ["list", "manga", "chapters", "pages"],
  anisto: ["list", "details", "episodes", "servers"],
  movisto: ["list", "details", "episodes", "servers"],
  novelsto: ["list", "details", "chapters", "content"],
  booksto: ["list", "details"],
};

// Stable key for a filter set, whatever order its keys came in.
const filterKey = (f: FilterValues) => JSON.stringify(Object.keys(f).sort().map((k) => [k, f[k]]));

export class SourceHost {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown>>();
  readonly cache: Cache;
  private fetch: FetchLike;

  constructor(private opts: HostOptions = {}) {
    this.cache = opts.cache ?? new MemoryCache();
    this.fetch = opts.fetch ?? ((url, { resolve, ...init }) => (resolve ? fetchVia(resolve, url, init) : fetch(url, init)));
  }

  /** Adds an extension's sources, replacing an older version of the same package. */
  register(ext: Extension) {
    const name = ext?.pkg ?? "extension";
    if (!(SUPPORTED_SDKS as readonly number[]).includes(ext?.sdk)) throw new Error(`${name} targets sdk ${ext?.sdk}, host runs ${SUPPORTED_SDKS.join(" and ")}`);
    if (!APPS.includes(ext.app)) throw new Error(`${name} is for an app this host doesn't know: ${ext.app}`);
    if (ext.sdk === 1 && ext.app !== "mangasto") throw new Error(`${name}: sdk 1 extensions can only be manga sources`);
    if (!Array.isArray(ext.sources) || ext.sources.length === 0) throw new Error(`${name} has no sources`);
    for (const s of ext.sources as AnySource[]) {
      if (!ID.test(s.id)) throw new Error(`${name}: bad source id "${s.id}"`);
      const missing = REQUIRED[ext.app].filter((m) => typeof (s as unknown as Record<string, unknown>)[m] !== "function");
      if (missing.length) throw new Error(`${name}: source ${s.id} is missing ${missing.join(", ")}`);
      const owner = this.entries.get(s.id);
      if (owner && owner.ext.pkg !== ext.pkg) throw new Error(`${name}: source id "${s.id}" already belongs to ${owner.ext.pkg}`);
    }
    this.unregister(ext.pkg);
    for (const source of ext.sources as AnySource[]) {
      const limiter = source.rateLimit ? new RateLimiter(source.rateLimit.requests, source.rateLimit.perMs) : undefined;
      this.entries.set(source.id, { app: ext.app, ext, source, limiter } as Entry);
    }
  }

  unregister(pkg: string) {
    for (const [id, e] of this.entries) if (e.ext.pkg === pkg) this.entries.delete(id);
  }

  /** Every source, or one app's. */
  sources(app?: AppKind): SourceInfo[] {
    return [...this.entries.values()]
      .filter((e) => !app || e.app === app)
      .map(({ app, ext, source: s }) => ({
        id: s.id,
        app,
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
        readOn: app === "mangasto" && (s as MangaSource).readOn === "site" ? "site" : "storm",
        searchFilters: !!s.searchFilters,
        settings: s.settings ?? [],
        images: { proxy: !!s.images?.proxy, noReferrer: !!s.images?.noReferrer, headers: s.images?.headers ?? {} },
      }));
  }

  has(id: string) {
    return this.entries.has(id);
  }

  appOf(id: string): AppKind | undefined {
    return this.entries.get(id)?.app;
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
  private run<T>(id: string, op: Operation, key: string, work: (e: Entry, ctx: Context) => Promise<T>): Promise<T> {
    const cacheKey = `res:${id}:${op}:${key}`;
    const pending = this.inflight.get(cacheKey);
    if (pending) return pending as Promise<T>;
    const p = this.runOnce(id, op, cacheKey, work).finally(() => this.inflight.delete(cacheKey));
    this.inflight.set(cacheKey, p);
    return p;
  }

  private async runOnce<T>(id: string, op: Operation, cacheKey: string, work: (e: Entry, ctx: Context) => Promise<T>): Promise<T> {
    const e = this.entry(id);
    const started = performance.now();
    const hit = await this.cache.get<T>(cacheKey);
    if (hit !== undefined) {
      this.opts.onCall?.({ sourceId: id, op, ms: performance.now() - started, cached: true, ok: true });
      return hit;
    }
    try {
      const value = await work(e, this.context(id));
      await this.cache.set(cacheKey, value, e.source.cache?.[op] ?? this.opts.ttl?.[op] ?? TTL[op]);
      this.opts.onCall?.({ sourceId: id, op, ms: performance.now() - started, cached: false, ok: true });
      return value;
    } catch (err) {
      // Anything that isn't a SourceError is a bug or a layout change in the extension.
      const se = isSourceError(err) ? err : new SourceError("changed", err instanceof Error ? err.message : String(err));
      this.opts.onCall?.({ sourceId: id, op, ms: performance.now() - started, cached: false, ok: false, error: { kind: se.kind, message: se.message } });
      throw se;
    }
  }

  filters(id: string): Promise<FilterDef[]> {
    return this.run(id, "filters", "", async ({ source: s }, ctx) => checkFilters(typeof s.filters === "function" ? await s.filters(ctx) : s.filters, `${id} filters`));
  }

  /** A page of any source's list; the items' shape depends on the source's app. */
  list<T = unknown>(id: string, listing: string, page = 1, filters: FilterValues = {}): Promise<Paged<T>> {
    return this.run(id, "list", `${listing}:${page}:${filterKey(filters)}`, async ({ app, source: s }, ctx) => {
      if (!s.listings.some((l) => l.id === listing)) throw new SourceError("not-found", `${id} has no "${listing}" list`);
      return checkPaged(app, (await s.list(ctx, { listing, page, filters })) as Paged<T>, `${id} ${listing}`);
    });
  }

  search<T = unknown>(id: string, query: string, page = 1, filters: FilterValues = {}): Promise<Paged<T>> {
    return this.run(id, "search", `${query.trim().toLowerCase()}:${page}:${filterKey(filters)}`, async ({ app, source: s }, ctx) => {
      if (!s.search) throw new SourceError("unsupported", `${id} has no search`);
      return checkPaged(app, (await s.search(ctx, { query: query.trim(), page, filters })) as Paged<T>, `${id} search`);
    });
  }

  private manga_(id: string): MangaSource {
    const e = this.entry(id);
    if (e.app !== "mangasto") throw new SourceError("unsupported", `${id} is not a manga source`);
    if (e.source.readOn === "site") throw new SourceError("unsupported", `${e.source.name} is read on its own site`);
    return e.source;
  }

  manga(id: string, mangaId: string): Promise<MangaDetails> {
    return this.run(id, "manga", mangaId, async (_e, ctx) => checkDetails(await this.manga_(id).manga(ctx, mangaId), `${id} manga ${mangaId}`));
  }

  pages(id: string, mangaId: string, chapterId: string): Promise<PageRef[]> {
    return this.run(id, "pages", `${mangaId}:${chapterId}`, async (_e, ctx) => checkPages(await this.manga_(id).pages(ctx, mangaId, chapterId), `${id} pages of ${chapterId}`));
  }

  /** A title's details, whatever the app: manga, anime, film, novel or book. */
  details<T = unknown>(id: string, itemId: string): Promise<T> {
    const e = this.entry(id);
    if (e.app === "mangasto") return this.manga(id, itemId) as Promise<T>;
    return this.run(id, "details", itemId, async (e, ctx) => {
      const where = `${id} details of ${itemId}`;
      switch (e.app) {
        case "anisto":
          return checkAnime(await e.source.details(ctx, itemId), where) as T;
        case "movisto":
          return checkFilm(await e.source.details(ctx, itemId), where) as T;
        case "novelsto":
          return checkNovel(await e.source.details(ctx, itemId), where) as T;
        case "booksto":
          return checkBook(await e.source.details(ctx, itemId), where) as T;
        default:
          throw new SourceError("unsupported", `${id} has no details`);
      }
    });
  }

  /** Chapters of a manga or novel (newest first), or a book's sections (in order). */
  chapters(id: string, itemId: string): Promise<Chapter[]> {
    return this.run(id, "chapters", itemId, async (e, ctx) => {
      const where = `${id} chapters of ${itemId}`;
      switch (e.app) {
        case "mangasto":
          return checkChapters(await this.manga_(id).chapters(ctx, itemId), where);
        case "novelsto":
          return checkChapters(await e.source.chapters(ctx, itemId), where);
        case "booksto":
          if (!e.source.sections) throw new SourceError("unsupported", `${id} books can't be read on storm`);
          return checkChapters(await e.source.sections(ctx, itemId), where, "source");
        default:
          throw new SourceError("unsupported", `${id} has no chapters`);
      }
    });
  }

  /** Episodes of an anime, or of one season of a series. */
  episodes(id: string, itemId: string, seasonId?: string): Promise<Episode[]> {
    return this.run(id, "episodes", `${itemId}:${seasonId ?? ""}`, async (e, ctx) => {
      const where = `${id} episodes of ${itemId}`;
      if (e.app === "anisto") return checkEpisodes(await e.source.episodes(ctx, itemId), where);
      if (e.app === "movisto") {
        if (!seasonId) throw new SourceError("not-found", `${where}: which season?`);
        return checkEpisodes(await e.source.episodes(ctx, itemId, seasonId), where);
      }
      throw new SourceError("unsupported", `${id} has no episodes`);
    });
  }

  /** Where an episode plays, or a film when no episode is given. */
  servers(id: string, itemId: string, episodeId?: string): Promise<VideoServer[]> {
    return this.run(id, "servers", `${itemId}:${episodeId ?? ""}`, async (e, ctx) => {
      const where = `${id} servers of ${episodeId ?? itemId}`;
      if (e.app === "anisto") {
        if (!episodeId) throw new SourceError("not-found", `${where}: which episode?`);
        return checkServers(await e.source.servers(ctx, itemId, episodeId), where);
      }
      if (e.app === "movisto") return checkServers(await e.source.servers(ctx, itemId, episodeId), where);
      throw new SourceError("unsupported", `${id} has nothing to play`);
    });
  }

  /** The text of a novel chapter or a book section. */
  content(id: string, itemId: string, chapterId: string): Promise<TextContent> {
    return this.run(id, "content", `${itemId}:${chapterId}`, async (e, ctx) => {
      const where = `${id} text of ${chapterId}`;
      if (e.app === "novelsto") return checkContent(await e.source.content(ctx, itemId, chapterId), where);
      if (e.app === "booksto") {
        if (!e.source.content) throw new SourceError("unsupported", `${id} books can't be read on storm`);
        return checkContent(await e.source.content(ctx, itemId, chapterId), where);
      }
      throw new SourceError("unsupported", `${id} has no text`);
    });
  }

  /** Fetches a cover or page for the image proxy, the way the source needs it fetched. */
  image(id: string, url: string, timeoutMs = 20_000): Promise<Response> {
    const { source } = this.entry(id);
    const proxy = this.opts.proxy?.(id);
    return this.fetch(url, {
      headers: { "User-Agent": DEFAULT_USER_AGENT, Referer: `${source.baseUrl}/`, ...source.images?.headers },
      signal: AbortSignal.timeout(timeoutMs),
      ...(proxy ? { proxy } : {}),
      ...(source.images?.resolve?.length ? { resolve: source.images.resolve } : {}),
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
