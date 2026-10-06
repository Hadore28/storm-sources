// Every answer an extension gives is checked and tidied here before the site
// sees it. A broken answer becomes a "changed" error naming what was wrong,
// which is how the admin learns a site changed its layout.

import {
  GENRES,
  SourceError,
  clean,
  type AnimeDetails,
  type AnimeSummary,
  type AppKind,
  type BookDetails,
  type BookSummary,
  type Chapter,
  type Episode,
  type FilmDetails,
  type FilmSummary,
  type FilterDef,
  type Genre,
  type MangaDetails,
  type MangaSummary,
  type NovelDetails,
  type NovelSummary,
  type PageRef,
  type Paged,
  type Season,
  type TextBlock,
  type TextContent,
  type VideoServer,
} from "@storm-sources/sdk";

const isHttp = (u: unknown): u is string => typeof u === "string" && /^https?:\/\/[^\s]+$/.test(u);
const isIso = (d: unknown) => typeof d === "string" && !Number.isNaN(Date.parse(d));
const iso = (d: unknown) => (isIso(d) ? new Date(d as string).toISOString() : undefined);
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : undefined);
const int = (n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => (Number.isInteger(n) && (n as number) >= min && (n as number) <= max ? (n as number) : undefined);
const yearOf = (n: unknown) => int(n, 1801, 2099);
const STATUSES = new Set(["ongoing", "completed", "hiatus", "cancelled", "unknown"]);
const TYPES = new Set(["manga", "manhwa", "manhua", "comic", "other"]);
const ANIME_TYPES = new Set(["tv", "movie", "ova", "ona", "special", "other"]);
const RATINGS = new Set(["safe", "suggestive", "nsfw"]);
const GENRE_SET = new Set<string>(GENRES);

function fail(what: string, detail?: unknown): never {
  throw new SourceError("changed", what, detail);
}

const strings = (list: unknown, exclude?: string) =>
  [...new Set((Array.isArray(list) ? list : []).map((s) => clean(typeof s === "string" ? s : "")).filter((t) => t && t !== exclude))];

const genres = (list: Genre[] | undefined) =>
  (list ?? [])
    .map((g) => ({ name: clean(g?.name), key: g?.key && GENRE_SET.has(g.key) ? g.key : undefined }))
    .filter((g, i, all) => g.name && all.findIndex((o) => o.name === g.name) === i);

/** The fields every kind of list item shares: an id, a title and safe links. */
function base<T extends { id: string; title: string; cover?: string; url?: string; rating?: string }>(m: T, where: string) {
  if (typeof m?.id !== "string" || !m.id.trim()) fail(`${where}: an item has no id`, m);
  const title = clean(m.title);
  if (!title) fail(`${where}: item ${m.id} has no title`, m);
  return {
    id: m.id.trim(),
    title,
    cover: isHttp(m.cover) ? m.cover : undefined,
    url: isHttp(m.url) ? m.url : undefined,
    rating: m.rating && RATINGS.has(m.rating) ? (m.rating as MangaSummary["rating"]) : undefined,
  };
}

const status = (s: unknown) => (typeof s === "string" && STATUSES.has(s) ? (s as MangaSummary["status"]) : undefined);

export const summaries = {
  mangasto: (m: MangaSummary, where: string): MangaSummary => ({
    ...base(m, where),
    type: m.type && TYPES.has(m.type) ? m.type : undefined,
    status: status(m.status),
    latestChapter: num(m.latestChapter),
    updatedAt: iso(m.updatedAt),
  }),
  anisto: (m: AnimeSummary, where: string): AnimeSummary => ({
    ...base(m, where),
    type: m.type && ANIME_TYPES.has(m.type) ? m.type : undefined,
    status: status(m.status),
    year: yearOf(m.year),
    latestEpisode: num(m.latestEpisode),
    updatedAt: iso(m.updatedAt),
  }),
  movisto: (m: FilmSummary, where: string): FilmSummary => ({
    ...base(m, where),
    kind: m.kind === "movie" || m.kind === "series" ? m.kind : undefined,
    year: yearOf(m.year),
    score: num(m.score) !== undefined && m.score! >= 0 && m.score! <= 10 ? m.score : undefined,
    quality: clean(m.quality) || undefined,
    updatedAt: iso(m.updatedAt),
  }),
  novelsto: (m: NovelSummary, where: string): NovelSummary => ({
    ...base(m, where),
    status: status(m.status),
    latestChapter: num(m.latestChapter),
    updatedAt: iso(m.updatedAt),
  }),
  booksto: (m: BookSummary, where: string): BookSummary => ({
    ...base(m, where),
    authors: strings(m.authors),
    year: yearOf(m.year),
  }),
};

export function checkPaged<T>(app: AppKind, p: Paged<T>, where: string): Paged<T> {
  if (!p || !Array.isArray(p.items)) fail(`${where}: no list returned`, p);
  const seen = new Set<string>();
  const check = summaries[app] as unknown as (m: T, where: string) => T & { id: string };
  const items = p.items.map((m) => check(m, where)).filter((m) => !seen.has(m.id) && seen.add(m.id));
  return { items, hasNext: !!p.hasNext && items.length > 0 };
}

export function checkDetails(m: MangaDetails, where: string): MangaDetails {
  const b = summaries.mangasto(m, where);
  return {
    ...b,
    altTitles: strings(m.altTitles, b.title),
    description: clean(m.description) || undefined,
    authors: strings(m.authors),
    artists: strings(m.artists),
    genres: genres(m.genres),
    demographic: m.demographic,
    year: yearOf(m.year),
    originalLang: m.originalLang,
    links: m.links,
  };
}

export function checkAnime(m: AnimeDetails, where: string): AnimeDetails {
  const b = summaries.anisto(m, where);
  return {
    ...b,
    altTitles: strings(m.altTitles, b.title),
    description: clean(m.description) || undefined,
    genres: genres(m.genres),
    studios: strings(m.studios),
    season: clean(m.season) || undefined,
    episodeCount: int(m.episodeCount, 1),
    duration: int(m.duration, 1, 600),
    links: m.links,
  };
}

function seasons(list: Season[] | undefined, where: string): Season[] {
  if (list !== undefined && !Array.isArray(list)) fail(`${where}: seasons are not a list`, list);
  const seen = new Set<string>();
  return (list ?? []).flatMap((s) => {
    if (typeof s?.id !== "string" || !s.id.trim()) fail(`${where}: a season has no id`, s);
    if (seen.has(s.id)) return [];
    seen.add(s.id);
    return [{ id: s.id.trim(), number: num(s.number), title: clean(s.title) || undefined }];
  });
}

export function checkFilm(m: FilmDetails, where: string): FilmDetails {
  const b = summaries.movisto(m, where);
  return {
    ...b,
    altTitles: strings(m.altTitles, b.title),
    description: clean(m.description) || undefined,
    genres: genres(m.genres),
    backdrop: isHttp(m.backdrop) ? m.backdrop : undefined,
    duration: int(m.duration, 1, 1000),
    cast: strings(m.cast),
    directors: strings(m.directors),
    countries: strings(m.countries),
    languages: strings(m.languages),
    seasons: seasons(m.seasons, where),
    links: m.links,
  };
}

export function checkNovel(m: NovelDetails, where: string): NovelDetails {
  const b = summaries.novelsto(m, where);
  return {
    ...b,
    altTitles: strings(m.altTitles, b.title),
    description: clean(m.description) || undefined,
    authors: strings(m.authors),
    translators: strings(m.translators),
    genres: genres(m.genres),
    year: yearOf(m.year),
    originalLang: m.originalLang,
    chapterCount: int(m.chapterCount, 1),
    links: m.links,
  };
}

const FORMATS = new Set(["pdf", "epub", "txt", "other"]);

export function checkBook(m: BookDetails, where: string): BookDetails {
  const b = summaries.booksto(m, where);
  const files = (Array.isArray(m.files) ? m.files : []).flatMap((f) =>
    isHttp(f?.url) ? [{ format: FORMATS.has(f.format) ? f.format : "other", url: f.url, size: clean(f.size) || undefined, viewable: !!f.viewable }] : [],
  ) as BookDetails["files"];
  return {
    ...b,
    altTitles: strings(m.altTitles, b.title),
    description: clean(m.description) || undefined,
    genres: genres(m.genres),
    publisher: clean(m.publisher) || undefined,
    pages: int(m.pages, 1, 100_000),
    lang: m.lang,
    files,
    readable: !!m.readable,
  };
}

/**
 * Chapters newest first (manga and novels), or in the source's order (a book's
 * table of contents).
 */
export function checkChapters(list: Chapter[], where: string, order: "newest" | "source" = "newest"): Chapter[] {
  if (!Array.isArray(list)) fail(`${where}: no chapter list returned`, list);
  const seen = new Set<string>();
  const out: Chapter[] = [];
  for (const c of list) {
    if (typeof c?.id !== "string" || !c.id.trim()) fail(`${where}: a chapter has no id`, c);
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (!c.lang) fail(`${where}: chapter ${c.id} has no language`, c);
    out.push({
      id: c.id.trim(),
      number: num(c.number),
      volume: num(c.volume),
      title: clean(c.title) || undefined,
      lang: c.lang,
      date: iso(c.date),
      group: clean(c.group) || undefined,
      url: isHttp(c.url) ? c.url : undefined,
      external: !!c.external,
      pages: int(c.pages),
    });
  }
  if (order === "source") return out;
  // Newest first: by number when both have one, otherwise keep the source's order.
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.number !== undefined && b.c.number !== undefined && a.c.number !== b.c.number ? b.c.number - a.c.number : a.i - b.i))
    .map(({ c }) => c);
}

