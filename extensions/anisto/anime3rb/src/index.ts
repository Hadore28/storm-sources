// Anime3rb — Arabic-subtitled anime on a Laravel Livewire site. Its /search page
// sits behind a Cloudflare check, so search and sorting go through the same
// Livewire calls its own search box and sort menu make. Episodes play as plain
// MP4 files from vid3rb in up to three qualities.

import {
  SourceError,
  animeType,
  clean,
  decodeEntities,
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
  type Http,
  type Paged,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";

const SITE = "https://anime3rb.com";
const L = (en: string, ar: string): Text => ({ en, ar });

const GENRES: [string, string, string][] = [
  ["action", "Action", "أكشن"], ["adventure", "Adventure", "مغامرة"], ["comedy", "Comedy", "كوميدي"], ["drama", "Drama", "دراما"],
  ["fantasy", "Fantasy", "خيال"], ["sci-fi", "Sci-fi", "خيال علمي"], ["romance", "Romance", "رومانسي"], ["mystery", "Mystery", "غموض"],
  ["horror", "Horror", "رعب"], ["supernatural", "Supernatural", "خارق للطبيعة"], ["super-power", "Super power", "قوى خارقة"],
  ["slice-of-life", "Slice of life", "الحياة اليومية"], ["school", "School", "مدرسي"], ["sports", "Sports", "رياضي"],
  ["team-sports", "Team sports", "رياضات جماعية"], ["combat-sports", "Combat sports", "رياضات قتالية"], ["racing", "Racing", "سباق"],
  ["psychological", "Psychological", "نفسي"], ["suspense", "Suspense", "تشويق"], ["historical", "Historical", "تاريخي"],
  ["isekai", "Isekai", "إيسيكاي"], ["reincarnation", "Reincarnation", "تناسخ و إعادة إحياء"], ["time-travel", "Time travel", "سفر عبر الزمن"],
  ["martial-arts", "Martial arts", "قتالي"], ["military", "Military", "عسكري"], ["mecha", "Mecha", "ميكا"], ["music", "Music", "موسيقى"],
  ["harem", "Harem", "حريم"], ["reverse-harem", "Reverse harem", "عكس حريم"], ["vampire", "Vampires", "مصاصي دماء"],
  ["gore", "Gore", "دموي"], ["survival", "Survival", "نجاة"], ["detective", "Detective", "بوليسي"], ["video-game", "Video games", "ألعاب فيديو"],
  ["workplace", "Workplace", "عمل"], ["medical", "Medical", "طبي"], ["gourmet", "Gourmet", "طعام"], ["samurai", "Samurai", "ساموراي"],
  ["space", "Space", "فضاء"], ["mythology", "Mythology", "أساطير"], ["parody", "Parody", "ساخر"], ["gag-humor", "Gag humor", "كوميديا حركية"],
  ["kids", "Kids", "للأطفال"], ["mahou-shoujo", "Magical girls", "فتاة ساحرة"], ["ecchi", "Ecchi", "إيتشي"], ["iyashikei", "Iyashikei", "إياشيكي"],
  ["cgdct", "Cute girls", "كيوت"], ["urban-fantasy", "Urban fantasy", "خيال حضري"], ["strategy-game", "Strategy", "استراتيجي"],
  ["high-stakes-game", "High-stakes games", "ألعاب عالية المخاطر"], ["love-polygon", "Love polygon", "حب متعدد الأطراف"],
  ["otaku-culture", "Otaku culture", "ثقافة الأوتاكو"], ["idols-female", "Idols (female)", "أيدول إناث"], ["idols-male", "Idols (male)", "أيدول ذكور"],
  ["organized-crime", "Organized crime", "جريمة منظمة"], ["delinquents", "Delinquents", "جانحون"], ["adult-cast", "Adult cast", "بطولة راشدين"],
  ["anthropomorphic", "Anthropomorphic", "أنثروبولوجي"], ["performing-arts", "Performing arts", "فنون استعراضية"], ["visual-arts", "Visual arts", "فنون بصرية"],
  ["showbiz", "Showbiz", "صناعة الترفيه"], ["childcare", "Childcare", "رعاية أطفال"], ["pets", "Pets", "حيوانات أليفة"], ["villainess", "Villainess", "شريرة"],
  ["avant-garde", "Avant-garde", "ابتكاري"], ["award-winning", "Award winning", "حائز على جوائز"], ["educational", "Educational", "تعليمية"],
];

const TYPES = [
  { value: "tv", label: L("TV", "مسلسل") },
  { value: "movie", label: L("Movie", "فيلم") },
  { value: "ova", label: L("OVA", "أوفا") },
  { value: "ona", label: L("ONA", "أونا") },
  { value: "special", label: L("Special", "خاصة") },
  { value: "tv-special", label: L("TV special", "حلقة تلفزيونية خاصة") },
];

const SORTS: Record<string, string> = { new: "addition_date", top: "rate" };

const pageUrl = (id: string) => `${SITE}/titles/${id}`;

// "<h1>One Piece ( مسلسل )</h1>" and "( فيلم )" both name the kind
const KINDS: [RegExp, AnimeSummary["type"]][] = [[/مسلسل/, "tv"], [/فيلم/, "movie"]];
const kindOf = (text: string) => KINDS.find(([re]) => re.test(text))?.[1] ?? animeType(text);

function titleCards(doc: Doc): AnimeSummary[] {
  return doc.all(".title-card, .simple-title-card").flatMap((card): AnimeSummary[] => {
    const a = card.one("a[href*='/titles/']") ?? card;
    const id = /\/titles\/([^/?#]+)/.exec(a.href() ?? "")?.[1];
    const title = clean(card.one(".title-name, h4")?.text());
    if (!id || id === "list" || !title) return [];
    const season = card.all(".badge").map((b) => clean(b.text())).find((t) => /\d{4}$/.test(t));
    return [{ id, title, cover: card.one("img")?.href("src") ?? undefined, url: pageUrl(id), year: year(season) }];
  });
}

function episodeCards(doc: Doc): AnimeSummary[] {
  return doc.all("a.video-card").flatMap((a): AnimeSummary[] => {
    const m = /\/episode\/([^/?#]+)\/([^/?#]+)/.exec(a.href() ?? "");
    const title = clean(a.one(".title-name")?.text());
    if (!m || !title) return [];
    const n = Number(m[2]);
    return [{ id: m[1], title, cover: a.one("img")?.href("src") ?? undefined, url: pageUrl(m[1]), latestEpisode: Number.isFinite(n) ? n : undefined }];
  });
}

const unique = (items: AnimeSummary[]) => {
  const seen = new Set<string>();
  return items.filter((a) => !seen.has(a.id) && seen.add(a.id));
};

// The site turns away a burst of these calls, so they go one at a time.
const LIVEWIRE_GAP_MS = 1000;
let queue: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const oneAtATime = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job);
  queue = run.catch(() => undefined).then(() => sleep(LIVEWIRE_GAP_MS));
  return run;
};

// Runs one of the page's Livewire components the way the site's own scripts do,
// and hands back the HTML it renders.
const livewire = (visit: Http, url: string, component: string, updates: Record<string, unknown>, calls: { method: string; params: unknown[] }[] = []) =>
  oneAtATime(() => render(visit, url, component, updates, calls));

async function render(visit: Http, url: string, component: string, updates: Record<string, unknown>, calls: { method: string; params: unknown[] }[]) {
  const html = await visit.text(url);
  const csrf = /data-csrf="([^"]+)"/.exec(html)?.[1];
  const snapshot = [...html.matchAll(/wire:snapshot="([^"]*)"/g)].map((m) => decodeEntities(m[1])).find((s) => s.includes(`"name":"${component}"`));
  if (!csrf || !snapshot) throw new SourceError("changed", `Anime3rb's page has no ${component} component`);
  const res = await visit.json<{ components?: { effects?: { html?: string } }[] }>(`${SITE}/livewire/update`, {
    method: "POST",
    headers: { "X-Livewire": "true", Referer: url, Accept: "application/json" },
    retries: 1,
    json: { _token: csrf, components: [{ snapshot, updates, calls: calls.map((c) => ({ path: "", ...c })) }] },
  });
  const out = res.components?.[0]?.effects?.html;
  if (typeof out !== "string") throw new SourceError("changed", `Anime3rb's ${component} sent nothing back`);
  return out;
}

function listPath(filters: FilterValues) {
  const pick = (id: string) => (typeof filters[id] === "string" && filters[id] ? String(filters[id]) : undefined);
  const genre = pick("genre");
  const type = pick("type");
  return genre ? `${SITE}/genre/${encodeURIComponent(genre)}` : `${SITE}/titles/list${type ? `/${encodeURIComponent(type)}` : ""}`;
}

async function titles(ctx: Context, path: string, page: number, sort: string): Promise<Paged<AnimeSummary>> {
  let doc: Doc;
  if (sort === "addition_date") {
    doc = await ctx.http.doc(path, { query: { page: page > 1 ? String(page) : undefined }, cacheMs: 5 * 60_000 });
  } else {
    // the sort menu isn't in the address, only in the component
    const html = await livewire(ctx.http.session(), path, "title.index-titles", { sort_by: sort }, page > 1 ? [{ method: "gotoPage", params: [page, "page"] }] : []);
    doc = ctx.html(html, path);
  }
  const items = unique(titleCards(doc));
  const html = doc.html();
  // links on a plain page, buttons on a rendered one
  return { items, hasNext: items.length > 0 && (html.includes(`page=${page + 1}`) || html.includes(`gotoPage(${page + 1},`)) };
}

const anime3rb = defineAnimeSource({
  id: "anime3rb",
  name: "Anime3rb",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 5, perMs: 1000 },
  listings: [
    { id: "episodes", label: L("New episodes", "أحدث الحلقات") },
    { id: "new", label: L("Recently added", "أضيفت حديثاً"), filters: true },
    { id: "top", label: L("Top rated", "الأعلى تقييماً"), filters: true },
    { id: "movies", label: L("Movies", "أفلام") },
  ],
  filters: [
    { id: "genre", type: "select", label: L("Genre", "التصنيف"), options: GENRES.map(([value, en, ar]) => ({ value, label: L(en, ar), genre: genreKey(en) ?? genreKey(ar) })) },
    { id: "type", type: "select", label: L("Type", "النوع"), options: TYPES },
  ],

  async list(ctx, { listing, page, filters }) {
    if (listing === "episodes") {
      const doc = await ctx.http.doc(SITE, { query: { page: page > 1 ? String(page) : undefined }, cacheMs: 5 * 60_000 });
      // skip the pinned row above the latest episodes
      const html = doc.html();
      const at = html.indexOf("أحدث الحلقات", html.indexOf("الأنميات المثبتة") + 1);
      const items = unique(episodeCards(at < 0 ? doc : ctx.html(html.slice(at), SITE)));
      return { items, hasNext: items.length > 0 && page < 50 };
    }
    if (listing === "movies") return titles(ctx, `${SITE}/titles/list/movie`, page, SORTS.new);
    return titles(ctx, listPath(filters), page, SORTS[listing] ?? SORTS.new);
  },

  async search(ctx, { query, page }) {
    if (page > 1) return { items: [], hasNext: false };
    const html = await livewire(ctx.http.session(), SITE, "search", { query });
    return { items: unique(titleCards(ctx.html(html, SITE))), hasNext: false };
  },

  async details(ctx, id): Promise<AnimeDetails> {
    const doc = await ctx.http.doc(pageUrl(id), { cacheMs: 10 * 60_000 });
    const h1 = doc.one("h1");
    const title = clean(h1?.one("span[dir='ltr']")?.text() ?? h1?.text());
    if (!title) throw new SourceError("not-found", `Anime3rb has no anime "${id}"`);
    const facts = new Map(doc.all("table tr").map((tr) => tr.all("td").map((td) => clean(td.text()))).filter((r) => r.length === 2).map(([k, v]) => [k.replace(/:$/, ""), v]));
    const stat = (label: string) => {
      const box = doc.all(".flex.flex-col").find((b) => clean(b.one("p.font-light")?.text()) === label);
      return clean(box?.all("p")[1]?.text());
    };
    let ld: Record<string, unknown> = {};
    for (const s of doc.all("script[type='application/ld+json']")) {
      try {
        const o = JSON.parse(s.html());
        if (o?.["@type"] === "TVSeries" || o?.["@type"] === "Movie") ld = o;
      } catch {
        // another block
      }
    }
    // alternateName arrives as one string with the quotes left in
    const alts = (Array.isArray(ld.alternateName) ? ld.alternateName.join('", "') : String(ld.alternateName ?? ""))
      .split(/"\s*,\s*"/)
      .map((s) => clean(s.replace(/^"|"$/g, "")))
      .filter((s) => s && s !== title);
    const genreNames = [...new Set((Array.isArray(ld.genre) ? (ld.genre as string[]) : []).map(clean))].filter((g) => g && !demographic(g));
    const studios = doc.all("a[href*='/c/studio/']").map((a) => clean(a.text()));
    const statusText = facts.get("الحالة") ?? "";
    const count = Number(stat("الحلقات"));
    const runtime = doc.all(".video-list a span.rounded").map((s) => minutes(s.text().replace(/^(\d+):\d+$/, "$1 min"))).find((n) => n);
    const kind = kindOf(clean(h1?.text()));
    return {
      id,
      title,
      url: pageUrl(id),
      cover: doc.one("main img[fetchpriority]")?.href("src") ?? (typeof ld.image === "string" ? ld.image : undefined),
      type: kind,
      status: /قيد البث|يعرض/.test(statusText) ? "ongoing" : status(statusText),
      year: year(facts.get("إصدار") ?? String(ld.datePublished ?? "")),
      altTitles: [...new Set(alts)],
      description: doc.all("[x-show='! summary'] p").map((p) => clean(p.text())).filter(Boolean).join("\n\n") || clean(String(ld.description ?? "")) || undefined,
      genres: genreNames.map((name) => ({ name, key: genreKey(name) })),
      studios: [...new Set(studios)],
      season: facts.get("إصدار") || undefined,
      episodeCount: Number.isInteger(count) && count > 0 ? count : undefined,
      duration: kind === "movie" ? undefined : runtime,
    };
  },

  async episodes(ctx, id): Promise<Episode[]> {
    const doc = await ctx.http.doc(pageUrl(id), { cacheMs: 10 * 60_000 });
    const prefix = `/episode/${id}/`;
    const seen = new Set<string>();
    const out: Episode[] = [];
    for (const a of doc.all(".video-list a[href*='/episode/']")) {
      const href = a.href() ?? "";
      const at = href.indexOf(prefix);
      const ep = at >= 0 ? decodeURIComponent(href.slice(at + prefix.length).replace(/[/?#].*$/, "")) : "";
      if (!ep || seen.has(ep)) continue;
      seen.add(ep);
      const n = Number(ep);
      out.push({ id: ep, number: Number.isFinite(n) ? n : undefined, title: clean(a.one(".video-data p")?.text()) || undefined, url: `${SITE}${prefix}${encodeURIComponent(ep)}` });
    }
    return out.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  },

  async servers(ctx, animeId, episodeId) {
    const watch = `${SITE}/episode/${animeId}/${encodeURIComponent(episodeId)}`;
    const html = await ctx.http.text(watch);
    const snap = [...html.matchAll(/wire:snapshot="([^"]*)"/g)].map((m) => decodeEntities(m[1])).find((s) => s.includes('"name":"video.show-video"'));
    const player = snap ? (JSON.parse(snap) as { data?: { video_url?: string } }).data?.video_url : undefined;
    if (!player) throw new SourceError("not-found", `Anime3rb has no video for ${animeId} episode ${episodeId}`);
    const page = await ctx.http.text(player, { headers: { Referer: `${SITE}/` } });
    type Src = { src?: string; label?: string; res?: string };
    const sources = [...page.matchAll(/\{[^{}]*"src"\s*:\s*"[^"]*"[^{}]*\}/g)].flatMap((m): Src[] => {
      try {
        return [JSON.parse(m[0]) as Src];
      } catch {
        return [];
      }
    });
    const servers = await Promise.all(
      sources
        .filter((s) => s.src && /^https:\/\//.test(s.src) && !/premium/i.test(s.label ?? ""))
        .map(async (s): Promise<VideoServer | null> => {
          // the player's link lasts half an hour; the file it leads to lasts hours
          let url = s.src!;
          try {
            const hop = await ctx.http.request("GET", url, { redirect: "manual", retries: 0 });
            if (hop.headers.location && /^https:\/\//.test(hop.headers.location)) url = hop.headers.location;
          } catch {
            // keep the player's link
          }
          const quality = /\d{3,4}p/.exec(s.label ?? "")?.[0] ?? (s.res ? `${s.res}p` : undefined);
          return { name: `Anime3rb ${quality ?? ""}`.trim(), url, kind: "mp4", quality, audio: "sub", lang: "ar" };
        }),
    );
    const ok = servers.filter((s): s is VideoServer => !!s);
    return ok.sort((a, b) => (parseInt(b.quality ?? "0") || 0) - (parseInt(a.quality ?? "0") || 0));
  },
});

export default defineExtension({
  pkg: "storm.anisto.anime3rb",
  name: "Anime3rb",
  version: "1.0.0",
  app: "anisto",
  sources: [anime3rb],
});
