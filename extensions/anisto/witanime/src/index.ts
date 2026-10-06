// WitAnime — Arabic-subtitled anime, on its new site (witanime.site; the old
// domains only show a landing page now). Pages are server-rendered with JSON-LD.
// Servers come from a per-visit manifest: each one is unlocked, then its gate
// redirects to the real player, which is what storm shows.

import {
  SourceError,
  animeType,
  clean,
  defineAnimeSource,
  defineExtension,
  demographic,
  genreKey,
  minutes,
  status,
  year,
  type AnimeDetails,
  type AnimeSummary,
  type Context,
  type Doc,
  type Episode,
  type FilterValues,
  type Paged,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";

const SITE = "https://witanime.site";
const L = (en: string, ar: string): Text => ({ en, ar });

const GENRES: [string, string, string][] = [
  ["action", "Action", "أكشن"], ["adventure", "Adventure", "مغامرة"], ["comedy", "Comedy", "كوميديا"], ["drama", "Drama", "دراما"],
  ["fantasy", "Fantasy", "خيال"], ["sci-fi", "Sci-fi", "خيال علمي"], ["romance", "Romance", "رومانسي"], ["mystery", "Mystery", "غموض"],
  ["horror", "Horror", "رعب"], ["supernatural", "Supernatural", "خارق للطبيعة"], ["super-power", "Super power", "قوى خارقة"],
  ["slice-of-life", "Slice of life", "شريحة من الحياة"], ["school", "School", "مدرسي"], ["sports", "Sports", "رياضي"],
  ["psychological", "Psychological", "نفسي"], ["suspense", "Suspense", "تشويق"], ["historical", "Historical", "تاريخي"],
  ["isekai", "Isekai", "إيسكاي"], ["reincarnation", "Reincarnation", "تناسخ"], ["time-travel", "Time travel", "السفر عبر الزمن"],
  ["martial-arts", "Martial arts", "فنون قتالية"], ["military", "Military", "عسكري"], ["mecha", "Mecha", "ميكا"], ["music", "Music", "موسيقى"],
  ["magic", "Magic", "سحر"], ["harem", "Harem", "حريم"], ["reverse-harem", "Reverse harem", "حريم عكسي"], ["vampire", "Vampires", "مصاصي الدماء"],
  ["zombies", "Zombies", "زومبي"], ["gore", "Gore", "دموي"], ["survival", "Survival", "بقاء"], ["post-apocalyptic", "Post-apocalyptic", "ما بعد نهاية العالم"],
  ["detective", "Detective", "تحري"], ["video-game", "Video games", "لعبة فيديو"], ["workplace", "Workplace", "مهني"], ["medical", "Medical", "طبي"],
  ["gourmet", "Gourmet", "طعام راقي"], ["samurai", "Samurai", "ساموراي"], ["space", "Space", "فضاء"], ["mythology", "Mythology", "أساطير"],
  ["parody", "Parody", "ساخر"], ["kids", "Kids", "أطفال"], ["mahou-shoujo", "Magical girls", "فتيات سحرية"], ["ecchi", "Ecchi", "إيتشي"],
  ["strategy-game", "Strategy", "استراتيجي"], ["avant-garde", "Avant-garde", "الخارج عن المألوف"], ["educational", "Educational", "تعليمي"],
  ["combat-sports", "Combat sports", "رياضات قتالية"], ["soccer", "Soccer", "كرة قدم"], ["basketball", "Basketball", "كرة السلة"],
  ["volleyball", "Volleyball", "كرة الطائرة"], ["baseball", "Baseball", "بيسبول"], ["tennis", "Tennis", "تنس"], ["badminton", "Badminton", "كرة الريشة"],
  ["motorsport", "Motorsport", "رياضة السيارات"], ["archery", "Archery", "رماية بالقوس"], ["performing-arts", "Performing arts", "فنون الأداء"],
  ["visual-arts", "Visual arts", "فنون بصرية"], ["pets", "Pets", "حيوانات أليفة"], ["cats", "Cats", "قطط"],
];

const TYPES = [
  { value: "TV", label: L("TV", "مسلسل") },
  { value: "TV Short", label: L("TV short", "حلقات قصيرة") },
  { value: "OVA", label: L("OVA", "أوفا") },
  { value: "ONA", label: L("ONA", "أونا") },
  { value: "Special", label: L("Special", "خاصة") },
  { value: "Music", label: L("Music", "موسيقى") },
];

const STATUSES = [
  { value: "ongoing", label: L("Airing", "مستمر") },
  { value: "completed", label: L("Finished", "مكتمل") },
  { value: "upcoming", label: L("Upcoming", "قادم") },
];

const SEASONS = ["winter", "winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall"];
const YEARS = Array.from({ length: new Date().getUTCFullYear() - 1977 }, (_, i) => String(new Date().getUTCFullYear() - i));

const isMovie = (id: string) => id.startsWith("movie/");
const pageUrl = (id: string) => (isMovie(id) ? `${SITE}/${id}` : `${SITE}/anime/${id}`);
const idFrom = (href: string | null | undefined) => {
  const m = href?.match(/\/(anime|movie|watch)\/([^/?#]+)(?:\/([^/?#]+))?/);
  if (!m) return undefined;
  if (m[1] === "movie") return `movie/${m[2]}`;
  if (m[1] === "watch") return m[2] === "movie" && m[3] ? `movie/${m[3]}` : m[2];
  return m[2];
};

function cards(doc: Doc): AnimeSummary[] {
  return doc.all("a[href]").flatMap((a): AnimeSummary[] => {
    const href = a.href();
    const title = clean(a.one("h3")?.text());
    const img = a.one("img");
    if (!href || !title || !img || !/\/(anime|movie|watch)\//.test(href)) return [];
    const id = idFrom(href);
    if (!id) return [];
    const episode = /\/watch\/(?!movie\/)[^/]+\/(\d+)/.exec(href)?.[1];
    return [{ id, title, cover: img.href("src") ?? undefined, url: pageUrl(id), type: isMovie(id) ? "movie" : undefined, latestEpisode: episode ? Number(episode) : undefined }];
  });
}

const unique = (items: AnimeSummary[]) => {
  const seen = new Set<string>();
  return items.filter((a) => !seen.has(a.id) && seen.add(a.id));
};

async function browse(ctx: Context, page: number, query: Record<string, string | undefined>): Promise<Paged<AnimeSummary>> {
  const doc = await ctx.http.doc(`${SITE}/browse${page > 1 ? `/page/${page}` : ""}`, { query });
  // pages are links without filters, and buttons with them
  const html = doc.html();
  const next = html.includes(`gotoPage(${page + 1})`) || html.includes(`/browse/page/${page + 1}`);
  return { items: unique(cards(doc)), hasNext: next };
}

function filterQuery(filters: FilterValues): Record<string, string | undefined> {
  const pick = (id: string) => (typeof filters[id] === "string" && filters[id] ? String(filters[id]) : undefined);
  return { "genres[0]": pick("genre"), type: pick("type"), status: pick("status"), year: pick("year") };
}

// The value next to a label in the facts box: <span>المدة</span><p>24 دقيقة</p>
const fact = (html: string, label: string) => clean(html.match(new RegExp(`<span[^>]*>\\s*${label}\\s*</span>\\s*<p[^>]*>([\\s\\S]*?)</p>`))?.[1]?.replace(/<[^>]+>/g, " "));

function jsonLd(doc: Doc): Record<string, unknown> | undefined {
  for (const s of doc.all("script[type='application/ld+json']")) {
    try {
      const o = JSON.parse(s.html());
      if (o?.["@type"] === "TVSeries" || o?.["@type"] === "Movie") return o;
    } catch {
      // another block
    }
  }
  return undefined;
}

const witanime = defineAnimeSource({
  id: "witanime",
  name: "WitAnime",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 6, perMs: 1000 },
  listings: [
    { id: "episodes", label: L("New episodes", "أحدث الحلقات") },
    { id: "popular", label: L("Most watched", "الأكثر مشاهدة"), filters: true },
    { id: "season", label: L("This season", "أنميات هذا الموسم") },
    { id: "top", label: L("Top rated", "الأعلى تقييماً"), filters: true },
    { id: "movies", label: L("Movies", "أفلام") },
    { id: "az", label: L("A–Z", "أبجدياً"), filters: true },
  ],
  filters: [
    { id: "genre", type: "select", label: L("Genre", "التصنيف"), options: GENRES.map(([value, en, ar]) => ({ value, label: L(en, ar), genre: genreKey(ar) ?? genreKey(en) })) },
    { id: "type", type: "select", label: L("Type", "النوع"), options: TYPES },
    { id: "status", type: "select", label: L("Status", "الحالة"), options: STATUSES },
    { id: "year", type: "select", label: L("Year", "السنة"), options: YEARS.map((y) => ({ value: y, label: y })) },
  ],
  searchFilters: true,

  async list(ctx, { listing, page, filters }) {
    if (listing === "episodes") {
      const doc = await ctx.http.doc(SITE, { cacheMs: 5 * 60_000 });
      // the home page's "latest episodes" row
      const html = doc.html();
      const start = html.indexOf("أحدث الحلقات");
      const end = start < 0 ? -1 : html.indexOf("<h2", start);
      const part = start < 0 ? "" : html.slice(start, end > start ? end : undefined);
      return { items: page === 1 ? unique(cards(ctx.html(part, SITE))) : [], hasNext: false };
    }
    if (listing === "movies") {
      const doc = await ctx.http.doc(`${SITE}/movies${page > 1 ? `/page/${page}` : ""}`, { query: { sort: "Most Viewed" } });
      const html = doc.html();
      const next = html.includes(`gotoPage(${page + 1})`) || html.includes(`/movies/page/${page + 1}`);
      return { items: unique(cards(doc)), hasNext: next };
    }
    if (listing === "season") {
      const now = new Date();
      return browse(ctx, page, { season: SEASONS[now.getUTCMonth()], year: String(now.getUTCFullYear()), sort: "Most Viewed" });
    }
    const sort = listing === "popular" ? "Most Viewed" : listing === "top" ? "Top Rated" : undefined;
    return browse(ctx, page, { sort, ...filterQuery(filters) });
  },

  search: (ctx, { query, page, filters }) => browse(ctx, page, { search: query, ...filterQuery(filters) }),

  async details(ctx, id): Promise<AnimeDetails> {
    const doc = await ctx.http.doc(pageUrl(id), { cacheMs: 10 * 60_000 });
    const ld = jsonLd(doc);
    const title = clean(String(ld?.name ?? doc.one("h1")?.text() ?? ""));
    if (!title) throw new SourceError("not-found", `WitAnime has no anime "${id}"`);
    const html = doc.html();
    const head = clean(doc.one("main")?.text()).slice(0, 600);
    const poster = doc.all("img").map((i) => i.href("src")).find((s) => s?.includes("/posters/"));
    const tags = (Array.isArray(ld?.genre) ? (ld!.genre as string[]) : []).map(clean).filter(Boolean);
    const company = (ld?.productionCompany as { name?: string } | undefined)?.name;
    const seasonWord = fact(html, "الموسم");
    const firstYear = year(String(ld?.startDate ?? ld?.dateCreated ?? fact(html, "السنة")));
    const count = Number(ld?.numberOfEpisodes ?? fact(html, "الحلقات"));
    const runtime = typeof ld?.duration === "string" ? Number(/PT(\d+)M/.exec(ld.duration)?.[1]) || undefined : minutes(fact(html, "المدة"));
    return {
      id,
      title,
      url: pageUrl(id),
      cover: poster ?? (typeof ld?.image === "string" ? ld.image : undefined),
      type: isMovie(id) ? "movie" : animeType(head.match(/\b(TV Short|TV|OVA|ONA|Special|Music)\b/)?.[1]),
      status: isMovie(id) ? "completed" : status(head.match(/مستمر|مكتمل|قادم/)?.[0]?.replace("قادم", "")),
      year: firstYear,
      altTitles: [clean(String(ld?.alternateName ?? ""))].filter(Boolean),
      description: clean(String(ld?.description ?? "")) || undefined,
      genres: tags.filter((g) => !demographic(g) && g !== "جوسيه").map((name) => ({ name, key: genreKey(name) })),
      studios: company ? [clean(company)] : [],
      season: seasonWord && firstYear ? `${seasonWord} ${firstYear}` : seasonWord || undefined,
      episodeCount: Number.isInteger(count) && count > 0 ? count : undefined,
      duration: runtime,
    };
  },

  async episodes(ctx, id): Promise<Episode[]> {
    if (isMovie(id)) return [{ id: "movie", number: 1 }];
    const doc = await ctx.http.doc(pageUrl(id), { cacheMs: 10 * 60_000 });
    const numbers = new Set<number>();
    const prefix = `/watch/${id}/`;
    for (const a of doc.all("a[href*='/watch/']")) {
      const href = a.attr("href") ?? "";
      const at = href.indexOf(prefix);
      const n = at >= 0 ? Number(href.slice(at + prefix.length).replace(/[/?#].*$/, "")) : NaN;
      if (Number.isFinite(n)) numbers.add(n);
    }
    return [...numbers].sort((a, b) => a - b).map((n) => ({ id: String(n), number: n, url: `${SITE}${prefix}${n}` }));
  },

  async servers(ctx, animeId, episodeId) {
    const watch = isMovie(animeId) ? `${SITE}/watch/${animeId}` : `${SITE}/watch/${animeId}/${encodeURIComponent(episodeId)}`;
    const visit = ctx.http.session();
    const html = await visit.text(watch);
    const csrf = /<meta name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /data-csrf="([^"]+)"/.exec(html)?.[1];
    const sourcesUrl = /sourcesUrl:\s*'([^']+)'/.exec(html)?.[1]?.replace(/\\\//g, "/");
    if (!csrf || !sourcesUrl) throw new SourceError("changed", "WitAnime's watch page has no source list");
    const xhr = { Accept: "application/json", "X-CSRF-TOKEN": csrf, "X-Requested-With": "XMLHttpRequest", Referer: watch };
    type Source = { token: string; label?: string; version?: string; lang?: string };
    const manifest = await visit.json<{ players?: Record<string, Source[]>; downloads?: Record<string, Source[]> }>(new URL(sourcesUrl, SITE).toString(), { method: "POST", headers: xhr });

    const QUALITY = ["4K", "FHD", "HD", "SD"];
    const pick = (group: Record<string, Source[]> | undefined, max: number) =>
      Object.entries(group ?? {})
        .sort(([a], [b]) => (QUALITY.indexOf(a) + 9) % 9 - ((QUALITY.indexOf(b) + 9) % 9))
        .flatMap(([quality, list]) => list.filter((s) => /^[a-f0-9]{64}$/.test(s.token)).map((s) => ({ ...s, quality })))
        .slice(0, max);

    const open = async (s: Source & { quality: string }, kind: "stream" | "download"): Promise<VideoServer | null> => {
      try {
        await visit.request("POST", `${SITE}/watch/${kind}-source/${s.token}`, { headers: xhr });
        const gate = await visit.request("GET", `${SITE}/watch/${kind}-gate/${s.token}`, { headers: { Referer: watch }, redirect: "manual", retries: 0 });
        const target = gate.headers.location ?? /http-equiv="refresh" content="0;url='([^']+)'/.exec(await gate.text())?.[1];
        if (!target || !/^https?:\/\//.test(target)) return null;
        const dub = s.version === "dub";
        return {
          name: clean(s.label) || new URL(target).host,
          url: target,
          kind: /\.m3u8(\?|$)/.test(target) ? "hls" : /\.(mp4|webm)(\?|$)/.test(target) && kind === "stream" ? "mp4" : "embed",
          quality: s.quality,
          audio: dub ? "dub" : "sub",
          lang: dub ? ({ jp: "ja", kr: "ko", cn: "zh" } as Record<string, string>)[s.lang ?? ""] ?? s.lang : "ar",
          download: kind === "download",
        };
      } catch {
        return null;
      }
    };

    const [streams, downloads] = await Promise.all([
      Promise.all(pick(manifest.players, 10).map((s) => open(s, "stream"))),
      Promise.all(pick(manifest.downloads, 4).map((s) => open(s, "download"))),
    ]);
    return [...streams, ...downloads].filter((s): s is VideoServer => !!s);
  },
});

export default defineExtension({
  pkg: "storm.anisto.witanime",
  name: "WitAnime",
  version: "1.0.0",
  app: "anisto",
  sources: [witanime],
});