/** Episodes first to last: by number when both have one, otherwise in the source's order. */
export function checkEpisodes(list: Episode[], where: string): Episode[] {
  if (!Array.isArray(list)) fail(`${where}: no episode list returned`, list);
  const seen = new Set<string>();
  const out: Episode[] = [];
  for (const e of list) {
    if (typeof e?.id !== "string" || !e.id.trim()) fail(`${where}: an episode has no id`, e);
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({
      id: e.id.trim(),
      number: num(e.number),
      title: clean(e.title) || undefined,
      date: iso(e.date),
      thumbnail: isHttp(e.thumbnail) ? e.thumbnail : undefined,
      url: isHttp(e.url) ? e.url : undefined,
    });
  }
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.number !== undefined && b.e.number !== undefined && a.e.number !== b.e.number ? a.e.number - b.e.number : a.i - b.i))
    .map(({ e }) => e);
}

const KINDS = new Set(["embed", "hls", "mp4"]);
const AUDIO = new Set(["sub", "dub", "raw"]);

export function checkServers(list: VideoServer[], where: string): VideoServer[] {
  if (!Array.isArray(list)) fail(`${where}: no server list returned`, list);
  const seen = new Set<string>();
  const out: VideoServer[] = [];
  for (const s of list) {
    // a server without a usable address is skipped, not fatal: others may play
    if (!isHttp(s?.url) || !KINDS.has(s.kind) || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({
      name: clean(s.name) || new URL(s.url).host,
      url: s.url,
      kind: s.kind,
      quality: clean(s.quality) || undefined,
      audio: s.audio && AUDIO.has(s.audio) ? s.audio : undefined,
      lang: clean(s.lang) || undefined,
      download: !!s.download,
    });
  }
  if (!out.some((s) => !s.download)) fail(`${where}: no playable servers`, list);
  return out;
}

export function checkContent(c: TextContent, where: string): TextContent {
  if (!c || !Array.isArray(c.blocks)) fail(`${where}: no text returned`, c);
  const blocks = c.blocks.flatMap((b): TextBlock[] => {
    if (b?.type === "image") return isHttp(b.src) ? [clean(b.alt) ? { type: "image", src: b.src, alt: clean(b.alt) } : { type: "image", src: b.src }] : [];
    if (b?.type === "break") return [{ type: "break" }];
    if (b?.type === "p" || b?.type === "heading" || b?.type === "quote" || b?.type === "verse") {
      const text = typeof b.text === "string" ? b.text.replace(/\s+/g, " ").trim() : "";
      return text ? [{ type: b.type, text }] : [];
    }
    return [];
  });
  if (!blocks.some((b) => b.type !== "break" && b.type !== "image")) fail(`${where}: the chapter has no text`, c);
  return { title: clean(c.title) || undefined, blocks };
}

export function checkPages(pages: PageRef[], where: string): PageRef[] {
  if (!Array.isArray(pages) || pages.length === 0) fail(`${where}: the chapter has no pages`, pages);
  return pages.map((p, i) => {
    if (!isHttp(p?.url)) fail(`${where}: page ${i + 1} has no usable address`, p);
    return { url: p.url, width: p.width, height: p.height };
  });
}

export function checkFilters(filters: FilterDef[], where: string): FilterDef[] {
  if (!Array.isArray(filters)) fail(`${where}: filters are not a list`, filters);
  const ids = new Set<string>();
  for (const f of filters) {
    if (!f?.id || ids.has(f.id)) fail(`${where}: filter ids must be unique`, f);
    ids.add(f.id);
    if ("options" in f && (!Array.isArray(f.options) || f.options.length === 0)) fail(`${where}: filter ${f.id} has no options`, f);
  }
  return filters;
}
