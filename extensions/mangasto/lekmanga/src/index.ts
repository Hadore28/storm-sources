// LekManga — an Arabic Madara (WordPress) site. Lists and search go through its
// ajax endpoint; series, chapters and images sit behind Cloudflare, so those
// are fetched straight from the origin servers, the way its app does.

import {
  SourceError,
  chapterNumber,
  clean,
  defineExtension,
  defineSource,
  demographic,
  genreKey,
  genreOptions,
  mangaType,
  parseDate,
  status,
  type Chapter,
  type Context,
  type FilterValues,
  type MangaSummary,
  type Paged,
  type Text,
} from "@storm-sources/sdk";

const MIRRORS = ["https://lekmanga.site", "https://mangalik.net", "https://like-manga.net"];
const SITE = MIRRORS[0];
// .218 serves the pages, some image shards only answer on .217
const ORIGIN = ["5.187.35.218", "5.187.35.217"];
const PER_PAGE = 20;
// real pages sit in a /data<N>/ folder, or the old manga_<hash>/<chapter>/<n>.jpg layout
const PAGE = /^https?:\/\/[^/]+\.lekmanga\.site\/(?:.*\/data\d*\/|.*\/manga_[a-z0-9]+\/\d+\/\d+\.\w+$)/i;

const L = (en: string, ar: string): Text => ({ en, ar });

