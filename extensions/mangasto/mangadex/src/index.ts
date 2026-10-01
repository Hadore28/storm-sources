// MangaDex, through its public API (https://api.mangadex.org/docs). One source per
// language. The API is stable and documented, so this is the reference extension.

import {
  SourceError,
  chapterNumber,
  defineExtension,
  defineSource,
  genreKey,
  type Chapter,
  type ContentRating,
  type Context,
  type FilterDef,
  type FilterValues,
  type MangaDetails,
  type MangaSource,
  type MangaSummary,
  type MangaType,
  type Paged,
  type SortValue,
  type Status,
  type Text,
  type TristateValue,
} from "@storm-sources/sdk";

const API = "https://api.mangadex.org";
const SITE = "https://mangadex.org";
const COVERS = "https://uploads.mangadex.org/covers";
const PER_PAGE = 30;
// MangaDex refuses offsets past 10,000.
const MAX_OFFSET = 10_000;
const FEED_LIMIT = 500;

type Lang = "en" | "ar";

// ---------- API shapes (only what is read) ----------

interface Rel {
  id: string;
  type: string;
  attributes?: { name?: string; fileName?: string };
}

interface MdManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles: Record<string, string>[];
    description: Record<string, string>;
    status: string;
    year: number | null;
    contentRating: string;
    originalLanguage: string;
    publicationDemographic: string | null;
    tags: { id: string; attributes: { name: Record<string, string>; group: string } }[];
    links: Record<string, string> | null;
    updatedAt: string;
  };
  relationships: Rel[];
}

interface MdChapter {
  id: string;
  attributes: {
    chapter: string | null;
    volume: string | null;
    title: string | null;
    translatedLanguage: string;
    externalUrl: string | null;
    publishAt: string;
    readableAt: string;
    pages: number;
  };
  relationships: Rel[];
}

interface List<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

// ---------- mapping ----------

const TYPE_BY_LANG: Record<string, MangaType> = { ja: "manga", ko: "manhwa", zh: "manhua", "zh-hk": "manhua" };
const STATUS: Record<string, Status> = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", cancelled: "cancelled" };
const RATING: Record<string, ContentRating> = { safe: "safe", suggestive: "suggestive", erotica: "nsfw", pornographic: "nsfw" };

function localized(map: Record<string, string> | undefined, lang: Lang) {
  if (!map) return undefined;
  return map[lang] ?? map.en ?? map["ja-ro"] ?? Object.values(map)[0];
}

function titleOf(m: MdManga, lang: Lang) {
  const a = m.attributes;
  const alt = (l: string) => a.altTitles.find((t) => t[l])?.[l];
  return a.title[lang] ?? alt(lang) ?? a.title.en ?? alt("en") ?? Object.values(a.title)[0] ?? "";
}

function coverOf(m: MdManga) {
  const file = m.relationships.find((r) => r.type === "cover_art")?.attributes?.fileName;
  return file ? `${COVERS}/${m.id}/${file}.512.jpg` : undefined;
}

function summary(m: MdManga, lang: Lang): MangaSummary {
  return {
    id: m.id,
    title: titleOf(m, lang),
    cover: coverOf(m),
    url: `${SITE}/title/${m.id}`,
    type: TYPE_BY_LANG[m.attributes.originalLanguage] ?? "other",
    status: STATUS[m.attributes.status] ?? "unknown",
    updatedAt: m.attributes.updatedAt,
    rating: RATING[m.attributes.contentRating],
  };
}

// ---------- filters ----------

const L = (en: string, ar: string): Text => ({ en, ar });

const SORTS: { value: string; label: Text }[] = [
  { value: "relevance", label: L("Best match", "الأكثر تطابقاً") },
  { value: "followedCount", label: L("Most followed", "الأكثر متابعة") },
  { value: "latestUploadedChapter", label: L("Latest chapter", "آخر فصل") },
  { value: "createdAt", label: L("Recently added", "أُضيفت حديثاً") },
  { value: "rating", label: L("Top rated", "الأعلى تقييماً") },
  { value: "title", label: L("Title", "العنوان") },
  { value: "year", label: L("Year", "السنة") },
];

