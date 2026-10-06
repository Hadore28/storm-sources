// Ares Manga (fl-ares.com) — an Arabic Next.js site. Lists come from its catalog
// API; series and chapters are read from the data each page is rendered with.

import {
  SourceError,
  clean,
  defineExtension,
  defineSource,
  demographic,
  genreKey,
  genreOptions,
  type Chapter,
  type Context,
  type FilterValues,
  type MangaSummary,
  type MangaType,
  type Option,
  type Paged,
  type Status,
  type Text,
  type TristateValue,
} from "@storm-sources/sdk";

const SITE = "https://fl-ares.com";

const L = (en: string, ar: string): Text => ({ en, ar });

interface Item {
  id: number;
  title: string;
  slug: string;
  poster: string | null;
  type: string;
  genres?: string[];
  _count?: { chapters: number };
}

interface AresChapter {
  id: number;
  number: number | null;
  title: string | null;
  createdAt: string;
  translator?: string | null;
  isLocked?: boolean;
  lockedUntil?: string | null;
}

interface AresManga {
  slug: string;
  title: string;
  description?: string;
  genres?: string[];
  genreLabels?: Record<string, string>;
  author?: string;
  artist?: string;
  status?: string;
  altNames?: string[];
  chapters?: AresChapter[];
}

const TYPE: Record<string, MangaType> = { Manga: "manga", Manhwa: "manhwa", Manhua: "manhua", "One-shot": "manga", Comics: "comic" };
const STATUS: Record<string, Status> = { Ongoing: "ongoing", Completed: "completed", Hiatus: "hiatus", Cancelled: "cancelled", Announced: "ongoing" };
const SORT: Record<string, string> = { latest: "updated_at", popular: "votes", rated: "rating", longest: "chapters" };

// genres storm has no key for still get a filter option, so every genre on a series can be opened
const OWN_GENRES: Record<string, Text> = {
  Shounen: L("Shounen", "شونين"),
  Shoujo: L("Shoujo", "شوجو"),
  Seinen: L("Seinen", "سينين"),
  Josei: L("Josei", "جوسي"),
  Doujinshi: L("Doujinshi", "دوجينشي"),
};

const seriesUrl = (slug: string) => `${SITE}/manga/${slug}`;

function summary(i: Item): MangaSummary {
  return {
    id: i.slug,
    title: i.title,
    cover: i.poster ?? undefined,
    url: seriesUrl(i.slug),
    type: TYPE[i.type] ?? "other",
  };
}

/** The data a Next.js page was rendered with, as one string. */
function flight(html: string) {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) out += JSON.parse(`"${m[1]}"`);
  return out;
}

