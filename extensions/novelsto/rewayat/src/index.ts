// Rewayat Club — Arabic translated and original web novels, through the JSON
// API the site's own pages use. Covers live on the api. subdomain.

import {
  SourceError,
  clean,
  defineExtension,
  defineNovelSource,
  genreKey,
  htmlToBlocks,
  status,
  type Chapter,
  type Context,
  type FilterValues,
  type NovelSummary,
  type Paged,
  type Text,
} from "@storm-sources/sdk";

const SITE = "https://rewayat.club";
const API = `${SITE}/api`;
const MEDIA = "https://api.rewayat.club";
const PER_PAGE = 24;
const L = (en: string, ar: string): Text => ({ en, ar });

interface RwGenre {
  id: number;
  arabic: string;
  english: string;
}

interface RwNovel {
  slug: string;
  arabic?: string;
  english?: string;
  about?: string;
  poster_url?: string;
  original?: boolean;
  complete?: boolean;
  num_chapters?: number;
  genre?: RwGenre[];
  contributors?: { username: string; profile?: { display_name?: string } }[];
  get_novel_status?: string;
}

interface RwPage<T> {
  count: number;
  next: string | null;
  results: T[];
}

interface RwChapter {
  number: number;
  title?: string;
  date?: string;
  uploader?: { username?: string };
}

// The site's genre ids; the API has no list of them.
const GENRES: RwGenre[] = [
  { id: 2, english: "Action", arabic: "أكشن" },
  { id: 6, english: "Adventure", arabic: "مغامرة" },
  { id: 1, english: "Comedy", arabic: "كوميديا" },
  { id: 3, english: "Drama", arabic: "دراما" },
  { id: 4, english: "Fantasy", arabic: "فانتازيا" },
  { id: 14, english: "Harem", arabic: "حريم" },
  { id: 13, english: "Horror", arabic: "رعب" },
  { id: 11, english: "Magic", arabic: "سحر" },
  { id: 5, english: "Martial Arts", arabic: "مهارات القتال" },
  { id: 7, english: "Romance", arabic: "رومانسي" },
  { id: 9, english: "School", arabic: "الحياة المدرسية" },
  { id: 8, english: "Sci-Fi", arabic: "خيال علمي" },
  { id: 12, english: "Sports", arabic: "رياضة" },
  { id: 10, english: "Supernatural", arabic: "قوى خارقة" },
];

const cover = (path?: string) => (path ? new URL(path, MEDIA).toString() : undefined);
const titleOf = (n: Pick<RwNovel, "arabic" | "english" | "slug">) => clean(n.arabic) || clean(n.english) || n.slug;
const unquote = (s: string) => s.replace(/^["“”]+|["“”]+$/g, "").trim();
const url = (slug: string) => `${SITE}/novel/${encodeURIComponent(slug)}`;

const summary = (n: RwNovel): NovelSummary => ({
  id: n.slug,
  title: titleOf(n),
  cover: cover(n.poster_url),
  url: url(n.slug),
  status: n.complete === undefined ? undefined : n.complete ? "completed" : "ongoing",
  latestChapter: n.num_chapters || undefined,
});

const api = <T>(ctx: Context, path: string, query?: Record<string, string | number | undefined>, cacheMs?: number) =>
  ctx.http.json<T>(`${API}${path}`, { query, cacheMs, headers: { Accept: "application/json" } });

function filterQuery(filters: FilterValues) {
  const genre = typeof filters.genre === "string" && filters.genre ? filters.genre : undefined;
  const type = typeof filters.type === "string" && filters.type ? filters.type : undefined;
  return { genre, type };
}

async function novels(ctx: Context, page: number, query: Record<string, string | number | undefined>): Promise<Paged<NovelSummary>> {
  const d = await api<RwPage<RwNovel>>(ctx, "/novels/", { page, page_size: PER_PAGE, ...query });
  return { items: d.results.map(summary), hasNext: !!d.next };
}

// One request feeds the three lists on the site's home page.
const home = (ctx: Context) =>
  api<Record<"novels_translated_ranked" | "novels_original_ranked" | "novels_recently_added", RwNovel[]>>(ctx, "/home/novels/", undefined, 10 * 60_000);

const HOME_LISTS: Record<string, "novels_translated_ranked" | "novels_original_ranked" | "novels_recently_added"> = {
  trending: "novels_translated_ranked",
  original: "novels_original_ranked",
  new: "novels_recently_added",
};

// The weekly feed lists chapters; each novel shows once, with its newest chapter.
async function latest(ctx: Context, page: number): Promise<Paged<NovelSummary>> {
  const d = await api<RwPage<RwChapter & { novel: RwNovel }>>(ctx, "/chapters/weekly/list/", { page });
  const seen = new Set<string>();
  const items = d.results.flatMap((c): NovelSummary[] => {
    if (!c.novel?.slug || seen.has(c.novel.slug)) return [];
    seen.add(c.novel.slug);
    return [{ ...summary(c.novel), latestChapter: c.number, updatedAt: c.date }];
  });
  return { items, hasNext: !!d.next };
}

