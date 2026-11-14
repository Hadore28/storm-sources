// Madara, the WordPress manga theme most scanlation sites run. One site is a few
// settings taken from Keiyoushi's Madara sources; the rest is found on the page.

import {
  SourceError,
  chapterNumber,
  clean,
  defineSource,
  demographic,
  genreKey,
  mangaType,
  status,
  type Chapter,
  type Context,
  type Doc,
  type El,
  type FilterValues,
  type MangaSource,
  type MangaSummary,
  type Paged,
  type Status,
  type Text,
} from "@storm-sources/sdk";
import { siteDate } from "./dates";

export interface MadaraSite {
  id: string;
  name: string;
  lang: string;
  url: string;
  mirrors?: string[];
  /** a site that also carries adult series, which storm hides */
  mixed?: boolean;
  chapters?: "MangaPage" | "MangaAjax" | "MangaAjaxPaginated" | "AdminAjax" | "MangaAjaxQuery";
  /** what comes before a series' slug, "manga" on most sites */
  path?: string;
  noAjax?: boolean;
  allTypes?: boolean;
  genres?: string;
}

const L = (en: string, ar: string): Text => ({ en, ar });
const PER_PAGE = 24;
const ADULT = /hentai|smut|\badult|18\+|\+18|porn|sexual|erotic|yaoi\s*\(18|هنتاي|للكبار|إباحي|اباحي|جنسي/i;
const CARDS = "div.page-item-detail, .manga__item, .c-tabs-item__content, .manga-item, .page-listing-item .col-6";

const STATUS: [RegExp, Status][] = [
  [/completed|completo|completado|conclu[ií]do|finalizado|achev[ée]|termin[ée]|hoàn thành|tamamlan|завершен|已完结|complété|tamat|selesai/i, "completed"],
  [/ongoing|on going|em lançamento|em andamento|en cours|ativo|lançando|đang|devam|in corso|en curso|emisi[oó]n|publicando|连载|продолжается|виходить|berjalan|atualiza/i, "ongoing"],
  [/on hold|hiatus|pausado|en espera|durduruldu|beklemede|en pause|заморожен|en attente|tạm dừng/i, "hiatus"],
  [/cancel|iptal|đã hủy|abandonn|заброшен|annulé|dropped/i, "cancelled"],
];
const statusOf = (s: string) => {
  const known = status(s);
  return known !== "unknown" ? known : (STATUS.find(([re]) => re.test(s))?.[1] ?? "unknown");
};

function imageOf(img: El | null): string | undefined {
  if (!img) return undefined;
  for (const a of ["data-src", "data-lazy-src", "data-lzl-src", "data-cfsrc", "data-manga-src"]) {
    if (img.attr(a)?.trim()) return img.href(a)?.trim();
  }
  const set = img.attr("srcset") ?? img.attr("data-srcset");
  if (set) {
    const best = set
      .split(",")
      .map((c) => c.trim().split(/\s+/))
      .filter((c) => /^https?:\/\//.test(c[0]))
      .sort((a, b) => parseFloat(b[1] ?? "0") - parseFloat(a[1] ?? "0"))[0];
    if (best) return best[0];
  }
  return img.href("src")?.trim() || undefined;
}

// WordPress keeps the original next to its "-175x238" thumbnails
const fullSize = (src?: string) => src?.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, "$1");

export function madara(site: MadaraSite): MangaSource {
  const prefix = site.path ?? "manga";
  const mirrors = [site.url, ...(site.mirrors ?? [])];
  const base = (ctx: Context) => (mirrors.includes(String(ctx.settings.mirror)) ? String(ctx.settings.mirror) : site.url);
  const hosts = mirrors.map((m) => new URL(m).host);
  // ids carry no slash: "solo-leveling" under the usual path, "series~solo-leveling" under another
  const idFrom = (parts: string[]) => (parts[0] === prefix ? parts[1] : `${parts[0]}~${parts[1]}`);
  const pathOf = (id: string) => (id.includes("~") ? id.split("~") : [prefix, id]);
  const urlOf = (ctx: Context, id: string) => `${base(ctx)}/${pathOf(id).map(encodeURIComponent).join("/")}/`;
  const idOf = (href: string | null) => {
    if (!href) return undefined;
    try {
      const u = new URL(href);
      const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (!hosts.includes(u.host) || parts.length < 2 || parts.length > 3 || /^(page|feed|genre|tag|author|artist)$/i.test(parts[1])) return undefined;
      return idFrom(parts);
    } catch {
      return undefined;
    }
  };

  // child themes with their own cards: any series link that wraps a cover
  const looseCards = (ctx: Context, doc: Doc): MangaSummary[] => {
    const found = new Map<string, MangaSummary>();
    for (const a of doc.all(`a[href*="/${prefix}/"]`)) {
      const id = idOf(a.href());
      if (!id) continue;
      const img = a.one("img");
      const title = clean(a.attr("title")) || clean(a.text()) || clean(img?.attr("alt"));
      const had = found.get(id);
      if (had) {
        had.cover ??= fullSize(imageOf(img));
        if (!had.title && title) had.title = title;
      } else if (img || title) found.set(id, { id, title, cover: fullSize(imageOf(img)), url: urlOf(ctx, id) });
    }
    return [...found.values()].filter((m) => m.title && m.cover);
  };

  const cards = (ctx: Context, doc: Doc): MangaSummary[] => {
    const seen = new Set<string>();
    if (!doc.one(CARDS)) return looseCards(ctx, doc);
    return doc.all(CARDS).flatMap((card): MangaSummary[] => {
      const link = card.one(".post-title a, h3 a, h4 a, .manga-name a, .item-summary a") ?? card.one(`a[href*="/${prefix}/"]`);
      const id = idOf(link?.href() ?? null);
      if (!id || seen.has(id)) return [];
      if (site.mixed && card.all(".manga-title-badges, .adult").some((b) => /adult|18/.test(`${b.attr("class")} ${b.text()}`))) return [];
      seen.add(id);
      const title = clean(link!.text()) || clean(card.one("img")?.attr("alt"));
      if (!title) return [];
      return [{ id, title, cover: fullSize(imageOf(card.one("img"))), url: urlOf(ctx, id), latestChapter: chapterNumber(card.one(".chapter a, .chapter-item a")?.text()) }];
    });
  };

  const ajaxList = async (ctx: Context, page: number, extra: Record<string, string>) => {
    const form: Record<string, string> = {
      action: "madara_load_more",
      page: String(page - 1),
      template: "madara-core/content/content-archive",
      "vars[paged]": "1",
      "vars[template]": "archive",
      "vars[posts_per_page]": String(PER_PAGE),
      "vars[post_type]": "wp-manga",
      "vars[post_status]": "publish",
      "vars[manga_archives_item_layout]": "big_thumbnail",
      ...extra,
    };
    let meta = 0;
    if (!site.allTypes) {
      form[`vars[meta_query][${meta}][key]`] = "_wp_manga_chapter_type";
      form[`vars[meta_query][${meta++}][value]`] = "manga";
    }
    if (site.mixed) {
      form[`vars[meta_query][${meta}][key]`] = "manga_adult_content";
      form[`vars[meta_query][${meta++}][compare]`] = "not exists";
    }
    const html = await ctx.http.text(`${base(ctx)}/wp-admin/admin-ajax.php`, {
      method: "POST",
      form,
      headers: { "X-Requested-With": "XMLHttpRequest", Referer: `${base(ctx)}/` },
      retries: 1,
    });
    return cards(ctx, ctx.html(html, `${base(ctx)}/`));
  };

  const archive = async (ctx: Context, page: number, path: string, query: Record<string, string>) => {
    const qs = new URLSearchParams(query).toString();
    const doc = await ctx.http.doc(`${base(ctx)}/${path}${page > 1 ? `page/${page}/` : ""}${qs ? `?${qs}` : ""}`);
    return { items: cards(ctx, doc), hasNext: !!doc.one("div.nav-previous a, a.nextpostslink, #navigation-ajax, .wp-pagenavi a.next, a.next") };
  };

  const ORDER: Record<string, { ajax: Record<string, string>; m: string }> = {
    popular: { ajax: { "vars[orderby]": "meta_value_num", "vars[meta_key]": "_wp_manga_views", "vars[order]": "DESC" }, m: "views" },
    latest: { ajax: { "vars[orderby]": "meta_value_num", "vars[meta_key]": "_latest_update", "vars[order]": "DESC" }, m: "latest" },
    new: { ajax: { "vars[orderby]": "date", "vars[order]": "DESC" }, m: "new-manga" },
  };

  async function browse(ctx: Context, order: string, page: number, filters: FilterValues, query = ""): Promise<Paged<MangaSummary>> {
    const genre = typeof filters.genre === "string" ? filters.genre : "";
    const o = ORDER[order] ?? ORDER.popular;
    if (!site.noAjax) {
      const extra: Record<string, string> = { ...o.ajax };
      if (query) extra["vars[s]"] = query;
      if (genre) {
        extra["vars[tax_query][0][taxonomy]"] = "wp-manga-genre";
        extra["vars[tax_query][0][field]"] = "slug";
        extra["vars[tax_query][0][terms][0]"] = genre;
      }
      const items = await ajaxList(ctx, page, extra).catch(() => [] as MangaSummary[]);
      if (items.length || page > 1) return { items, hasNext: items.length >= PER_PAGE - 4 };
    }
    if (query) return archive(ctx, page, "", { s: query, post_type: "wp-manga" });
    return archive(ctx, page, genre ? `${site.genres ?? "manga-genre"}/${genre}/` : `${prefix}/`, { m_orderby: o.m });
  }

  // manga() and chapters() read the same page
  const series = (ctx: Context, id: string) => ctx.http.doc(urlOf(ctx, id), { cacheMs: 5 * 60_000 });

  // a chapter is what follows the series in its link, slashes made "~"
  const chapterList = (doc: Doc, id: string): Chapter[] =>
    doc.all("li.wp-manga-chapter").flatMap((li): Chapter[] => {
      const a = li.one("a");
      const href = a?.href();
      if (!a || !href) return [];
      let path: string;
      try {
        path = decodeURIComponent(new URL(href).pathname);
      } catch {
        return [];
      }
      const slug = pathOf(id)[1];
      const at = path.indexOf(`/${slug}/`);
      const chapter = at >= 0 ? path.slice(at + slug.length + 2).replace(/\/+$/, "").replace(/\//g, "~") : "";
      if (!chapter) return [];
      const date = li.one("img:not(.thumb)")?.attr("alt") || li.one("span a")?.attr("title") || li.one(".chapter-release-date")?.text();
      return [{ id: chapter, number: chapterNumber(a.text()) ?? chapterNumber(chapter.replace("-", ".")), title: clean(a.text()) || undefined, lang: site.lang, date: siteDate(date), url: href }];
    });

  const postId = (doc: Doc) =>
    doc.one("[id^=manga-chapters-holder]")?.attr("data-id") ||
    doc.one("input.rating-post-id")?.attr("value") ||
    doc.one("a[data-post]")?.attr("data-post") ||
    /[?&]p=(\d+)/.exec(doc.one("link[rel=shortlink]")?.attr("href") ?? "")?.[1];

  const post = (ctx: Context, url: string, form: Record<string, string>) =>
    ctx.http
      .text(url, { method: "POST", form, headers: { "X-Requested-With": "XMLHttpRequest", Referer: url }, retries: 1 })
      .then((h) => ctx.html(h, url))
      .catch(() => null);

  return defineSource({
    id: site.id,
    name: site.name,
    lang: site.lang,
    baseUrl: site.url,
    rating: site.mixed ? "suggestive" : "safe",
    rateLimit: { requests: 3, perMs: 1000 },
    images: { proxy: true, headers: { Referer: `${site.url}/` } },
    listings: [
      { id: "popular", label: L("Popular", "الأكثر مشاهدة"), filters: true },
      { id: "latest", label: L("Latest updates", "آخر التحديثات"), filters: true },
      ...(site.noAjax ? [] : [{ id: "new", label: L("Recently added", "أُضيفت حديثاً"), filters: true }]),
    ],
    async filters(ctx) {
      const doc = await ctx.http.doc(`${base(ctx)}/${prefix}/`).catch(() => null);
      const dir = site.genres ?? "manga-genre";
      const seen = new Set<string>();
      const options = (doc?.all(`div.genres a[href*="/${dir}/"], .genres_wrap a[href*="/${dir}/"], .sub-menu a[href*="/${dir}/"]`) ?? []).flatMap((a) => {
        const slug = /\/([^/]+)\/?$/.exec(new URL(a.href() ?? "", `${site.url}/`).pathname)?.[1];
        const name = clean(a.text()).replace(/\s*\(?\d+\)?$/, "");
        if (!slug || !name || seen.has(slug) || ADULT.test(`${slug} ${name}`)) return [];
        seen.add(slug);
        return [{ value: decodeURIComponent(slug), label: L(name, name), genre: genreKey(name) }];
      });
      return options.length ? [{ id: "genre", type: "select", label: L("Genre", "التصنيف"), options: [{ value: "", label: L("All", "الكل") }, ...options], default: "" }] : [];
    },
    searchFilters: !site.noAjax,
    settings: mirrors.length > 1 ? [{ id: "mirror", type: "select", label: L("Address", "العنوان"), options: mirrors.map((m) => ({ value: m, label: new URL(m).host })), default: site.url }] : undefined,

    list: (ctx, { listing, page, filters }) => browse(ctx, listing, page, filters),
    search: (ctx, { query, page, filters }) => browse(ctx, "popular", page, filters, query),

    async manga(ctx, id) {
      const doc = await series(ctx, id);
      const og = clean(doc.one('meta[property="og:title"]')?.attr("content")).replace(/\s+[-–|»]\s+[^-–|»]+$/, "");
      const title =
        clean(doc.one("div.post-title h1, div.post-title h3, #manga-title > h1")?.without(".manga-title-badges, span").text()) ||
        clean(doc.one("div.post-title h1, #manga-title > h1, h1.title, h1.entry-title, .manga-title h1, h1")?.text()) ||
        og;
      if (!title) throw new SourceError("changed", `${site.name} series page has no title`);
      const rows = doc.all(".post-content_item, .post-content .manga-info-row").map((r) => [clean(r.one(".summary-heading")?.text()), clean(r.one(".summary-content")?.text())] as const);
      const row = (re: RegExp) => rows.find(([h]) => re.test(h))?.[1];
      const tags = [...doc.all("div.genres-content a"), ...doc.all("div.tags-content a")].map((a) => clean(a.text())).filter(Boolean);
      if (site.mixed && (tags.some((t) => ADULT.test(t)) || doc.one(".manga-title-badges.adult"))) throw new SourceError("not-found", `${site.name}: an adult series, hidden in storm`);
      const typeText = row(/type|tipo|tür|loại|النوع|jenis/i);
      const people = (sel: string) => doc.all(sel).map((a) => clean(a.text())).filter((n) => n && !/updating|atualizando/i.test(n));
      const desc = doc.one("div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt, .manga-summary, .description-summary");
      return {
        id,
        title,
        url: urlOf(ctx, id),
        cover: fullSize(imageOf(doc.one("div.summary_image img"))) ?? doc.one('meta[property="og:image"]')?.attr("content") ?? undefined,
        type: [typeText, ...tags].map(mangaType).find((t) => t && t !== "other"),
        status: statusOf(row(/status|estado|durum|tình trạng|الحالة|statut|stato/i) ?? rows.at(-1)?.[1] ?? ""),
        altTitles: (row(/alt|altern|nombre|nomes|diğer|tên khác|اسماء|أسماء|autres/i) ?? "").split(/[,;،/]/).map(clean).filter((t) => t && !/updating/i.test(t)),
        description: clean(desc?.text()) || undefined,
        authors: people("div.author-content a, div.manga-authors a"),
        artists: people("div.artist-content a"),
        genres: tags.filter((g) => !demographic(g) && mangaType(g) === "other").map((name) => ({ name, key: genreKey(name) })),
        demographic: tags.map(demographic).find(Boolean),
      };
    },

    async chapters(ctx, id) {
      const doc = await series(ctx, id);
      const url = urlOf(ctx, id);
      const ways: Record<string, () => Promise<Chapter[]>> = {
        MangaPage: async () => chapterList(doc, id),
        MangaAjax: async () => {
          const d = await post(ctx, `${url}ajax/chapters/`, {});
          return d ? chapterList(d, id) : [];
        },
        MangaAjaxPaginated: async () => {
          const out: Chapter[] = [];
          for (let t = 1; t <= 50; t++) {
            const d = await post(ctx, `${url}ajax/chapters/?t=${t}`, {});
            const got = d ? chapterList(d, id) : [];
            if (!got.length || got.at(-1)!.id === out.at(-1)?.id) break;
            out.push(...got);
          }
          return out;
        },
        AdminAjax: async () => {
          const pid = postId(doc);
          const d = pid ? await post(ctx, `${base(ctx)}/wp-admin/admin-ajax.php`, { action: "manga_get_chapters", manga: pid }) : null;
          return d ? chapterList(d, id) : [];
        },
        MangaAjaxQuery: async () => {
          const d = await post(ctx, `${base(ctx)}/index.php`, { "manga-core": pathOf(id)[1], manga_ajax: "1", maction: "get_chapters" });
          return d ? chapterList(d, id) : [];
        },
      };
      const order = [site.chapters ?? "MangaPage", "MangaPage", "MangaAjax", "AdminAjax"].filter((w, i, a) => a.indexOf(w) === i);
      for (const way of order) {
        const got = await ways[way]();
        if (got.length) return got;
      }
      return [];
    },

    async pages(ctx, id, chapter) {
      const path = [...pathOf(id), ...chapter.split("~")].map(encodeURIComponent).join("/");
      const doc = await ctx.http.doc(`${base(ctx)}/${path}/?style=list`);
      if (doc.one("#chapter-protector-data")) throw new SourceError("unsupported", `${site.name} locks its chapter pages`);
      const urls = doc
        .all("div.page-break img, li.blocks-gallery-item img, .reading-content .text-left img, .reading-content img")
        .map(imageOf)
        .filter((u): u is string => !!u && /^https?:\/\//.test(u) && !/\.gif(\?|$)|loading|placeholder/i.test(u));
      return [...new Set(urls)].map((url) => ({ url }));
    },

    resolveUrl(url) {
      try {
        const u = new URL(url);
        if (!hosts.includes(u.host)) return null;
        const parts = decodeURIComponent(u.pathname).split("/").filter(Boolean);
        if (parts.length < 2) return null;
        return parts.length > 2 ? { mangaId: idFrom(parts), chapterId: parts.slice(2).join("~") } : { mangaId: idFrom(parts) };
      } catch {
        return null;
      }
    },
  });
}