/** The JSON object in `text` that holds `marker`. */
function objectWith<T>(text: string, marker: string): T | null {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  let start = -1;
  for (let i = at, depth = 0; i >= 0; i--) {
    if (text[i] === "}") depth++;
    else if (text[i] === "{" && depth-- === 0) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  for (let i = start, depth = 0, str = false; i < text.length; i++) {
    const c = text[i];
    if (str) {
      if (c === "\\") i++;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function linkedData(html: string) {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/g)) {
    try {
      const v = JSON.parse(m[1]);
      out.push(...(Array.isArray(v) ? v : [v]));
    } catch {
      continue;
    }
  }
  return out;
}

const when = (d: string) => d.replace(/^\$D/, "");

async function catalog(ctx: Context, page: number, filters: FilterValues, sort: string, q = ""): Promise<Paged<MangaSummary>> {
  const genre = filters.genre as TristateValue | undefined;
  const res = await ctx.http.json<{ items: Item[]; hasMore: boolean }>(`${SITE}/api/catalog`, {
    query: {
      q: q || undefined,
      sort: q ? undefined : sort,
      order: q ? undefined : "desc",
      page,
      genre: genre?.include,
      excludeGenre: genre?.exclude,
      type: filters.type as string[] | undefined,
      excludeType: (filters.type as string[] | undefined)?.length ? undefined : "Novel",
      status: filters.status as string[] | undefined,
    },
    cacheMs: 5 * 60_000,
  });
  return { items: res.items.filter((i) => i.type !== "Novel").map(summary), hasNext: res.hasMore };
}

const ares = defineSource({
  id: "ares",
  name: "Ares Manga",
  lang: "ar",
  baseUrl: SITE,
  icon: `${SITE}/apple-icon.png`,
  rateLimit: { requests: 3, perMs: 1000 },
  headers: { Referer: `${SITE}/` },
  images: { proxy: true },
  listings: [
    { id: "latest", label: L("Latest updates", "آخر التحديثات"), filters: true },
    { id: "popular", label: L("Most voted", "الأكثر تصويتاً"), filters: true },
    { id: "rated", label: L("Top rated", "الأعلى تقييماً"), filters: true },
    { id: "longest", label: L("Most chapters", "الأكثر فصولاً"), filters: true },
  ],
  async filters(ctx) {
    const meta = await ctx.http.json<{ genres: string[] }>(`${SITE}/api/meta/options`, { cacheMs: 24 * 3_600_000 });
    const known = genreOptions(meta.genres.map((g) => ({ id: g, name: g })));
    const own: Option[] = meta.genres.filter((g) => !genreKey(g)).map((g) => ({ value: g, label: OWN_GENRES[g] ?? g }));
    return [
      { id: "genre", type: "tristate", label: L("Genres", "التصنيفات"), options: [...known, ...own] },
      {
        id: "type",
        type: "multi",
        label: L("Type", "النوع"),
        options: [
          { value: "Manhwa", label: L("Manhwa", "مانهوا") },
          { value: "Manhua", label: L("Manhua", "مانها") },
          { value: "Manga", label: L("Manga", "مانغا") },
          { value: "One-shot", label: L("One-shot", "قصة قصيرة") },
        ],
      },
      {
        id: "status",
        type: "multi",
        label: L("Status", "الحالة"),
        options: [
          { value: "Ongoing", label: L("Ongoing", "مستمرة") },
          { value: "Completed", label: L("Completed", "مكتملة") },
          { value: "Hiatus", label: L("On hiatus", "متوقفة مؤقتاً") },
          { value: "Cancelled", label: L("Cancelled", "ملغاة") },
        ],
      },
    ];
  },
  searchFilters: true,

  list: (ctx, { listing, page, filters }) => catalog(ctx, page, filters, SORT[listing] ?? SORT.latest),
  // the catalog only matches Latin titles
  search: (ctx, { query, page, filters }) =>
    /[a-z0-9]/i.test(query) ? catalog(ctx, page, filters, SORT.latest, query) : Promise.resolve({ items: [], hasNext: false }),

  async manga(ctx, slug) {
    const html = await ctx.http.text(seriesUrl(slug), { cacheMs: 5 * 60_000 });
    const m = objectWith<AresManga>(flight(html), '"chCount":');
    if (!m?.title) throw new SourceError("changed", `Ares Manga's page for "${slug}" has no series data`);
    const ld = linkedData(html);
    const book = ld.find((x) => x["@type"] === "Book") as { image?: string; datePublished?: string } | undefined;
    const crumbs = ld.find((x) => x["@type"] === "BreadcrumbList") as { itemListElement?: { position: number; name: string }[] } | undefined;
    const kind = crumbs?.itemListElement?.find((c) => c.position === 2)?.name ?? "";
    if (kind === "Novel") throw new SourceError("not-found", `${m.title} is a novel`);
    const year = Number(book?.datePublished?.slice(0, 4));
    const genres = m.genres ?? [];
    return {
      id: slug,
      title: m.title,
      cover: book?.image,
      url: seriesUrl(slug),
      type: TYPE[kind] ?? "other",
      status: STATUS[m.status ?? ""] ?? "unknown",
      altTitles: (m.altNames ?? []).map(clean).filter(Boolean),
      description: m.description ? clean(m.description) : undefined,
      authors: m.author ? [m.author] : [],
      artists: m.artist ? [m.artist] : [],
      genres: genres.map((g) => ({ name: m.genreLabels?.[g] ?? g, key: genreKey(g) })),
      demographic: genres.map((g) => demographic(g)).find(Boolean),
      year: Number.isInteger(year) && year > 1900 ? year : undefined,
    };
  },

  async chapters(ctx, slug) {
    const html = await ctx.http.text(seriesUrl(slug), { cacheMs: 5 * 60_000 });
    const m = objectWith<AresManga>(flight(html), '"chCount":');
    if (!Array.isArray(m?.chapters)) throw new SourceError("changed", "Ares Manga's chapter list is missing");
    const seen = new Set<string>();
    return m.chapters.flatMap((c): Chapter[] => {
      const id = String(c.number ?? c.id);
      if (seen.has(id)) return [];
      seen.add(id);
      return [
        {
          id,
          number: c.number ?? undefined,
          title: c.title ?? undefined,
          lang: "ar",
          date: when(c.createdAt),
          group: c.translator || undefined,
          url: `${seriesUrl(slug)}/chapter/${id}`,
          // early-access and paid chapters can only be read on Ares
          external: !!c.isLocked,
        },
      ];
    });
  },

  async pages(ctx, slug, chapterId) {
    const html = await ctx.http.text(`${seriesUrl(slug)}/chapter/${chapterId}`);
    const c = objectWith<{ pages?: string[] }>(flight(html), '"pages":[');
    if (!c?.pages?.length) throw new SourceError("unsupported", "This chapter can only be read on Ares Manga");
    return c.pages.map((url) => ({ url }));
  },

  resolveUrl(url) {
    const m = url.match(/fl-ares\.com\/manga\/([^/?#]+)(?:\/chapter\/([^/?#]+))?/);
    return m ? { mangaId: m[1], chapterId: m[2] } : null;
  },
});

export default defineExtension({
  pkg: "storm.mangasto.ares",
  name: "Ares Manga",
  version: "1.0.1",
  app: "mangasto",
  sources: [ares],
});
