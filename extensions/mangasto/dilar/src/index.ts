// Dilar (dilar.tube) — a large Arabic catalogue with a public JSON API for series
// and chapter lists. Dilar encrypts its chapter pages against other sites, so
// chapters open on Dilar itself. Novels are left out.

import {
  SourceError,
  chapterNumber,
  clean,
  defineExtension,
  defineSource,
  demographic,
  genreIds,
  genreKey,
  genreOptions,
  mangaType,
  type Chapter,
  type Context,
  type FilterValues,
  type MangaDetails,
  type MangaSummary,
  type MangaType,
  type Paged,
  type Status,
  type Text,
  type TristateValue,
} from "@storm-sources/sdk";

const SITE = "https://dilar.tube";
const API = `${SITE}/api`;
const NOVEL = "99";

const L = (en: string, ar: string): Text => ({ en, ar });

interface Series {
  id: string;
  title: string;
  synonyms?: Record<string, string[]> | null;
  summary?: string | null;
  cover?: string | null;
  s_date?: string | null;
  over17?: boolean;
  story_status?: string | null;
  translation_status?: string | null;
  updated_at?: string;
  series_type_id?: string;
  seriesType?: { id: string; title: string; name: string } | null;
  categories?: { id: string; name: string }[];
  staff?: { name: string; Staff?: { role?: string } }[];
  external_source?: Record<string, string> | null;
  latestChapter?: { chapter?: string } | null;
}

interface DlChapter {
  id: string;
  chapter: string;
  volume?: number | null;
  title?: string | null;
  created_at?: string;
  releases?: { id: string; teams?: { name: string }[] }[];
}

// Dilar's series types: 1 Japanese, 2 Korean, 3 Chinese, 4 Arabic, 5 comic, 6 amateur, 7 Indonesian, 99 novel.
const TYPE: Record<string, MangaType> = { "1": "manga", "2": "manhwa", "3": "manhua", "5": "comic" };
const STATUS: Record<string, Status> = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", cancelled: "cancelled" };

const cover = (s: Series) => (s.cover ? `${SITE}/uploads/manga/cover/${s.id}/large_${s.cover}` : undefined);
const typeId = (s: Series) => s.seriesType?.id ?? s.series_type_id ?? "";
// the reader route takes a name segment; Dilar only reads the ids
const nameSlug = (title: string) => encodeURIComponent(title.trim().replace(/\s+/g, "-").slice(0, 80) || "series");

function summary(s: Series): MangaSummary {
  return {
    id: s.id,
    title: clean(s.title),
    cover: cover(s),
    url: `${SITE}/series/${s.id}/${nameSlug(s.title)}`,
    type: TYPE[typeId(s)] ?? "other",
    status: STATUS[s.story_status ?? ""] ?? "unknown",
    latestChapter: chapterNumber(s.latestChapter?.chapter),
    updatedAt: s.updated_at,
    rating: s.over17 ? "nsfw" : undefined,
  };
}

const notNovel = (s: Series) => typeId(s) !== NOVEL;

async function feed(ctx: Context, path: string, page: number): Promise<Paged<MangaSummary>> {
  const res = await ctx.http.json<{ series: Series[]; totalPages: number }>(`${API}${path}`, { query: { page }, cacheMs: 3 * 60_000 });
  return { items: res.series.filter(notNovel).map(summary), hasNext: page < res.totalPages };
}

async function filtered(ctx: Context, page: number, filters: FilterValues, query = ""): Promise<Paged<MangaSummary>> {
  const genres = filters.genres as TristateValue | undefined;
  const types = filters.type as string[] | undefined;
  const story = filters.story as string[] | undefined;
  const translation = filters.translation as string[] | undefined;
  const res = await ctx.http.json<{ rows: Series[]; total: number; perPage: number }>(`${API}/search/filter`, {
    method: "POST",
    json: {
      query,
      seriesType: { include: types ?? [], exclude: [NOVEL] },
      oneshot: false,
      categories: { include: genreIds(genres?.include).map(Number), exclude: genreIds(genres?.exclude).map(Number) },
      chapters: { min: "", max: "" },
      dates: { start: null, end: null },
      page,
      ...(story?.length ? { storyStatus: { include: story, exclude: [] } } : {}),
      ...(translation?.length ? { translationStatus: { include: translation, exclude: [] } } : {}),
    },
    retries: 1,
    cacheMs: 3 * 60_000,
  });
  return { items: res.rows.filter(notNovel).map(summary), hasNext: page * res.perPage < res.total };
}

const STATUS_OPTIONS = [
  { value: "ongoing", label: L("Ongoing", "مستمرة") },
  { value: "completed", label: L("Completed", "مكتملة") },
  { value: "hiatus", label: L("On hiatus", "متوقفة مؤقتاً") },
  { value: "cancelled", label: L("Cancelled", "ملغاة") },
];

