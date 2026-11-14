// ArabSeed (MySeed) — Arabic films and series. Adapted from yuzono's Aniyomi extension
// (Apache-2.0) to the site's current pages: each quality's servers come from the
// site's own endpoints, and its direct server ends in a plain MP4.

import {
  SourceError,
  clean,
  defineExtension,
  defineFilmSource,
  type Context,
  type Doc,
  type FilmSummary,
  type Http,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";
import { withDirect } from "../../../players";

const SITE = "https://m.myseed.tv";
const L = (en: string, ar: string): Text => ({ en, ar });

const LISTS: { id: string; path: string; label: Text }[] = [
  { id: "foreign-movies", path: "category/foreign-movies", label: L("Foreign films", "أفلام أجنبية") },
  { id: "arabic-movies", path: "category/arabic-movies", label: L("Arabic films", "أفلام عربية") },
  { id: "foreign-series", path: "category/foreign-series", label: L("Foreign series", "مسلسلات أجنبية") },
  { id: "arabic-series", path: "category/arabic-series", label: L("Arabic series", "مسلسلات عربية") },
  { id: "turkish-series", path: "category/turkish-series", label: L("Turkish series", "مسلسلات تركية") },
  { id: "korean-series", path: "category/مسلسلات-كوريه", label: L("Korean series", "مسلسلات كورية") },
  { id: "indian-movies", path: "category/indian-movies", label: L("Indian films", "أفلام هندية") },
  { id: "animation-movies", path: "category/animation-movies", label: L("Animation", "أفلام أنيميشن") },
  { id: "cartoon-series", path: "category/cartoon-series", label: L("Cartoon series", "مسلسلات كرتون") },
  { id: "dubbed-movies", path: "category/dubbed-movies", label: L("Dubbed films", "أفلام مدبلجة") },
  { id: "netflix", path: "category/netflix", label: L("Netflix", "نتفليكس") },
];

// ids are the page's path with "~" for its slashes
const idOf = (href: string | null) => {
  if (!href) return undefined;
  try {
    const parts = new URL(href).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    return parts.length ? parts.join("~") : undefined;
  } catch {
    return undefined;
  }
};
const urlOf = (id: string) => `${SITE}/${id.split("~").map(encodeURIComponent).join("/")}/`;
const tidy = (t: string) => clean(t.replace(/\s*(مترجم|مدبلج|اون لاين|كامل)\s*/g, " ").replace(/^(فيلم|مسلسل|انمي)\s+/, ""));

const blocks = (doc: Doc): FilmSummary[] =>
  doc.all("a.movie__block").flatMap((a): FilmSummary[] => {
    const id = idOf(a.href());
    const raw = a.attr("title") ?? clean(a.one("h3")?.text());
    if (!id || !raw) return [];
    return [{ id, title: tidy(raw), cover: a.one("img")?.href("data-src") ?? a.one("img")?.href() ?? undefined, kind: /^مسلسل|s\d+-eps\d+|\/selary\//.test(`${raw} ${id}`) ? "series" : "movie", year: Number(/\b(19|20)\d{2}\b/.exec(raw)?.[0]) || undefined, url: urlOf(id) }];
  });

const page = async (ctx: Context, url: string) => {
  const doc = await ctx.http.doc(url, { headers: { Referer: `${SITE}/` } });
  const items = blocks(doc);
  return { items, hasNext: items.length >= 30 };
};

// the site wraps some links as /vid/?id=<base64 of the real address>
const unwrap = (url: string) => {
  const id = /\/vid\/\?id=([A-Za-z0-9+/_=-]+)/.exec(url)?.[1];
  if (!id) return url;
  try {
    return atob(id.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return url;
  }
};

// MySeed's own server: a player page that holds the MP4 in a <source>
async function ownServer(http: Http, link: string, watch: string): Promise<string | undefined> {
  const html = await (await http.request("GET", new URL(link, SITE).toString(), { headers: { Referer: watch } })).text();
  const gateway = /src="(https:\/\/[^"]+player-gateway[^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
  const player = gateway ? await (await http.request("GET", gateway, { headers: { Referer: `${SITE}/` } })).text() : html;
  return /<source[^>]+src="(https?:\/\/[^"]+)"/.exec(player)?.[1];
}

const arabseed = defineFilmSource({
  id: "arabseed",
  name: "ArabSeed",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 4, perMs: 1000 },
  images: { noReferrer: true },
  listings: LISTS.map(({ id, label }) => ({ id, label })),
  filters: [],

  list: (ctx, { listing, page: n }) => {
    const l = LISTS.find((x) => x.id === listing) ?? LISTS[0];
    return page(ctx, `${SITE}/${l.path.split("/").map(encodeURIComponent).join("/")}/${n > 1 ? `page/${n}/` : ""}`);
  },
  search: (ctx, { query, page: n }) => page(ctx, `${SITE}/find/?word=${encodeURIComponent(query)}${n > 1 ? `&offset=${n}` : ""}`),

  async details(ctx, id) {
    const doc = await ctx.http.doc(urlOf(id), { cacheMs: 5 * 60_000, headers: { Referer: `${SITE}/` } });
    const raw = clean(doc.one("h1")?.text()) || clean(doc.one('meta[property="og:title"]')?.attr("content")?.split("|")[0]);
    if (!raw) throw new SourceError("not-found", `ArabSeed has no page "${id}"`);
    const seasons = doc.all("#seasons__list li[data-url]").flatMap((li, i) => {
      const sid = idOf(li.attr("data-url"));
      return sid ? [{ id: sid, number: i + 1, title: clean(li.one("span")?.text()) || undefined }] : [];
    });
    if (!seasons.length && doc.one("ul.episodes__list a")) seasons.push({ id, number: 1, title: undefined });
    const terms = (re: RegExp) => doc.all(".info__area__ul li, .info__area li").filter((li) => re.test(li.text())).flatMap((li) => li.all("a").map((a) => clean(a.text())));
    return {
      id,
      title: tidy(raw),
      url: urlOf(id),
      kind: seasons.length ? "series" : "movie",
      cover: doc.one(".poster__side img, .poster-img img, .post__image img")?.href("data-src") ?? doc.one('meta[property="og:image"]')?.attr("content") ?? undefined,
      year: Number(/\b(19|20)\d{2}\b/.exec(raw)?.[0]) || undefined,
      altTitles: [],
      description: clean(doc.one(".post__story, .story__text, .mobile__story")?.text()) || undefined,
      genres: terms(/النوع|التصنيف/).map((name) => ({ name })),
      cast: terms(/الممثلين|بطولة/),
      directors: terms(/المخرج|اخراج/),
      countries: terms(/الدولة|البلد/),
      languages: terms(/اللغة/),
      seasons,
    };
  },

  async episodes(ctx, _filmId, seasonId) {
    const doc = await ctx.http.doc(urlOf(seasonId), { cacheMs: 5 * 60_000, headers: { Referer: `${SITE}/` } });
    const seen = new Set<string>();
    return doc
      .all("ul.episodes__list a")
      .flatMap((a) => {
        const id = idOf(a.href());
        if (!id || seen.has(id)) return [];
        seen.add(id);
        const number = Number(/eps?(\d+)/i.exec(id)?.[1] ?? /(\d+)/.exec(clean(a.one(".epi__num")?.text()))?.[1]) || undefined;
        return [{ id, number, title: clean(a.one(".episode__title")?.text()) || undefined }];
      })
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  },

  async servers(ctx, filmId, episodeId) {
    const http = ctx.http.session();
    const watch = `${urlOf(episodeId ?? filmId)}watch/`;
    const res = await http.request("GET", watch, { headers: { Referer: `${SITE}/` } });
    if (res.status >= 400) throw new SourceError("not-found", `ArabSeed has no watch page for ${episodeId ?? filmId}`);
    const doc = ctx.html(await res.text(), watch);
    const token = /csrf__token['"]?\s*:\s*["']([a-z0-9]+)["']/i.exec(doc.html())?.[1];
    const post = doc.one(".servers__list li[data-post]")?.attr("data-post");
    const found: { quality: string; name: string; link: string }[] = doc.all(".servers__list li[data-link]").map((li) => ({
      quality: `${li.attr("data-qu")}p`,
      name: li.attr("data-server-name") ?? "Server",
      link: li.attr("data-link")!,
    }));
    const shown = new Set(found.map((f) => f.quality));
    const qualities = doc.all("ul.qualities__list li[data-quality]").map((li) => li.attr("data-quality")!).filter((q) => !shown.has(`${q}p`));
    const ajax = (path: string, form: Record<string, string>) =>
      http.request("POST", `${SITE}/${path}/`, { form, headers: { "X-Requested-With": "XMLHttpRequest", Referer: watch } }).then((r) => r.json<{ type?: string; html?: string; server?: string }>());
    if (token && post) {
      for (const q of qualities) {
        const list = await ajax("get__quality__servers", { post_id: post, quality: q, csrf_token: token }).catch(() => undefined);
        const items = list?.html ? ctx.html(list.html, watch).all("li[data-server]") : [];
        const links = await Promise.all(
          items.map((li) => ajax("get__watch__server", { post_id: post, quality: q, server: li.attr("data-server")!, csrf_token: token }).catch(() => undefined)),
        );
        items.forEach((li, i) => {
          const link = links[i]?.server;
          if (link) found.push({ quality: `${q}p`, name: li.attr("data-server-name") ?? "Server", link });
        });
      }
    }
    const out: VideoServer[] = [];
    for (const f of found.sort((a, b) => parseInt(b.quality) - parseInt(a.quality))) {
      const link = unwrap(f.link);
      if (/vids\.php/.test(link)) {
        const mp4 = await ownServer(http, link, watch).catch(() => undefined);
        if (mp4) out.push({ name: "MySeed", url: mp4, kind: "mp4", quality: f.quality, referer: "https://d.myseed.tv/" });
        continue;
      }
      if (/^https?:\/\//.test(link)) out.push({ name: new URL(link).hostname.replace(/^www\./, "").split(".")[0], url: link, kind: "embed", quality: f.quality });
    }
    if (!out.length) throw new SourceError("not-found", `ArabSeed has no servers for ${episodeId ?? filmId}`);
    return withDirect(ctx, out);
  },
});

// the direct server's links are signed for a while
arabseed.cache = { servers: 10 * 60_000 };

export default defineExtension({
  pkg: "storm.movisto.arabseed",
  name: "ArabSeed",
  version: "1.0.0",
  app: "movisto",
  sources: [arabseed],
});
