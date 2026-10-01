// LekManga — an Arabic Madara (WordPress) site. Its series and chapter pages sit
// behind a Cloudflare bot check, so storm lists and searches it through the
// endpoints its own pages use, and series open on LekManga to be read.

import {
  chapterNumber,
  clean,
  defineExtension,
  defineSource,
  type Context,
  type MangaSummary,
  type Paged,
  type Text,
} from "@storm-sources/sdk";

const MIRRORS = ["https://lekmanga.site", "https://mangalik.net", "https://like-manga.net"];
const PER_PAGE = 20;

const L = (en: string, ar: string): Text => ({ en, ar });

const base = (ctx: Context) => (MIRRORS.includes(String(ctx.settings.mirror)) ? String(ctx.settings.mirror) : MIRRORS[0]);
const slugOf = (url: string | null) => url?.match(/\/manga\/([^/?#]+)/)?.[1];
// WordPress keeps the original next to its "-110x150" thumbnails
const fullSize = (src: string | null) => src?.replace(/\?.*$/, "").replace(/-\d+x\d+(\.\w+)$/, "$1") ?? undefined;

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

async function listing(ctx: Context, order: Record<string, string>, page: number): Promise<Paged<MangaSummary>> {
  const html = await ajax(ctx, {
    action: "madara_load_more",
    page: String(page - 1),
    template: "madara-core/content/content-archive",
    "vars[paged]": String(page),
    "vars[post_type]": "wp-manga",
    "vars[post_status]": "publish",
    "vars[posts_per_page]": String(PER_PAGE),
    ...order,
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
        url: `${base(ctx)}/manga/${id}/`,
        latestChapter: chapterNumber(card.one(".chapter a")?.text()),
      },
    ];
  });
  return { items, hasNext: items.length === PER_PAGE };
}

const lekmanga = defineSource({
  id: "lekmanga",
  name: "LekManga",
  lang: "ar",
  baseUrl: MIRRORS[0],
  readOn: "site",
  rateLimit: { requests: 2, perMs: 1000 },
  listings: [
    { id: "popular", label: L("Most viewed", "الأكثر مشاهدة") },
    { id: "latest", label: L("Latest updates", "آخر التحديثات") },
    { id: "new", label: L("Recently added", "أُضيفت حديثاً") },
    { id: "az", label: L("A–Z", "أبجدياً") },
  ],
  filters: [],
  settings: [
    {
      id: "mirror",
      type: "select",
      label: L("Address", "العنوان"),
      description: L("LekManga answers on several addresses; switch if one stops.", "يعمل مانجا ليك على عدة عناوين؛ بدّل إن توقف أحدها."),
      options: MIRRORS.map((m) => ({ value: m, label: new URL(m).host })),
      default: MIRRORS[0],
    },
  ],

  list: (ctx, { listing: id, page }) => listing(ctx, ORDER[id] ?? ORDER.popular, page),

  // the list endpoint takes a search word and answers with the same cards, covers included
  search: (ctx, { query, page }) => listing(ctx, { ...ORDER.popular, "vars[s]": query }, page),

  manga: () => Promise.reject(new Error("read on LekManga")),
  chapters: () => Promise.reject(new Error("read on LekManga")),
  pages: () => Promise.reject(new Error("read on LekManga")),

  resolveUrl(url) {
    const id = slugOf(url);
    return id ? { mangaId: id } : null;
  },
});

export default defineExtension({
  pkg: "storm.mangasto.lekmanga",
  name: "LekManga",
  version: "1.0.0",
  app: "mangasto",
  sources: [lekmanga],
});
