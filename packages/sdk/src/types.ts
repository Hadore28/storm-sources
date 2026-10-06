// The contract between an extension and the storm host. Everything an extension
// exports, and everything the host hands it, is described here. Bump SDK_VERSION
// on any change an older host or extension could not handle.

export const SDK_VERSION = 2;

/** SDK versions this release can still run. Version 1 extensions are manga only. */
export const SUPPORTED_SDKS = [1, 2] as const;

export const APPS = ["mangasto", "anisto", "movisto", "novelsto", "booksto"] as const;
export type AppKind = (typeof APPS)[number];

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

// ---------- shared content ----------

export type Status = "ongoing" | "completed" | "hiatus" | "cancelled" | "unknown";
export type ContentRating = "safe" | "suggestive" | "nsfw";

export const GENRES = [
  "action", "adventure", "comedy", "drama", "fantasy", "horror", "mystery", "romance", "scifi",
  "sliceOfLife", "sports", "supernatural", "thriller", "tragedy", "psychological", "historical",
  "isekai", "darkFantasy", "martialArts", "murim", "cultivation", "school", "mecha", "music",
  "cooking", "medical", "military", "crime", "magic", "reincarnation", "timeTravel", "villainess",
  "gameWorld", "superhero", "survival", "apocalypse", "monsters", "vampires", "demons", "zombies",
  "harem", "reverseHarem", "boysLove", "girlsLove", "gender", "office", "family", "revenge",
  "workplace", "ecchi", "mature", "gore",
  // films and books
  "documentary", "animation", "biography", "western", "kids", "poetry", "philosophy", "religion",
  "science", "selfHelp", "politics", "economics", "literature",
] as const;

export type GenreKey = (typeof GENRES)[number];

export interface Genre {
  /** as the source names it */
  name: string;
  key?: GenreKey;
}

/** Ids on catalogue sites, used to match one title across sources. */
export interface Links {
  anilist?: string;
  mal?: string;
  mangaupdates?: string;
  kitsu?: string;
  tmdb?: string;
  imdb?: string;
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

/** A chapter of a manga or novel, or a section of a book. */
export interface Chapter {
  /** the source's own id, stable over time */
  id: string;
  number?: number;
  volume?: number;
  title?: string;
  lang: string;
  /** ISO date */
  date?: string;
  /** scanlation group, translator or uploader */
  group?: string;
  url?: string;
  /** hosted elsewhere (an official site); the source has no pages for it */
  external?: boolean;
  pages?: number;
}

/** An episode of an anime or a series. */
export interface Episode {
  id: string;
  number?: number;
  title?: string;
  /** ISO date it aired or was added */
  date?: string;
  thumbnail?: string;
  url?: string;
}

/** Somewhere an episode or film plays. */
export interface VideoServer {
  /** the host's name as the site shows it, e.g. "Streamwish" */
  name: string;
  url: string;
  /** a page to show in a frame, an HLS playlist, or a plain video file */
  kind: "embed" | "hls" | "mp4";
  quality?: string;
  audio?: "sub" | "dub" | "raw";
  /** language of the subtitles or dub, when the site says */
  lang?: string;
  /** a download link rather than a player */
  download?: boolean;
}

/** Readable text for a novel chapter or a book section. Never HTML. */
export interface TextContent {
  title?: string;
  blocks: TextBlock[];
}

export type TextBlock =
  | { type: "p"; text: string }
  | { type: "heading"; text: string }
  | { type: "quote"; text: string }
  /** a line of verse; consecutive ones form a poem */
  | { type: "verse"; text: string }
  | { type: "image"; src: string; alt?: string }
  | { type: "break" };

// ---------- what every source declares ----------

export interface SourceBase<S> {
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
  /** how covers, posters and pages may be loaded */
  images?: {
    headers?: Record<string, string>;
    /** the browser must not send a Referer (the site swaps in a placeholder otherwise) */
    noReferrer?: boolean;
    /** must be fetched by the storm server rather than the visitor's browser */
    proxy?: boolean;
    /** proxied images are fetched through these addresses, as in RequestOptions.resolve */
    resolve?: string[];
  };
  /** how long answers stay fresh (ms), when the host's defaults don't fit, e.g. expiring links */
  cache?: Partial<Record<Operation, number>>;
  listings: Listing[];
  /** static, or loaded once from the site (the host caches the result) */
  filters: FilterDef[] | ((ctx: Context) => Promise<FilterDef[]>);
  /** search honours the filters too */
  searchFilters?: boolean;
  settings?: SettingDef[];
  list(ctx: Context, req: ListRequest): Promise<Paged<S>>;
  search?(ctx: Context, req: SearchRequest): Promise<Paged<S>>;
}

export type Operation = "filters" | "list" | "search" | "manga" | "details" | "chapters" | "pages" | "episodes" | "servers" | "content";

// ---------- manga ----------

export type MangaType = "manga" | "manhwa" | "manhua" | "comic" | "other";
export type Demographic = "shounen" | "shoujo" | "seinen" | "josei";

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
  links?: Links;
}

export interface PageRef {
  url: string;
  width?: number;
  height?: number;
}

export interface MangaSource extends SourceBase<MangaSummary> {
  /** series are read on the source's own site; storm lists them and links out */
  readOn?: "site";
  manga(ctx: Context, id: string): Promise<MangaDetails>;
  /** every chapter, newest first */
  chapters(ctx: Context, mangaId: string): Promise<Chapter[]>;
  pages(ctx: Context, mangaId: string, chapterId: string): Promise<PageRef[]>;
  /** maps a link on the site to ids, for pasting links */
  resolveUrl?(url: string): { mangaId: string; chapterId?: string } | null;
}