// Placeholder numbers like 99999 or 999888 mark notices, not chapters.
const isNotice = (n: number, count: number) => n >= 1000 && n > count * 10;

const rewayat = defineNovelSource({
  id: "rewayat",
  name: "Rewayat Club",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 4, perMs: 1000 },
  cache: { chapters: 15 * 60_000 },
  listings: [
    { id: "latest", label: L("Latest chapters", "آخر الفصول") },
    { id: "trending", label: L("Most read this month", "الأكثر قراءة هذا الشهر") },
    { id: "original", label: L("Top Arabic originals", "الأكثر قراءة من الأعمال العربية") },
    { id: "new", label: L("Recently added", "أُضيفت حديثاً") },
    { id: "chapters", label: L("Most chapters", "الأكثر فصولاً"), filters: true },
    { id: "az", label: L("A–Z", "أبجدياً"), filters: true },
  ],
  filters: [
    {
      id: "genre",
      type: "select",
      label: L("Genre", "التصنيف"),
      options: GENRES.map((g) => ({ value: String(g.id), label: L(g.english, g.arabic), genre: genreKey(g.english) })),
    },
    {
      id: "type",
      type: "select",
      label: L("Kind", "النوع"),
      options: [
        { value: "1", label: L("Translated", "مترجمة") },
        { value: "2", label: L("Arabic originals", "أعمال عربية") },
        { value: "3", label: L("Completed", "مكتملة") },
      ],
    },
  ],
  searchFilters: true,

  async list(ctx, { listing, page, filters }) {
    if (listing === "latest") return latest(ctx, page);
    const key = HOME_LISTS[listing];
    if (key) return { items: page === 1 ? ((await home(ctx))[key] ?? []).map(summary) : [], hasNext: false };
    const ordering = listing === "az" ? "english" : "-num_chapters";
    return novels(ctx, page, { ordering, ...filterQuery(filters) });
  },

  search: (ctx, { query, page, filters }) => novels(ctx, page, { search: query, ...filterQuery(filters) }),

  async details(ctx, id) {
    const n = await api<RwNovel>(ctx, `/novels/${encodeURIComponent(id)}/`);
    if (!n?.slug) throw new SourceError("not-found", `Rewayat has no novel "${id}"`);
    return {
      ...summary(n),
      altTitles: [clean(n.english)].filter(Boolean),
      description: n.about,
      authors: [],
      status: n.get_novel_status ? status(n.get_novel_status) : undefined,
      translators: (n.contributors ?? []).map((c) => unquote(clean(c.profile?.display_name) || c.username)),
      genres: (n.genre ?? []).map((g) => ({ name: g.arabic || g.english, key: genreKey(g.english) ?? genreKey(g.arabic) })),
      originalLang: n.original ? "ar" : undefined,
    };
  },

  async chapters(ctx, id) {
    const list = await allChapters(ctx, id);
    return list.map(
      (c): Chapter => ({
        id: String(c.number),
        number: isNotice(c.number, list.length) ? undefined : c.number,
        title: clean(c.title) || undefined,
        lang: "ar",
        date: c.date,
        group: unquote(clean(c.uploader?.username)) || undefined,
        url: `${url(id)}/${c.number}`,
      }),
    );
  },

  async content(ctx, novelId, chapterId) {
    const d = await api<{ number: number; title?: string; content?: unknown }>(ctx, `/chapters/${encodeURIComponent(novelId)}/${encodeURIComponent(chapterId)}/`);
    const parts = Array.isArray(d?.content) ? (d.content as unknown[]).flat(2).filter((p): p is string => typeof p === "string") : [];
    if (!parts.length) throw new SourceError("not-found", `Rewayat has no text for chapter ${chapterId}`);
    return { title: clean(d.title) || undefined, blocks: htmlToBlocks(parts.join("\n"), SITE) };
  },
});

// The API takes about 20 ms per chapter it lists, so one page with every chapter
// of a long novel takes over a minute; pages of 100 fetched side by side take
// seconds. Numbers have gaps and repeats, so nothing is filled in.
const CHAPTER_PAGE = 100;

async function allChapters(ctx: Context, id: string): Promise<RwChapter[]> {
  const page = (n: number) => api<RwPage<RwChapter>>(ctx, `/chapters/${encodeURIComponent(id)}/`, { page: n, page_size: CHAPTER_PAGE }, 10 * 60_000);
  const first = await page(1);
  const pages = Math.min(Math.ceil(first.count / CHAPTER_PAGE), 200);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page(i + 2)));
  return [first, ...rest].flatMap((p) => p.results);
}

export default defineExtension({
  pkg: "storm.novelsto.rewayat",
  name: "Rewayat Club",
  version: "1.0.0",
  app: "novelsto",
  sources: [rewayat],
});
