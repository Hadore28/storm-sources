// Anime4up — Arabic-subtitled anime on a WordPress site. Plain HTML: cards for
// lists, a paged episode list per anime, and each episode's servers as frames.
// The domain moves from time to time, so the address is an admin setting.

import {
  SourceError,
  animeType,
  chapterNumber,
  clean,
  defineAnimeSource,
  defineExtension,
  demographic,
  genreKey,
  genreOptions,
  minutes,
  status,
  year,
  type AnimeSummary,
  type Context,
  type Doc,
  type Episode,
  type FilterValues,
  type Paged,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";

const DEFAULT_SITE = "https://w1.anime4up.rest";
const L = (en: string, ar: string): Text => ({ en, ar });

const GENRES = [
  "أطفال", "أكشن", "إيتشي", "اثارة", "العاب", "ايسيكاي", "بوليسي", "سباق", "طبي", "تاريخي", "جنون", "حربي", "حريم", "خارق للعادة", "خيال علمي", "دراما",
  "رعب", "رومانسي", "رياضي", "ساموراي", "سحر", "شريحة من الحياة", "شياطين", "غموض", "فضائي", "فنتازيا", "فنون قتالية",
  "قوى خارقة", "كوميدي", "محاكاة ساخرة", "مدرسي", "مصاصي دماء", "مغامرات", "موسيقي", "ميكا", "نفسي",
].map((name) => ({ id: name.replace(/\s+/g, "-"), name }));

const TYPES = [
  { value: "tv2", label: L("TV", "مسلسل") },
  { value: "movie-3", label: L("Movie", "فيلم") },
  { value: "ova1", label: L("OVA", "أوفا") },
  { value: "ona1", label: L("ONA", "أونا") },
  { value: "special1", label: L("Special", "خاصة") },
];

// The site files each anime under the season it aired: شتاء, ربيع, صيف, خريف.
const SEASONS = ["شتاء", "شتاء", "شتاء", "ربيع", "ربيع", "ربيع", "صيف", "صيف", "صيف", "خريف", "خريف", "خريف"];
const thisSeason = (now = new Date()) => `${SEASONS[now.getUTCMonth()]}-${now.getUTCFullYear()}`;

const site = (ctx: Context) => {
  const s = String(ctx.settings.address ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+$/i.test(s) ? s : DEFAULT_SITE;
};
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const slugAfter = (url: string | null | undefined, kind: "anime" | "episode") => {
  const m = url?.match(new RegExp(`/${kind}/([^/?#]+)`))?.[1];
  return m ? decode(m) : undefined;
};
const path = (ctx: Context, kind: "anime" | "episode", slug: string) => `${site(ctx)}/${kind}/${encodeURIComponent(slug)}/`;
// thumbnails carry a "-215x300" size; the original sits next to them
const fullSize = (src: string | null | undefined) => src?.replace(/-\d+x\d+(\.\w+)$/, "$1") || undefined;

function animeCards(ctx: Context, doc: Doc): AnimeSummary[] {
  return doc.all(".anime-card-container").flatMap((card): AnimeSummary[] => {
    const link = card.one(".anime-card-title h3 a") ?? card.one("a.overlay");
    const id = slugAfter(link?.href(), "anime");
    if (!id) return [];
    const img = card.one("img");
    return [
      {
        id,
        title: clean(card.one(".anime-card-title")?.attr("title")) || clean(link?.text()) || clean(img?.attr("alt")),
        cover: fullSize(img?.href("data-image") ?? img?.href("src")),
        url: path(ctx, "anime", id),
        type: animeType(card.one(".anime-card-type")?.text()),
        latestEpisode: chapterNumber(card.one(".ep_num")?.text()),
      },
    ];
  });
}

const hasNextPage = (doc: Doc) => !!doc.one(".pagination .next, a.next.page-numbers");

// Lists, taxonomy pages and search all print the same cards.
async function cards(ctx: Context, url: string): Promise<Paged<AnimeSummary>> {
  const doc = await ctx.http.doc(url);
  return { items: animeCards(ctx, doc), hasNext: hasNextPage(doc) };
}

function taxonomy(filters: FilterValues): string | null {
  const pick = (id: string) => (typeof filters[id] === "string" && filters[id] ? String(filters[id]) : "");
  if (pick("genre")) return `anime-genre/${encodeURIComponent(pick("genre"))}`;
  if (pick("type")) return `anime-type/${encodeURIComponent(pick("type"))}`;
  return null;
}

const series = (ctx: Context, id: string, page = 1) =>
  ctx.http.doc(`${path(ctx, "anime", id)}${page > 1 ? `page/${page}/` : ""}`, { query: { ep_order: "asc" }, cacheMs: 10 * 60_000 });

function episodeCards(doc: Doc): Episode[] {
  return doc.all("#episodesList .anime-card-container").flatMap((card): Episode[] => {
    const a = card.one(".ep_num a") ?? card.one("a.overlay");
    const id = slugAfter(a?.href(), "episode");
    if (!id || !a) return [];
    return [{ id, number: chapterNumber(a.text()) ?? chapterNumber(id), title: clean(a.text()) || undefined, url: a.href() ?? undefined }];
  });
}

const anime4up = defineAnimeSource({
  id: "anime4up",
  name: "Anime4up",
  lang: "ar",
  baseUrl: DEFAULT_SITE,
  rateLimit: { requests: 3, perMs: 1000 },
  cache: { episodes: 20 * 60_000 },
  settings: [
    {
      id: "address",
      type: "text",
      label: L("Address", "العنوان"),
      description: L("Anime4up moves to a new address now and then; put the new one here.", "ينتقل أنمي فور أب إلى عنوان جديد بين حين وآخر؛ ضع العنوان الجديد هنا."),
      default: DEFAULT_SITE,
    },
  ],
  listings: [
    { id: "episodes", label: L("New episodes", "أحدث الحلقات") },
    { id: "latest", label: L("Recently added", "أُضيفت حديثاً"), filters: true },
    { id: "season", label: L("This season", "أنميات هذا الموسم") },
    { id: "movies", label: L("Movies", "أفلام") },
  ],
  filters: [
    { id: "genre", type: "select", label: L("Genre", "التصنيف"), options: genreOptions(GENRES) },
    { id: "type", type: "select", label: L("Type", "النوع"), options: TYPES },
  ],

  async list(ctx, { listing, page, filters }) {
    const base = site(ctx);
    const paged = (p: string) => `${base}/${p}/${page > 1 ? `page/${page}/` : ""}`;
    if (listing === "episodes") {
      const res = await cards(ctx, paged("episode"));
      // one entry per anime, however many of its episodes are new
      const seen = new Set<string>();
      return { items: res.items.filter((a) => !seen.has(a.id) && seen.add(a.id)), hasNext: res.hasNext };
    }
    if (listing === "season") return cards(ctx, `${base}/anime-season/${encodeURIComponent(thisSeason())}/${page > 1 ? `?page=${page}` : ""}`);
    if (listing === "movies") return cards(ctx, `${base}/anime-type/movie-3/${page > 1 ? `?page=${page}` : ""}`);
    const tax = taxonomy(filters);
    // taxonomy pages page with ?page=N, the main list with /page/N/
    if (tax) return cards(ctx, `${base}/${tax}/${page > 1 ? `?page=${page}` : ""}`);
    return cards(ctx, paged(encodeURIComponent("قائمة-الانمي")));
  },

  async search(ctx, { query, page }) {
    const base = site(ctx);
    return cards(ctx, `${base}/${page > 1 ? `page/${page}/` : ""}?search_param=animes&s=${encodeURIComponent(query)}`);
  },

  async details(ctx, id) {
    const doc = await series(ctx, id);
    const title = clean(doc.one("h1.anime-details-title")?.text());
    if (!title) throw new SourceError("not-found", `Anime4up has no anime "${id}"`);
    const info = new Map(
      doc.all(".anime-info").map((el) => {
        const [k, ...v] = clean(el.text()).split(":");
        return [clean(k), clean(v.join(":"))];
      }),
    );
    const field = (word: string) => [...info.entries()].find(([k]) => k.includes(word))?.[1] ?? "";
    const tags = doc.all("ul.anime-genres a").map((a) => clean(a.text())).filter(Boolean);
    const img = doc.one("img.thumbnail") ?? doc.one(".anime-thumbnail img");
    const story = clean(doc.one("p.anime-story")?.text());
    const mal = doc.one("a.anime-mal")?.href()?.match(/myanimelist\.net\/anime\/(\d+)/)?.[1];
    const count = Number(field("عدد الحلقات"));
    return {
      id,
      title,
      url: path(ctx, "anime", id),
      cover: fullSize(img?.href("src") ?? img?.href("data-image")),
      type: animeType(field("نوع")),
      status: status(field("حالة")),
      year: year(field("بداية العرض")),
      altTitles: [],
      description: story.replace(/^قصة\s+(?:انمي|فيلم)\s+/, "") || undefined,
      genres: tags.filter((g) => !demographic(g)).map((name) => ({ name, key: genreKey(name) })),
      studios: field("الاستوديو") ? field("الاستوديو").split(/[,،]/).map(clean).filter(Boolean) : [],
      season: field("الموسم") || undefined,
      episodeCount: Number.isInteger(count) && count > 0 ? count : undefined,
      duration: minutes(field("مدة")),
      links: mal ? { mal } : undefined,
    };
  },

  async episodes(ctx, id) {
    const first = await series(ctx, id);
    const pages = Math.min(Number(first.one(".episodes-load-more")?.attr("data-max-pages")) || 1, 60);
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => series(ctx, id, i + 2)));
    const all = [first, ...rest].flatMap(episodeCards);
    // a film has no episode list, only its watch link
    if (!all.length) {
      const watch = slugAfter(first.one("a.anime-first-ep")?.href(), "episode");
      if (watch) return [{ id: watch, number: 1 }];
    }
    return all;
  },

  async servers(ctx, _animeId, episodeId) {
    const doc = await ctx.http.doc(path(ctx, "episode", episodeId));
    const out: VideoServer[] = doc.all("#episode-servers li[data-watch]").flatMap((li): VideoServer[] => {
      const url = li.href("data-watch");
      if (!url) return [];
      const quality = clean(li.one(".quality")?.text());
      return [{ name: clean(li.one(".watch-server-name")?.text()) || new URL(url).host, url, kind: "embed", quality: quality === "متعدد الجودات" ? undefined : quality || undefined, audio: "sub", lang: "ar" }];
    });
    for (const row of doc.all("#download tr")) {
      const url = row.one("td.td-link a")?.href();
      if (!url) continue;
      const q = clean(row.one(".td-quality")?.text());
      out.push({ name: clean(row.one(".server-name")?.text()) || new URL(url).host, url, kind: "embed", quality: q.match(/FHD|HD|SD/i)?.[0].toUpperCase() ?? (q || undefined), download: true });
    }
    return out;
  },
});

export default defineExtension({
  pkg: "storm.anisto.anime4up",
  name: "Anime4up",
  version: "1.0.0",
  app: "anisto",
  sources: [anime4up],
});