// ---------- anime ----------

export type AnimeType = "tv" | "movie" | "ova" | "ona" | "special" | "other";

export interface AnimeSummary {
  id: string;
  title: string;
  cover?: string;
  url?: string;
  type?: AnimeType;
  status?: Status;
  year?: number;
  /** newest episode number the list shows */
  latestEpisode?: number;
  updatedAt?: string;
  rating?: ContentRating;
}

export interface AnimeDetails extends AnimeSummary {
  altTitles: string[];
  description?: string;
  genres: Genre[];
  studios: string[];
  /** e.g. "Fall 2026", as the site words it */
  season?: string;
  episodeCount?: number;
  /** minutes per episode */
  duration?: number;
  links?: Links;
}

export interface AnimeSource extends SourceBase<AnimeSummary> {
  details(ctx: Context, id: string): Promise<AnimeDetails>;
  /** every episode, first episode first */
  episodes(ctx: Context, animeId: string): Promise<Episode[]>;
  servers(ctx: Context, animeId: string, episodeId: string): Promise<VideoServer[]>;
}

// ---------- movies and series ----------

export type FilmKind = "movie" | "series";

export interface FilmSummary {
  id: string;
  title: string;
  cover?: string;
  url?: string;
  kind?: FilmKind;
  year?: number;
  /** the site's score out of 10 */
  score?: number;
  /** "1080p", "WEB-DL", as the site prints it */
  quality?: string;
  updatedAt?: string;
  rating?: ContentRating;
}

export interface Season {
  id: string;
  number?: number;
  title?: string;
}

export interface FilmDetails extends FilmSummary {
  altTitles: string[];
  description?: string;
  genres: Genre[];
  backdrop?: string;
  /** minutes */
  duration?: number;
  cast: string[];
  directors: string[];
  countries: string[];
  languages: string[];
  /** a series' seasons, oldest first; empty for a film */
  seasons: Season[];
  links?: Links;
}

export interface FilmSource extends SourceBase<FilmSummary> {
  details(ctx: Context, id: string): Promise<FilmDetails>;
  /** a season's episodes, first episode first */
  episodes(ctx: Context, filmId: string, seasonId: string): Promise<Episode[]>;
  /** where a film plays, or an episode when one is given */
  servers(ctx: Context, filmId: string, episodeId?: string): Promise<VideoServer[]>;
}

// ---------- novels ----------

export interface NovelSummary {
  id: string;
  title: string;
  cover?: string;
  url?: string;
  status?: Status;
  latestChapter?: number;
  updatedAt?: string;
  rating?: ContentRating;
}

export interface NovelDetails extends NovelSummary {
  altTitles: string[];
  description?: string;
  authors: string[];
  /** who translated it, when the site credits them */
  translators: string[];
  genres: Genre[];
  year?: number;
  originalLang?: string;
  chapterCount?: number;
  links?: Links;
}

export interface NovelSource extends SourceBase<NovelSummary> {
  details(ctx: Context, id: string): Promise<NovelDetails>;
  /** every chapter, newest first */
  chapters(ctx: Context, novelId: string): Promise<Chapter[]>;
  content(ctx: Context, novelId: string, chapterId: string): Promise<TextContent>;
}

// ---------- books ----------

export interface BookSummary {
  id: string;
  title: string;
  cover?: string;
  url?: string;
  authors: string[];
  year?: number;
  rating?: ContentRating;
}

export interface BookFile {
  format: "pdf" | "epub" | "txt" | "other";
  url: string;
  /** "4.2 MB", as the site prints it */
  size?: string;
  /** the file can be shown in a frame on storm */
  viewable?: boolean;
}

export interface BookDetails extends BookSummary {
  altTitles: string[];
  description?: string;
  genres: Genre[];
  publisher?: string;
  pages?: number;
  lang?: string;
  files: BookFile[];
  /** the text can be read on storm, section by section */
  readable: boolean;
}

export interface BookSource extends SourceBase<BookSummary> {
  details(ctx: Context, id: string): Promise<BookDetails>;
  /** the table of contents, first section first; needed when the book is readable */
  sections?(ctx: Context, bookId: string): Promise<Chapter[]>;
  content?(ctx: Context, bookId: string, sectionId: string): Promise<TextContent>;
}

// ---------- extensions ----------

export interface SourceByApp {
  mangasto: MangaSource;
  anisto: AnimeSource;
  movisto: FilmSource;
  novelsto: NovelSource;
  booksto: BookSource;
}

export type AnySource = SourceByApp[AppKind];

interface ExtensionOf<A extends AppKind> {
  /** reverse-domain package name, e.g. "storm.mangasto.mangadex" */
  pkg: string;
  name: string;
  version: string;
  sdk: number;
  app: A;
  sources: SourceByApp[A][];
}

export type Extension = { [A in AppKind]: ExtensionOf<A> }[AppKind];

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
  /** connect to these IPs instead of the host's DNS answer, like curl --resolve */
  resolve?: string[];
  /** "manual" hands back a redirect (its address in headers.location) instead of following it */
  redirect?: "follow" | "manual";
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
  /** a client that keeps the cookies sites set, for steps that need the same visit, like a page and then its form */
  session(): Http;
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
  /** a copy with the matching descendants removed, e.g. ads or hidden decoys */
  without(...selectors: string[]): El;
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
