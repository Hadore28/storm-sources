// Team X (olympustaff.com) — an Arabic scanlation site, read from its HTML pages.

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
  type Doc,
  type El,
  type FilterValues,
  type MangaSummary,
  type Paged,
  type Text,
} from "@storm-sources/sdk";

const SITE = "https://olympustaff.com";
// Long series run to a hundred pages of chapters; past this the site is asked too much.
const MAX_CHAPTER_PAGES = 120;

const L = (en: string, ar: string): Text => ({ en, ar });

const slugOf = (href: string | null) => href?.match(/\/series\/([^/?#]+)\/?$/)?.[1];
// Lists link small "thumbnail_" covers; the same file without the prefix is full size.
const fullCover = (src: string | null) => src?.replace(/\/thumbnail_/i, "/") ?? undefined;

/** Catalogue and search cards: a link to /series/<slug> holding the cover, title, status and type. */
function cards(doc: Doc | El): MangaSummary[] {
  const out = new Map<string, MangaSummary>();
  for (const a of doc.all("a[href*='/series/']")) {
    const slug = slugOf(a.href());
    if (!slug || slug === "add" || out.has(slug)) continue;
    const img = a.one("img");
    const title = clean(a.attr("title") || a.one("h4, h3, .tt")?.text() || img?.attr("alt"));
    if (!title || !img) continue;
    out.set(slug, {
      id: slug,
      title,
      cover: fullCover(img.href("data-src") ?? img.href("src")),
      url: `${SITE}/series/${slug}`,
      status: a.one(".status") ? status(a.one(".status")!.text()) : undefined,
      type: a.one(".type") ? mangaType(a.one(".type")!.text()) : undefined,
    });
  }
  return [...out.values()];
}

const hasNext = (doc: Doc, page: number) => doc.all(".pagination a").some((a) => Number(a.href()?.match(/[?&]page=(\d+)/)?.[1]) > page);

async function latest(ctx: Context, page: number): Promise<Paged<MangaSummary>> {
  const doc = await ctx.http.doc(`${SITE}/`, { query: { page }, cacheMs: 3 * 60_000 });
  // each update block: cover, title and the newest chapters
  const items = doc.all(".uta").flatMap((u): MangaSummary[] => {
    const link = u.one(".imgu a");
    const slug = slugOf(link?.href() ?? null);
    const title = clean(u.one(".info h3")?.text() || link?.one("img")?.attr("alt"));
    if (!slug || !title) return [];
    return [
      {
        id: slug,
        title,
        cover: fullCover(link?.one("img")?.href("src") ?? null),
        url: `${SITE}/series/${slug}`,
        latestChapter: chapterNumber(u.one(".info li a")?.text()),
      },
    ];
  });
  return { items, hasNext: hasNext(doc, page) };
}

async function catalogue(ctx: Context, page: number, filters: FilterValues): Promise<Paged<MangaSummary>> {
  const doc = await ctx.http.doc(`${SITE}/series`, {
    query: { page, genre: filters.genre as string | undefined, type: filters.type as string | undefined, state: filters.state as string | undefined },
    cacheMs: 5 * 60_000,
  });
  return { items: cards(doc.one(".listupd") ?? doc), hasNext: hasNext(doc, page) };
}

function chapterCards(doc: Doc, slug: string): Chapter[] {
  return doc.all(".chapter-card").flatMap((card): Chapter[] => {
    const href = card.one("a")?.href();
    const id = href?.match(new RegExp(`/series/${slug}/([^/?#]+)`))?.[1];
    if (!id) return [];
    const text = card.text();
    const named = clean(card.one(".chapter-title, .chapter-info h3, h3")?.text());
    return [
      {
        id: decodeURIComponent(id),
        number: Number(card.attr("data-number")) || chapterNumber(id) || chapterNumber(text),
        // "الفصل رقم 15" only repeats the number
        title: named && !/^(الفصل|فصل)(\s*رقم)?\s*[\d.]+$/.test(named) ? named : undefined,
        lang: "ar",
        date: parseDate(text.match(/(\d+\s+\w+\s+ago|منذ\s+.+)$/i)?.[1] ?? card.one("time, .chapter-date, small")?.text()),
        url: href!,
      },
    ];
  });
}

const teamx = defineSource({
  id: "teamx",
  name: "Team X",
  lang: "ar",
  baseUrl: SITE,
  icon: `${SITE}/assets/images/favicon.png`,
  rateLimit: { requests: 3, perMs: 1000 },
  headers: { Referer: `${SITE}/` },
  listings: [
    { id: "latest", label: L("Latest updates", "آخر التحديثات") },
    { id: "all", label: L("All series", "كل الأعمال"), filters: true },
  ],
  async filters(ctx) {
    const doc = await ctx.http.doc(`${SITE}/series`, { cacheMs: 24 * 3_600_000 });
    const options = (name: string) =>
      doc
        .all(`select[name='${name}'] option`)
        .map((o) => ({ value: o.attr("value") ?? "", label: o.text() }))
        .filter((o) => o.value);
    const genres = options("genre").map((o) => ({ id: o.value, name: o.label }));
    return [
      // the site takes one genre at a time
      { id: "genre", type: "select", label: L("Genre", "التصنيف"), options: genreOptions(genres, "|").map((o) => ({ ...o, value: o.value.split("|")[0] })) },
      { id: "type", type: "select", label: L("Type", "النوع"), options: options("type") },
      { id: "state", type: "select", label: L("Status", "الحالة"), options: options("state") },
    ];
  },

  list: (ctx, { listing, page, filters }) => (listing === "latest" ? latest(ctx, page) : catalogue(ctx, page, filters)),

  async search(ctx, { query }) {
    const html = await ctx.http.text(`${SITE}/ajax/search`, { query: { keyword: query }, headers: { "X-Requested-With": "XMLHttpRequest" } });
    return { items: cards(ctx.html(html, SITE)), hasNext: false };
  },

  async manga(ctx, slug) {
    const doc = await ctx.http.doc(`${SITE}/series/${slug}`);
    const title = clean(doc.one(".author-info-title h1, .author-info-title h6, .author-info-title")?.text());
    if (!title) throw new SourceError("changed", "Team X series page has no title");
    const info = Object.fromEntries(
      doc.all(".full-list-info").map((row) => {
        const [k, ...v] = row.text().split(":");
        return [clean(k), clean(v.join(":"))];
      }),
    );
    const names = (v?: string) => (v && !/غير معروف/.test(v) ? v.split(/[,،]/).map(clean).filter(Boolean) : []);
    const genres = doc.all("a[href*='genre=']").map((a) => a.text()).filter(Boolean);
    return {
      id: slug,
      title,
      cover: doc.one(".text-right img, .whitebox img, .thumb img")?.href("src") ?? undefined,
      url: `${SITE}/series/${slug}`,
      type: mangaType(info["النوع"]),
      status: status(info["الحالة"]),
      altTitles: names(info["الأسماء الأخرى"] ?? info["أسماء أخرى"]),
      description: clean(doc.one(".review-content")?.text()) || undefined,
      authors: names(info["المؤلف"] ?? info["الكاتب"]),
      artists: names(info["الرسام"]),
      genres: genres.filter((g) => !demographic(g) && mangaType(g) === "other").map((name) => ({ name, key: genreKey(name) })),
      demographic: genres.map(demographic).find(Boolean),
    };
  },

  async chapters(ctx, slug) {
    const first = await ctx.http.doc(`${SITE}/series/${slug}`);
    const last = Math.min(
      MAX_CHAPTER_PAGES,
      Math.max(1, ...first.all(".pagination a").map((a) => Number(a.href()?.match(/[?&]page=(\d+)/)?.[1]) || 1)),
    );
    const out = chapterCards(first, slug);
    // a few pages at a time, so a long series doesn't flood the site
    for (let p = 2; p <= last; p += 4) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(4, last - p + 1) }, (_, i) => ctx.http.doc(`${SITE}/series/${slug}`, { query: { page: p + i } })),
      );
      for (const doc of batch) out.push(...chapterCards(doc, slug));
    }
    return out;
  },

  async pages(ctx, slug, chapterId) {
    const doc = await ctx.http.doc(`${SITE}/series/${slug}/${encodeURIComponent(chapterId)}`);
    // page images live under /uploads/; the site logo, ads and icons don't
    return doc
      .all(".image_list img")
      .map((img) => img.href("data-src") ?? img.href("src"))
      .filter((u): u is string => !!u && /\/uploads\//.test(u))
      .map((url) => ({ url }));
  },

  resolveUrl(url) {
    const m = url.match(/olympustaff\.com\/series\/([^/?#]+)(?:\/([^/?#]+))?/);
    return m ? { mangaId: m[1], chapterId: m[2] } : null;
  },
});

export default defineExtension({
  pkg: "storm.mangasto.teamx",
  name: "Team X",
  version: "1.0.0",
  app: "mangasto",
  sources: [teamx],
});
