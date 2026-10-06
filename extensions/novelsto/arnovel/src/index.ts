// Ar-Novel — Arabic translated web novels on a Madara (WordPress) site. Lists
// and search go through the theme's ajax endpoint, chapters through its
// chapter-list endpoint, and text is read from the chapter page.

import {
  SourceError,
  chapterNumber,
  clean,
  defineExtension,
  defineNovelSource,
  demographic,
  genreKey,
  genreOptions,
  htmlToBlocks,
  parseDate,
  status,
  year,
  type Chapter,
  type Context,
  type FilterValues,
  type NovelSummary,
  type Paged,
  type Text,
} from "@storm-sources/sdk";

const SITE = "https://ar-no.com";
const PER_PAGE = 20;
const L = (en: string, ar: string): Text => ({ en, ar });

const ORDER: Record<string, Record<string, string>> = {
  latest: { "vars[orderby]": "meta_value_num", "vars[meta_key]": "_latest_update", "vars[order]": "desc" },
  popular: { "vars[orderby]": "meta_value_num", "vars[meta_key]": "_wp_manga_views", "vars[order]": "desc" },
  new: { "vars[orderby]": "date", "vars[order]": "desc" },
  az: { "vars[orderby]": "post_title", "vars[order]": "asc" },
};

// The country of origin, as the site words it.
const ORIGIN: [RegExp, string][] = [
  [/صين/, "zh"],
  [/كوري/, "ko"],
  [/يابان/, "ja"],
  [/انجليز|إنجليز/, "en"],
  [/عرب/, "ar"],
];

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const slugOf = (url: string | null) => {
  const m = url?.match(/\/novel\/([^/?#]+)/)?.[1];
  return m ? decode(m) : undefined;
};
const novelUrl = (slug: string) => `${SITE}/novel/${encodeURIComponent(slug)}/`;
// WordPress keeps the original next to its "-175x238" thumbnails
const fullSize = (src: string | null | undefined) => src?.replace(/^http:/, "https:").replace(/\?.*$/, "").replace(/-\d+x\d+(\.\w+)$/, "$1") || undefined;
const isTag = (g: string) => !!demographic(g) || /^(منتهية|مكتملة|صينية|كورية|يابانية)$/.test(g);

async function listing(ctx: Context, order: Record<string, string>, page: number, filters: FilterValues): Promise<Paged<NovelSummary>> {
  const genre = typeof filters.genre === "string" ? filters.genre : "";
  const html = await ctx.http.text(`${SITE}/wp-admin/admin-ajax.php`, {
    method: "POST",
    form: {
      action: "madara_load_more",
      page: String(page - 1),
      template: "madara-core/content/content-archive",
      "vars[paged]": String(page),
      "vars[post_type]": "wp-manga",
      "vars[post_status]": "publish",
      "vars[posts_per_page]": String(PER_PAGE),
      ...order,
      ...(genre ? { "vars[wp-manga-genre]": genre } : {}),
    },
    headers: { "X-Requested-With": "XMLHttpRequest", Referer: `${SITE}/` },
    retries: 1,
  });
  const doc = ctx.html(html, SITE);
  const items = doc.all(".page-item-detail").flatMap((card): NovelSummary[] => {
    const link = card.one(".post-title a");
    const id = slugOf(link?.href() ?? null);
    if (!id || !link) return [];
    const img = card.one("img");
    return [
      {
        id,
        title: clean(link.text()),
        cover: fullSize(img?.href("data-src") ?? img?.href("src")),
        url: novelUrl(id),
        latestChapter: chapterNumber(card.one(".chapter a")?.text()),
      },
    ];
  });
  return { items, hasNext: items.length === PER_PAGE };
}

const arnovel = defineNovelSource({
  id: "arnovel",
  name: "Ar-Novel",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 2, perMs: 1000 },
  listings: [
    { id: "latest", label: L("Latest updates", "آخر التحديثات"), filters: true },
    { id: "popular", label: L("Most viewed", "الأكثر مشاهدة"), filters: true },
    { id: "new", label: L("Recently added", "أُضيفت حديثاً"), filters: true },
    { id: "az", label: L("A–Z", "أبجدياً"), filters: true },
  ],
  async filters(ctx) {
    const doc = await ctx.http.doc(`${SITE}/?s=&post_type=wp-manga`);
    const genres = doc.all("input[name='genre[]']").flatMap((input) => {
      const slug = input.attr("value");
      const name = clean(doc.one(`label[for='${input.attr("id")}']`)?.text());
      return slug && name ? [{ id: decode(slug), name }] : [];
    });
    return [{ id: "genre", type: "select", label: L("Genre", "التصنيف"), options: genreOptions(genres) }];
  },
  searchFilters: true,

  list: (ctx, { listing: id, page, filters }) => listing(ctx, ORDER[id] ?? ORDER.latest, page, filters),
  search: (ctx, { query, page, filters }) => listing(ctx, { ...ORDER.popular, "vars[s]": query }, page, filters),

  async details(ctx, id) {
    const doc = await ctx.http.doc(novelUrl(id));
    const title = clean(doc.one(".post-title h1")?.text());
    if (!title) throw new SourceError("changed", "Ar-Novel novel page has no title");
    const info = new Map(doc.all(".post-content_item").map((row) => [clean(row.one(".summary-heading")?.text()), clean(row.one(".summary-content")?.text())]));
    const field = (word: string) => [...info.entries()].find(([k]) => k.includes(word))?.[1] ?? "";
    const tags = doc.all(".genres-content a").map((a) => clean(a.text())).filter(Boolean);
    const origin = field("نوع");
    const img = doc.one(".summary_image img");
    const names = field("أسماء") || field("اسماء");
    return {
      id,
      title,
      url: novelUrl(id),
      cover: fullSize(img?.href("data-src") ?? img?.href("src")),
      status: status(field("الحالة")) === "unknown" && tags.includes("منتهية") ? "completed" : status(field("الحالة")),
      altTitles: names ? names.split(/[,،]/).map(clean).filter(Boolean) : [],
      description: clean((doc.one(".description-summary .summary__content") ?? doc.one(".summary__content"))?.text()) || undefined,
      authors: field("المؤلف") ? field("المؤلف").split(/[,،]/).map(clean).filter(Boolean) : [],
      translators: [],
      genres: tags.filter((g) => !isTag(g)).map((name) => ({ name, key: genreKey(name) })),
      year: year(field("سنة")),
      originalLang: ORIGIN.find(([re]) => re.test(origin))?.[1],
    };
  },

  async chapters(ctx, id) {
    const html = await ctx.http.text(`${novelUrl(id)}ajax/chapters/`, {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest", Referer: novelUrl(id) },
      retries: 1,
    });
    const doc = ctx.html(html, SITE);
    return doc.all("li.wp-manga-chapter").flatMap((li): Chapter[] => {
      const a = li.one("a");
      const href = a?.href();
      const chapter = href?.match(/\/novel\/[^/]+\/([^?#]+?)\/?$/)?.[1];
      if (!a || !href || !chapter) return [];
      const name = clean(a.text());
      return [
        {
          id: decode(chapter),
          number: chapterNumber(name) ?? chapterNumber(decode(chapter)),
          title: name.replace(/^[\d.]+\s*[-–:]\s*/, "") || undefined,
          lang: "ar",
          date: parseDate(li.one(".chapter-release-date")?.text()),
          url: href,
        },
      ];
    });
  },

  async content(ctx, novelId, chapterId) {
    const path = [novelId, ...chapterId.split("/")].map(encodeURIComponent).join("/");
    const doc = await ctx.http.doc(`${SITE}/novel/${path}/`);
    const body = doc.one(".reading-content .text-left") ?? doc.one(".reading-content");
    if (!body) throw new SourceError("changed", "Ar-Novel chapter page has no text");
    return { title: clean(doc.one("#chapter-heading")?.text()) || undefined, blocks: htmlToBlocks(body.html(), SITE) };
  },
});

export default defineExtension({
  pkg: "storm.novelsto.arnovel",
  name: "Ar-Novel",
  version: "1.0.0",
  app: "novelsto",
  sources: [arnovel],
});