async function filtersFor(ctx: Context): Promise<FilterDef[]> {
  const tags = await ctx.http.json<List<MdManga["attributes"]["tags"][number]>>(`${API}/manga/tag`, { cacheMs: 24 * 3_600_000 });
  const groups = ["genre", "theme", "format", "content"];
  const options = tags.data
    .filter((t) => groups.includes(t.attributes.group))
    .sort((a, b) => groups.indexOf(a.attributes.group) - groups.indexOf(b.attributes.group) || a.attributes.name.en.localeCompare(b.attributes.name.en))
    .map((t) => ({ value: t.id, label: t.attributes.name.en, genre: genreKey(t.attributes.name.en) }));

  return [
    { id: "sort", type: "sort", label: L("Sort by", "الترتيب"), options: SORTS, default: { value: "followedCount", dir: "desc" }, directions: true },
    { id: "tags", type: "tristate", label: L("Genres and themes", "التصنيفات"), options },
    {
      id: "type",
      type: "multi",
      label: L("Type", "النوع"),
      options: [
        { value: "ja", label: L("Manga", "مانغا") },
        { value: "ko", label: L("Manhwa", "مانهوا") },
        { value: "zh", label: L("Manhua", "مانهوا صينية") },
      ],
    },
    {
      id: "status",
      type: "multi",
      label: L("Status", "الحالة"),
      options: [
        { value: "ongoing", label: L("Ongoing", "مستمرة") },
        { value: "completed", label: L("Completed", "مكتملة") },
        { value: "hiatus", label: L("On hiatus", "متوقفة مؤقتاً") },
        { value: "cancelled", label: L("Cancelled", "ملغاة") },
      ],
    },
    {
      id: "demographic",
      type: "multi",
      label: L("Demographic", "الفئة"),
      options: [
        { value: "shounen", label: L("Shounen", "شونين") },
        { value: "shoujo", label: L("Shoujo", "شوجو") },
        { value: "seinen", label: L("Seinen", "سينين") },
        { value: "josei", label: L("Josei", "جوسي") },
      ],
    },
    {
      id: "rating",
      type: "multi",
      label: L("Content rating", "تصنيف المحتوى"),
      options: [
        { value: "safe", label: L("Safe", "آمن") },
        { value: "suggestive", label: L("Suggestive", "إيحائي") },
      ],
    },
  ];
}

const LISTING_SORT: Record<string, string> = {
  popular: "followedCount",
  latest: "latestUploadedChapter",
  new: "createdAt",
  top: "rating",
};

function query(lang: Lang, filters: FilterValues, sort: SortValue, page: number, title?: string) {
  const offset = (page - 1) * PER_PAGE;
  if (offset >= MAX_OFFSET) throw new SourceError("not-found", "MangaDex lists stop after 10,000 results");
  const tags = filters.tags as TristateValue | undefined;
  const types = (filters.type as string[] | undefined) ?? [];
  const ratings = ((filters.rating as string[] | undefined) ?? []).filter((r) => r === "safe" || r === "suggestive");
  return {
    limit: PER_PAGE,
    offset,
    title,
    "includes[]": ["cover_art"],
    "availableTranslatedLanguage[]": [lang],
    hasAvailableChapters: "true",
    "contentRating[]": ratings.length ? ratings : ["safe", "suggestive"],
    "includedTags[]": tags?.include,
    includedTagsMode: "AND",
    "excludedTags[]": tags?.exclude,
    excludedTagsMode: "OR",
    "status[]": filters.status as string[] | undefined,
    "publicationDemographic[]": filters.demographic as string[] | undefined,
    // manhua is published in Chinese, simplified or from Hong Kong
    "originalLanguage[]": types.flatMap((t) => (t === "zh" ? ["zh", "zh-hk"] : [t])),
    [`order[${sort.value}]`]: sort.dir,
  };
}

async function browse(ctx: Context, lang: Lang, q: ReturnType<typeof query>): Promise<Paged<MangaSummary>> {
  const res = await ctx.http.json<List<MdManga>>(`${API}/manga`, { query: q, cacheMs: 5 * 60_000 });
  return { items: res.data.map((m) => summary(m, lang)), hasNext: res.offset + res.limit < Math.min(res.total, MAX_OFFSET) };
}

// ---------- source ----------

