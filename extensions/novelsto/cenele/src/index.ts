// Cenele (فضاء الروايات) — Arabic translated web novels. Lists, details and
// chapter lists come from the JSON API its app uses; the chapter text endpoint
// needs the app's signature, so text is read from the public chapter page.

import {
  SourceError,
  chapterNumber,
  clean,
  defineExtension,
  defineNovelSource,
  genreKey,
  genreOptions,
  htmlToBlocks,
  parseDate,
  status,
  type Chapter,
  type Context,
  type FilterValues,
  type NovelDetails,
  type NovelSummary,
  type Paged,
  type Text,
} from "@storm-sources/sdk";

const SITE = "https://cenele.com";
const API = `${SITE}/wp-json/nhv/v1`;
const PER_PAGE = 24;
const CHAPTER_PAGE = 300;
const L = (en: string, ar: string): Text => ({ en, ar });

interface CnGenre {
  name: string;
  slug: string;
}
interface CnNovel {
  id: number;
  title: string;
  slug: string;
  cover?: string;
  permalink?: string;
  genres?: CnGenre[];
  type?: string;
  status?: string;
  chapters_count?: number;
  summary?: string;
  alternative?: string;
  authors?: { name: string }[];
  translators?: { name: string }[];
  reader?: { type?: string };
}
interface CnChapter {
  chapter_id: number;
  chapter_slug: string;
  chapter_name: string;
  chapter_name_extend?: string;
  date?: string;
  volume_name?: string;
  volume_slug?: string;
}
type Envelope<T> = { success: boolean; data: T };

// The site's genres; the API has no list of them.
const GENRES: { id: string; name: string }[] = [
  ["أكشن", "أكشن"], ["فانتازيا", "فانتازيا"], ["فنون-قتالية", "فنون قتالية"], ["قوى-خارقة", "قوى خارقة"], ["غموض", "غموض"],
  ["مغامرة", "مغامرة"], ["دراما", "دراما"], ["بالغ", "بالغ"], ["مأساة", "مأساة"], ["رومانسية", "رومانسية"], ["نفسي", "نفسي"],
  ["كوميديا", "كوميديا"], ["رعب", "رعب"], ["انتقام", "انتقام"], ["خيال-علمي", "خيال علمي"], ["xuanhuan", "شوانهوان"],
  ["حريم", "حريم"], ["عسكري", "عسكري"], ["حياة-يومية", "حياة يومية"], ["xianxia", "زيانشيا"], ["تاريخي", "تاريخي"],
  ["سحر", "سحر"], ["نهاية-العالم", "نهاية العالم"], ["مدرسي", "مدرسي"], ["مظلمة", "مظلمة"], ["أيتشي", "أيتشي"],
  ["بوليسي", "بوليسي"], ["مصاصي-دماء", "مصاصي دماء"], ["رياضي", "رياضي"],
].map(([id, name]) => ({ id, name }));

const ORIGIN: [RegExp, string][] = [
  [/صين/, "zh"],
  [/كوري/, "ko"],
  [/يابان/, "ja"],
  [/انجليز|إنجليز/, "en"],
];

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const isText = (n: CnNovel) => !n.reader?.type || n.reader.type === "text";
const statusOf = (s?: string) => (s === "end" || s === "completed" ? "completed" : s === "on-going" ? "ongoing" : s === "on-hold" ? "hiatus" : s ? status(s) : undefined);

async function api<T>(ctx: Context, path: string, query?: Record<string, string | number>, cacheMs?: number): Promise<T> {
  const d = await ctx.http.json<Envelope<T>>(`${API}${path}`, { query, cacheMs, headers: { Accept: "application/json" } });
  if (!d?.success) throw new SourceError("changed", `Cenele's API refused ${path}`);
  return d.data;
}

const summary = (n: CnNovel): NovelSummary => ({
  id: String(n.id),
  title: clean(n.title),
  cover: n.cover,
  url: n.permalink,
  status: statusOf(n.status),
  latestChapter: n.chapters_count || undefined,
});

async function library(ctx: Context, page: number, query: Record<string, string>, filters: FilterValues): Promise<Paged<NovelSummary>> {
  const genre = typeof filters.genre === "string" ? filters.genre : "";
  const d = await api<{ items: CnNovel[]; total_pages: number }>(ctx, "/library", { per_page: PER_PAGE, page, ...query, ...(genre ? { genre } : {}) });
  // a few entries are comics, whose chapters are images
  return { items: d.items.filter(isText).map(summary), hasNext: page < d.total_pages };
}

const novel = (ctx: Context, id: string) => {
  if (!/^\d+$/.test(id)) throw new SourceError("not-found", `Cenele has no novel "${id}"`);
  return api<CnNovel>(ctx, `/novels/${id}`, undefined, 10 * 60_000);
};

