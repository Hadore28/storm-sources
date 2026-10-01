// The contract between an extension and the storm host. Everything an extension
// exports, and everything the host hands it, is described here. Bump SDK_VERSION
// on any change an older host or extension could not handle.

export const SDK_VERSION = 1;

export type AppKind = "mangasto";

/** A label shown on the site: one string, or one per site language. */
export type Text = string | { en: string; ar?: string };

// ---------- filters ----------

export interface Option {
  value: string;
  label: Text;
  /** the storm genre this option stands for, so the site can filter across sources */
  genre?: GenreKey;
}

interface FilterBase {
  id: string;
  label: Text;
}

export type FilterDef =
  /** pick one */
  | (FilterBase & { type: "select"; options: Option[]; default?: string })
  /** pick any number */
  | (FilterBase & { type: "multi"; options: Option[] })
  /** each option can be required, excluded or ignored */
  | (FilterBase & { type: "tristate"; options: Option[] })
  /** sort field, optionally with a direction */
  | (FilterBase & { type: "sort"; options: Option[]; default: SortValue; directions: boolean })
  | (FilterBase & { type: "toggle"; default?: boolean })
  | (FilterBase & { type: "text"; placeholder?: Text })
  /** a number range, like a year */
  | (FilterBase & { type: "range"; min: number; max: number });

export interface SortValue {
  value: string;
  dir: "asc" | "desc";
}

export interface TristateValue {
  include: string[];
  exclude: string[];
}

export type FilterValue = string | string[] | TristateValue | SortValue | boolean | { min?: number; max?: number };
export type FilterValues = Record<string, FilterValue>;

// ---------- settings an admin can change per source ----------

export type SettingDef =
  | { id: string; type: "select"; label: Text; options: Option[]; default: string; description?: Text }
  | { id: string; type: "toggle"; label: Text; default: boolean; description?: Text }
  | { id: string; type: "text"; label: Text; default: string; description?: Text };

export type SettingValues = Record<string, string | boolean>;

// ---------- content ----------

export type MangaType = "manga" | "manhwa" | "manhua" | "comic" | "other";
export type Status = "ongoing" | "completed" | "hiatus" | "cancelled" | "unknown";
export type Demographic = "shounen" | "shoujo" | "seinen" | "josei";
export type ContentRating = "safe" | "suggestive" | "nsfw";

export const GENRES = [
  "action", "adventure", "comedy", "drama", "fantasy", "horror", "mystery", "romance", "scifi",
  "sliceOfLife", "sports", "supernatural", "thriller", "tragedy", "psychological", "historical",
  "isekai", "darkFantasy", "martialArts", "murim", "cultivation", "school", "mecha", "music",
  "cooking", "medical", "military", "crime", "magic", "reincarnation", "timeTravel", "villainess",
  "gameWorld", "superhero", "survival", "apocalypse", "monsters", "vampires", "demons", "zombies",
  "harem", "reverseHarem", "boysLove", "girlsLove", "gender", "office", "family", "revenge",
  "workplace", "ecchi", "mature", "gore",
] as const;

export type GenreKey = (typeof GENRES)[number];

export interface Genre {
  /** as the source names it */
  name: string;
  key?: GenreKey;
}

export interface MangaSummary {
  /** the source's own id, stable over time */
  id: string;
  title: string;
  cover?: string;
  url?: string;
  type?: MangaType;
  status?: Status;
  /** highest chapter number the list shows, when it does */
  latestChapter?: number;
  /** ISO date of the latest update, when the list shows it */
  updatedAt?: string;
  rating?: ContentRating;
}

export interface MangaDetails extends MangaSummary {
  altTitles: string[];
  description?: string;
  authors: string[];
  artists: string[];
  genres: Genre[];
  demographic?: Demographic;
  year?: number;
  /** language the series was first published in */
  originalLang?: string;
  /** ids on catalogue sites, used to match one series across sources */
  links?: { anilist?: string; mal?: string; mangaupdates?: string; kitsu?: string };
}

export interface Chapter {
  /** the source's own id, stable over time */
  id: string;
  number?: number;
  volume?: number;
  title?: string;
  lang: string;
  /** ISO date */
  date?: string;
  /** scanlation group or uploader */
  group?: string;
  url?: string;
  /** hosted elsewhere (an official site); the source has no pages for it */
  external?: boolean;
  pages?: number;
}