function mangadex(lang: Lang): MangaSource {
  return defineSource({
    id: `mangadex-${lang}`,
    name: lang === "en" ? "MangaDex" : "MangaDex عربي",
    lang,
    baseUrl: SITE,
    icon: "https://mangadex.org/favicon.svg",
    rating: "suggestive",
    rateLimit: { requests: 4, perMs: 1000 },
    headers: { "User-Agent": "storm-sources/1.0 (+https://github.com/Hadore28/storm-sources)" },
    images: { noReferrer: true },
    // page links from MangaDex@Home stop working after about 15 minutes
    cache: { pages: 10 * 60_000 },
    listings: [
      { id: "popular", label: L("Popular", "الأكثر شعبية"), filters: true },
      { id: "latest", label: L("Latest updates", "آخر التحديثات"), filters: true },
      { id: "new", label: L("New", "جديدة"), filters: true },
      { id: "top", label: L("Top rated", "الأعلى تقييماً"), filters: true },
    ],
    filters: filtersFor,
    searchFilters: true,
    settings: [
      {
        id: "quality",
        type: "select",
        label: L("Image quality", "جودة الصور"),
        options: [
          { value: "data", label: L("Original", "الأصلية") },
          { value: "data-saver", label: L("Data saver", "موفّرة للبيانات") },
        ],
        default: "data",
      },
    ],

    async list(ctx, { listing, page, filters }) {
      const sort = (filters.sort as SortValue | undefined) ?? { value: LISTING_SORT[listing] ?? "followedCount", dir: "desc" as const };
      const q = query(lang, filters, sort.value === "relevance" ? { value: LISTING_SORT[listing], dir: "desc" } : sort, page);
      return browse(ctx, lang, q);
    },

    async search(ctx, { query: text, page, filters }) {
      const sort = (filters.sort as SortValue | undefined) ?? { value: "relevance", dir: "desc" as const };
      return browse(ctx, lang, query(lang, filters, sort, page, text));
    },

    async manga(ctx, id): Promise<MangaDetails> {
      const { data: m } = await ctx.http.json<{ data: MdManga }>(`${API}/manga/${id}`, {
        query: { "includes[]": ["cover_art", "author", "artist"] },
      });
      const a = m.attributes;
      const names = (type: string) => m.relationships.filter((r) => r.type === type).map((r) => r.attributes?.name ?? "");
      return {
        ...summary(m, lang),
        altTitles: [...a.altTitles.map((t) => Object.values(t)[0]), ...Object.values(a.title)],
        description: localized(a.description, lang)?.replace(/\n---[\s\S]*$/, ""),
        authors: names("author"),
        artists: names("artist"),
        genres: a.tags
          .filter((t) => t.attributes.group === "genre" || t.attributes.group === "theme")
          .map((t) => ({ name: t.attributes.name.en, key: genreKey(t.attributes.name.en) })),
        demographic: (a.publicationDemographic ?? undefined) as MangaDetails["demographic"],
        year: a.year ?? undefined,
        originalLang: a.originalLanguage,
        links: { anilist: a.links?.al, mal: a.links?.mal, mangaupdates: a.links?.mu, kitsu: a.links?.kt },
      };
    },

    async chapters(ctx, mangaId) {
      const out: Chapter[] = [];
      for (let offset = 0; ; offset += FEED_LIMIT) {
        const res = await ctx.http.json<List<MdChapter>>(`${API}/manga/${mangaId}/feed`, {
          query: {
            limit: FEED_LIMIT,
            offset,
            "translatedLanguage[]": [lang],
            "includes[]": ["scanlation_group"],
            "contentRating[]": ["safe", "suggestive", "erotica", "pornographic"],
            "order[volume]": "desc",
            "order[chapter]": "desc",
          },
        });
        for (const c of res.data) {
          const a = c.attributes;
          out.push({
            id: c.id,
            number: a.chapter ? chapterNumber(a.chapter) : undefined,
            volume: a.volume ? Number(a.volume) : undefined,
            title: a.title ?? undefined,
            lang: a.translatedLanguage,
            date: a.publishAt || a.readableAt,
            group: c.relationships.find((r) => r.type === "scanlation_group")?.attributes?.name,
            url: a.externalUrl ?? `${SITE}/chapter/${c.id}`,
            external: !!a.externalUrl,
            pages: a.pages || undefined,
          });
        }
        if (offset + FEED_LIMIT >= res.total || res.data.length === 0) break;
      }
      return out;
    },

    async pages(ctx, _mangaId, chapterId) {
      const res = await ctx.http.json<{ baseUrl: string; chapter: { hash: string; data: string[]; dataSaver: string[] } }>(
        `${API}/at-home/server/${chapterId}`,
      );
      const saver = ctx.settings.quality === "data-saver";
      const files = saver ? res.chapter.dataSaver : res.chapter.data;
      if (!files.length) throw new SourceError("not-found", "This chapter is hosted on an official site, not on MangaDex");
      return files.map((f) => ({ url: `${res.baseUrl}/${saver ? "data-saver" : "data"}/${res.chapter.hash}/${f}` }));
    },

    resolveUrl(url) {
      const m = url.match(/mangadex\.org\/(title|chapter)\/([0-9a-f-]{36})/);
      if (!m) return null;
      return m[1] === "title" ? { mangaId: m[2] } : { mangaId: "", chapterId: m[2] };
    },
  });
}

export default defineExtension({
  pkg: "storm.mangasto.mangadex",
  name: "MangaDex",
  version: "1.0.0",
  app: "mangasto",
  sources: [mangadex("en"), mangadex("ar")],
});