const dilar = defineSource({
  id: "dilar",
  name: "Dilar",
  lang: "ar",
  baseUrl: SITE,
  icon: `${SITE}/logo512.png`,
  rateLimit: { requests: 4, perMs: 1000 },
  headers: { Accept: "application/json", Referer: `${SITE}/`, Origin: SITE },
  listings: [
    { id: "latest", label: L("Latest updates", "آخر التحديثات") },
    { id: "popular", label: L("Most viewed", "الأكثر مشاهدة") },
    { id: "browse", label: L("Browse", "تصفّح"), filters: true },
  ],
  async filters(ctx) {
    const groups = await ctx.http.json<{ id: string; categories: { id: string; name: string }[] }[]>(`${API}/categories`, { cacheMs: 24 * 3_600_000 });
    const genres = groups.find((g) => g.id === "1")?.categories ?? [];
    return [
      { id: "genres", type: "tristate", label: L("Genres", "التصنيفات"), options: genreOptions(genres) },
      {
        id: "type",
        type: "multi",
        label: L("Type", "النوع"),
        options: [
          { value: "1", label: L("Manga", "مانغا") },
          { value: "2", label: L("Manhwa", "مانهوا") },
          { value: "3", label: L("Manhua", "مانهوا صينية") },
          { value: "4", label: L("Arabic", "عربية") },
          { value: "5", label: L("Comic", "كوميك") },
        ],
      },
      { id: "story", type: "multi", label: L("Story status", "حالة القصة"), options: STATUS_OPTIONS },
      { id: "translation", type: "multi", label: L("Translation status", "حالة الترجمة"), options: STATUS_OPTIONS },
    ];
  },
  searchFilters: true,

  list(ctx, { listing, page, filters }) {
    if (listing === "latest") return feed(ctx, "/series/latest", page);
    if (listing === "popular") return feed(ctx, "/series/popular", page);
    return filtered(ctx, page, filters);
  },
  search: (ctx, { query, page, filters }) => filtered(ctx, page, filters, query),

  async manga(ctx, id): Promise<MangaDetails> {
    const s = await ctx.http.json<Series>(`${API}/series/${encodeURIComponent(id)}`);
    if (!s?.id) throw new SourceError("not-found", `Dilar has no series ${id}`);
    if (!notNovel(s)) throw new SourceError("not-found", `${s.title} is a novel`);
    const staff = (role: string) => (s.staff ?? []).filter((p) => p.Staff?.role === role).map((p) => p.name);
    const cats = (s.categories ?? []).map((c) => c.name);
    const year = Number(s.s_date?.slice(0, 4));
    const mu = s.external_source?.mangaupdates;
    return {
      ...summary(s),
      altTitles: Object.values(s.synonyms ?? {}).flat(),
      description: clean(s.summary) || undefined,
      authors: staff("Author"),
      artists: staff("Artist"),
      // Dilar files type and audience under categories too; those aren't genres
      genres: cats.filter((c) => mangaType(c) === "other" && !demographic(c)).map((name) => ({ name, key: genreKey(name) })),
      demographic: cats.map(demographic).find(Boolean),
      year: Number.isInteger(year) && year > 1900 ? year : undefined,
      links: mu ? { mangaupdates: mu } : undefined,
    };
  },

  async chapters(ctx, id) {
    const [series, res] = await Promise.all([
      ctx.http.json<Series>(`${API}/series/${encodeURIComponent(id)}`, { cacheMs: 10 * 60_000 }),
      ctx.http.json<{ chapters: DlChapter[] }>(`${API}/series/${encodeURIComponent(id)}/chapters`),
    ]);
    return res.chapters.map((c): Chapter => {
      const n = chapterNumber(c.chapter);
      return {
        id: c.releases?.[0]?.id ?? c.id,
        number: n,
        volume: c.volume || undefined,
        title: clean(c.title) || undefined,
        lang: "ar",
        date: c.created_at,
        group: c.releases?.[0]?.teams?.map((t) => t.name).join(", ") || undefined,
        url: `${SITE}/reader/${id}/${nameSlug(series.title)}/${n ?? c.chapter}`,
        // Dilar encrypts its pages for its own reader
        external: true,
      };
    });
  },

  async pages() {
    throw new SourceError("unsupported", "Dilar chapters open on Dilar");
  },

  resolveUrl(url) {
    const m = url.match(/dilar\.tube\/(?:series|reader|mangas)\/(\d+)/);
    return m ? { mangaId: m[1] } : null;
  },
});

export default defineExtension({
  pkg: "storm.mangasto.dilar",
  name: "Dilar",
  version: "1.0.0",
  app: "mangasto",
  sources: [dilar],
});