const cenele = defineNovelSource({
  id: "cenele",
  name: "Cenele",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 3, perMs: 1000 },
  listings: [
    { id: "latest", label: L("Latest updates", "آخر التحديثات"), filters: true },
    { id: "views", label: L("Most read", "الأكثر قراءة"), filters: true },
    { id: "rating", label: L("Top rated", "الأعلى تقييماً"), filters: true },
    { id: "az", label: L("A–Z", "أبجدياً"), filters: true },
  ],
  filters: [{ id: "genre", type: "select", label: L("Genre", "التصنيف"), options: genreOptions(GENRES) }],
  searchFilters: true,

  list(ctx, { listing, page, filters }) {
    const orderby = listing === "az" ? "alphabet" : listing === "views" || listing === "rating" ? listing : "latest";
    return library(ctx, page, { orderby, order: orderby === "alphabet" ? "asc" : "desc" }, filters);
  },

  search: (ctx, { query, page, filters }) => library(ctx, page, { s: query }, filters),

  async details(ctx, id): Promise<NovelDetails> {
    const n = await novel(ctx, id);
    if (!isText(n)) throw new SourceError("unsupported", "This is a comic, read with images");
    const title = clean(n.title);
    const tags = (n.genres ?? []).map((g) => clean(g.name)).filter(Boolean);
    // the summary opens with "رواية <title>" and sometimes "[نبذة]"
    const description = clean(n.summary)
      .replace(new RegExp(`^رواية\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "")
      .replace(/^\[?\s*نبذة\s*\]?\s*:?\s*/, "");
    const names = (list?: { name: string }[]) => (list ?? []).map((x) => clean(x.name).replace(/^المترجم\s*:\s*/, "").replace(/^\[|\]$/g, "")).filter(Boolean);
    return {
      ...summary(n),
      title,
      status: statusOf(n.status) ?? (tags.includes("مكتملة") ? "completed" : undefined),
      altTitles: [clean(n.alternative).replace(/^رواية\s*/, "")].filter(Boolean),
      description: description || undefined,
      authors: names(n.authors),
      translators: names(n.translators),
      genres: tags.filter((g) => !/^(مكتملة|مانهوا|مانجا|مانها|وان شوت|شونين|شوجو|جوسي|سنين)$/.test(g)).map((name) => ({ name, key: genreKey(name) })),
      originalLang: ORIGIN.find(([re]) => re.test(n.type ?? ""))?.[1],
      chapterCount: n.chapters_count || undefined,
    };
  },

  async chapters(ctx, id) {
    const page = (p: number) => api<{ chapters: CnChapter[]; total_pages: number }>(ctx, `/novels/${id}/chapters`, { order: "desc", per_page: CHAPTER_PAGE, page: p });
    const first = await page(1);
    const rest = await Promise.all(Array.from({ length: Math.min(Math.max(0, first.total_pages - 1), 60) }, (_, i) => page(i + 2)));
    const permalink = (await novel(ctx, id)).permalink ?? "";
    return [first, ...rest].flatMap((p) => p.chapters).map(
      (c): Chapter => {
        const path = [c.volume_slug, c.chapter_slug].filter(Boolean).map((s) => decode(s!)).join("/");
        const volume = c.volume_name?.match(/\d+/)?.[0];
        return {
          id: path,
          number: chapterNumber(c.chapter_name),
          volume: volume ? Number(volume) : undefined,
          title: clean(c.chapter_name_extend) || undefined,
          lang: "ar",
          date: parseDate(c.date),
          url: permalink ? `${permalink}${path.split("/").map(encodeURIComponent).join("/")}/` : undefined,
        };
      },
    );
  },

  async content(ctx, novelId, chapterId) {
    const n = await novel(ctx, novelId);
    if (!n.permalink) throw new SourceError("changed", "Cenele novel has no address");
    const doc = await ctx.http.doc(`${n.permalink}${chapterId.split("/").map(encodeURIComponent).join("/")}/`);
    const body = doc.one(".reading-content.current") ?? doc.one(".reading-content");
    if (!body) throw new SourceError("changed", "Cenele chapter page has no text");
    // What the site's own script hides: its header, promos, and decoys planted for scrapers.
    const text = body.without(".nhv-reading-chapter-head", ".nhv-reader-promo", ".nhv-reader-store-promo", "[inert]", "[data-nosnippet]", "[aria-hidden='true']", "aside", "input");
    const blocks = htmlToBlocks(text.html(), SITE).filter((b) => !("text" in b) || !(b.text.includes("بعض التطبيقات تعرض") && b.text.includes("المصدر")));
    return { title: clean(body.one(".chapter-name")?.text()) || undefined, blocks };
  },
});

export default defineExtension({
  pkg: "storm.novelsto.cenele",
  name: "Cenele",
  version: "1.0.0",
  app: "novelsto",
  sources: [cenele],
});