export interface PageRef {
  url: string;
  width?: number;
  height?: number;
}

export interface Paged<T> {
  items: T[];
  hasNext: boolean;
}

export interface Listing {
  id: string;
  label: Text;
  /** the listing honours the source's filters */
  filters?: boolean;
}

export interface ListRequest {
  listing: string;
  page: number;
  filters: FilterValues;
}

export interface SearchRequest {
  query: string;
  page: number;
  filters: FilterValues;
}

export interface MangaSource {
  /** unique across every extension, e.g. "mangadex-en" */
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
  icon?: string;
  /** content rating of the source as a whole */
  rating?: ContentRating;
  /** requests the site tolerates, e.g. { requests: 5, perMs: 1000 } */
  rateLimit?: { requests: number; perMs: number };
  /** headers sent with every request, e.g. a Referer */
  headers?: Record<string, string>;
  /** how covers and pages may be loaded */
  images?: {
    headers?: Record<string, string>;
    /** the browser must not send a Referer (the site swaps in a placeholder otherwise) */
    noReferrer?: boolean;
    /** must be fetched by the storm server rather than the visitor's browser */
    proxy?: boolean;
  };
  /** how long answers stay fresh (ms), when the host's defaults don't fit, e.g. expiring page links */
  cache?: Partial<Record<"filters" | "list" | "search" | "manga" | "chapters" | "pages", number>>;
  listings: Listing[];
  /** static, or loaded once from the site (the host caches the result) */
  filters: FilterDef[] | ((ctx: Context) => Promise<FilterDef[]>);
  /** search honours the filters too */
  searchFilters?: boolean;
  settings?: SettingDef[];
  list(ctx: Context, req: ListRequest): Promise<Paged<MangaSummary>>;
  search?(ctx: Context, req: SearchRequest): Promise<Paged<MangaSummary>>;
  manga(ctx: Context, id: string): Promise<MangaDetails>;
  /** every chapter, newest first */
  chapters(ctx: Context, mangaId: string): Promise<Chapter[]>;
  pages(ctx: Context, mangaId: string, chapterId: string): Promise<PageRef[]>;
  /** maps a link on the site to ids, for pasting links */
  resolveUrl?(url: string): { mangaId: string; chapterId?: string } | null;
}

export interface Extension {
  /** reverse-domain package name, e.g. "storm.mangasto.mangadex" */
  pkg: string;
  name: string;
  version: string;
  sdk: number;
  app: AppKind;
  sources: MangaSource[];
}

// ---------- what the host provides ----------

export type QueryValue = string | number | boolean | undefined | null | (string | number)[];

export interface RequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  /** JSON body */
  json?: unknown;
  /** form body */
  form?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** extra attempts after a network error, 429 or 5xx (default 2 for GET, 0 otherwise) */
  retries?: number;
  /** keep the response this long (ms); repeated calls are served from cache */
  cacheMs?: number;
}

export interface HttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface Http {
  /** raw response, any status */
  request(method: "GET" | "POST", url: string, opts?: RequestOptions): Promise<HttpResponse>;
  /** these throw a SourceError on anything but 2xx */
  text(url: string, opts?: RequestOptions & { method?: "GET" | "POST" }): Promise<string>;
  json<T = unknown>(url: string, opts?: RequestOptions & { method?: "GET" | "POST" }): Promise<T>;
  doc(url: string, opts?: RequestOptions & { method?: "GET" | "POST" }): Promise<Doc>;
}

/** A parsed HTML document. */
export interface Doc extends El {
  /** the URL relative links resolve against */
  url: string;
}

export interface El {
  one(selector: string): El | null;
  all(selector: string): El[];
  /** text content, whitespace collapsed */
  text(): string;
  attr(name: string): string | null;
  /** an attribute holding a link, made absolute */
  href(name?: string): string | null;
  html(): string;
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

export interface Context {
  http: Http;
  html(text: string, url: string): Doc;
  cache: Cache;
  settings: SettingValues;
  log(message: string, data?: unknown): void;
}