const base = (ctx: Context) => (MIRRORS.includes(String(ctx.settings.mirror)) ? String(ctx.settings.mirror) : SITE);
const slugOf = (url: string | null) => url?.match(/\/manga\/([^/?#]+)/)?.[1];
// WordPress keeps the original next to its "-110x150" thumbnails
const fullSize = (src: string | null) => src?.replace(/\?.*$/, "").replace(/-\d+x\d+(\.\w+)$/, "$1") ?? undefined;
const known = (v?: string) => (v && !/^updating$/i.test(v) ? v.split(/[,،]/).map(clean).filter(Boolean) : []);

const ORDER: Record<string, Record<string, string>> = {
  popular: { "vars[orderby]": "meta_value_num", "vars[meta_key]": "_wp_manga_views", "vars[order]": "desc" },
  latest: { "vars[orderby]": "meta_value_num", "vars[meta_key]": "_latest_update", "vars[order]": "desc" },
  new: { "vars[orderby]": "date", "vars[order]": "desc" },
  az: { "vars[orderby]": "post_title", "vars[order]": "asc" },
};

function ajax(ctx: Context, form: Record<string, string>) {
  return ctx.http.text(`${base(ctx)}/wp-admin/admin-ajax.php`, {
    method: "POST",
    form,
    headers: { "X-Requested-With": "XMLHttpRequest", Referer: `${base(ctx)}/` },
    retries: 1,
  });
}

async function listing(ctx: Context, order: Record<string, string>, page: number, filters: FilterValues): Promise<Paged<MangaSummary>> {
  const genre = typeof filters.genre === "string" ? filters.genre : "";
  const html = await ajax(ctx, {
    action: "madara_load_more",
    page: String(page - 1),
    template: "madara-core/content/content-archive",
    "vars[paged]": String(page),
    "vars[post_type]": "wp-manga",
    "vars[post_status]": "publish",
    "vars[posts_per_page]": String(PER_PAGE),
    ...order,
    // comma-separated slugs match any of them
    ...(genre ? { "vars[wp-manga-genre]": genre } : {}),
  });
  const doc = ctx.html(html, base(ctx));
  const items = doc.all(".page-item-detail").flatMap((card): MangaSummary[] => {
    const link = card.one(".post-title a");
    const id = slugOf(link?.href() ?? null);
    if (!id || !link) return [];
    const img = card.one("img");
    return [
      {
        id,
        title: clean(link.text()),
        cover: fullSize(img?.href("data-src") ?? img?.href("src") ?? null),
        url: `${SITE}/manga/${id}/`,
        latestChapter: chapterNumber(card.one(".chapter a")?.text()),
      },
    ];
  });
  return { items, hasNext: items.length === PER_PAGE };
}

// manga() and chapters() read the same page, so it's kept briefly
const series = (ctx: Context, id: string) => ctx.http.doc(`${SITE}/manga/${encodeURIComponent(id)}/`, { resolve: ORIGIN, cacheMs: 5 * 60_000 });

const lekmanga = defineSource({
  id: "lekmanga",
  name: "LekManga",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 2, perMs: 1000 },
  images: { proxy: true, resolve: ORIGIN },
  listings: [
    { id: "popular", label: L("Most viewed", "الأكثر مشاهدة"), filters: true },
    { id: "latest", label: L("Latest updates", "آخر التحديثات"), filters: true },
    { id: "new", label: L("Recently added", "أُضيفت حديثاً"), filters: true },
    { id: "az", label: L("A–Z", "أبجدياً"), filters: true },
  ],
  async filters(ctx) {
    const doc = await ctx.http.doc(`${SITE}/?s=&post_type=wp-manga`, { resolve: ORIGIN });
    const genres = doc.all("input[name='genre[]']").flatMap((input) => {
      const slug = input.attr("value");
      const name = clean(doc.one(`label[for='${input.attr("id")}']`)?.text());
      if (!slug || !name) return [];
      try {
        return [{ id: decodeURIComponent(slug), name }];
      } catch {
        return [{ id: slug, name }];
      }
    });
    return [{ id: "genre", type: "select", label: L("Genre", "التصنيف"), options: genreOptions(genres) }];
  },
  searchFilters: true,
  settings: [
    {
      id: "mirror",
      type: "select",
      label: L("Address", "العنوان"),
      description: L("LekManga answers on several addresses; switch if one stops.", "يعمل مانجا ليك على عدة عناوين؛ بدّل إن توقف أحدها."),
      options: MIRRORS.map((m) => ({ value: m, label: new URL(m).host })),
      default: SITE,
    },
  ],

  list: (ctx, { listing: id, page, filters }) => listing(ctx, ORDER[id] ?? ORDER.popular, page, filters),

  // the list endpoint takes a search word and answers with the same cards, covers included
  search: (ctx, { query, page, filters }) => listing(ctx, { ...ORDER.popular, "vars[s]": query }, page, filters),

  async manga(ctx, id) {
    const doc = await series(ctx, id);
    const title = clean(doc.one(".post-title h1")?.text());
    if (!title) throw new SourceError("changed", "LekManga series page has no title");
    const info = Object.fromEntries(
      doc.all(".post-content_item").map((row) => [clean(row.one(".summary-heading")?.text()), clean(row.one(".summary-content")?.text())]),
    );
    const tags = doc.all(".genres-content a").map((a) => a.text()).filter(Boolean);
    const year = Number(info["سنة الانتاج"]);
    return {
      id,
      title,
      url: `${SITE}/manga/${id}/`,
      cover: fullSize(doc.one(".summary_image img")?.href() ?? null),
      type: [info["النوع"], ...tags].map(mangaType).find((t) => t && t !== "other"),
      status: status(info["الحالة"]),
      altTitles: known(info["اسماء اخرى"]),
      description: clean((doc.one(".description-summary .summary__content") ?? doc.one(".description-summary"))?.text()) || undefined,
      authors: known(info["المؤلف"]),
      artists: known(info["الرسام"]),
      genres: tags.filter((g) => !demographic(g) && mangaType(g) === "other").map((name) => ({ name, key: genreKey(name) })),
      demographic: tags.map(demographic).find(Boolean),
      year: Number.isInteger(year) && year > 1900 ? year : undefined,
    };
  },

  async chapters(ctx, id) {
    const doc = await series(ctx, id);
    return doc.all("li.wp-manga-chapter").flatMap((li): Chapter[] => {
      const a = li.one("a");
      const href = a?.href();
      const chapter = href?.match(/\/manga\/[^/]+\/([^?#]+?)\/?$/)?.[1];
      if (!a || !href || !chapter) return [];
      return [
        {
          id: decodeURIComponent(chapter),
          number: chapterNumber(a.text()) ?? chapterNumber(chapter.replace("-", ".")),
          lang: "ar",
          date: parseDate(li.one(".chapter-release-date")?.text()),
          url: href,
        },
      ];
    });
  },

  async pages(ctx, id, chapter) {
    const path = [id, ...chapter.split("/")].map(encodeURIComponent).join("/");
    const doc = await ctx.http.doc(`${SITE}/manga/${path}/`, { resolve: ORIGIN });
    const urls = doc
      .all("img.wp-manga-chapter-img")
      .map((img) => img.href())
      .filter((u): u is string => !!u && PAGE.test(u));
    return [...new Set(urls)].map((url) => ({ url }));
  },

  resolveUrl(url) {
    const m = url.match(/\/manga\/([^/?#]+)(?:\/([^?#]+?))?\/?(?:[?#]|$)/);
    if (!m) return null;
    return m[2] ? { mangaId: m[1], chapterId: decodeURIComponent(m[2]) } : { mangaId: m[1] };
  },
});

export default defineExtension({
  pkg: "storm.mangasto.lekmanga",
  name: "LekManga",
  version: "1.2.0",
  app: "mangasto",
  sources: [lekmanga],
});
