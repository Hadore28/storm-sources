// Wikisource — public-domain books with their full text, in Arabic and English,
// through the MediaWiki API. A book is a page, its sections are its subpages,
// and each section is read as text on storm.

import {
  SourceError,
  clean,
  defineBookSource,
  defineExtension,
  htmlToBlocks,
  type BookDetails,
  type BookSource,
  type BookSummary,
  type Chapter,
  type Context,
  type FilterValues,
  type Paged,
  type Text,
} from "@storm-sources/sdk";

const PER_PAGE = 40;
const L = (en: string, ar: string): Text => ({ en, ar });
// Wikimedia asks every client to name itself and give a way to reach it.
const AGENT = "storm/1.0 (https://stormd.site; book reader) storm-sources";

interface Edition {
  id: string;
  lang: "ar" | "en";
  name: Text;
  categoryPrefix: string;
  /** hand-checked works that exist with their parts, and a Commons image for each where there is one */
  featured: [string, string?][];
  shelves: { id: string; label: Text }[];
}

const AR: Edition = {
  id: "wikisource-ar",
  lang: "ar",
  name: L("Wikisource (Arabic)", "ويكي مصدر"),
  categoryPrefix: "تصنيف:",
  featured: [
    ["كليلة ودمنة", "Kalila wa Dimna BNF Arabe 3465, folio 34r.jpg"],
    ["ألف ليلة وليلة", "Sughrat.jpg"],
    ["مقدمة ابن خلدون", "La Muqaddima d'Ibn Khaldoun.jpg"],
    ["رسالة الغفران", "Resalat Al-Ghufran book cover, Commerial library edition (1923).jpg"],
    ["طوق الحمامة", "WarnerUBL.jpg"],
    ["تاريخ الطبري", "The Iranian King Jamshid instructing a group in the essential crafts (f. 20). Tarikh of Tabari, 1470, Herat (Chester Beatty, MS. Pers. 144).jpg"],
    ["مغامرات توم سوير", "Tom Sawyer 1876 frontispiece.jpg"],
    ["النظرات"],
    ["الأدب الصغير (1911)"],
    ["الأدب الكبير"],
    ["العقد الفريد (1953)"],
    ["الأخلاق والسير في مداواة النفوس"],
    ["الأطفال الخمسة وعفريت الرمال"],
  ],
  shelves: [
    { id: "أدب", label: L("Literature", "أدب") },
    { id: "علوم", label: L("Science", "علوم") },
    { id: "تاريخ", label: L("History", "تاريخ") },
    { id: "فلسفة", label: L("Philosophy", "فلسفة") },
    { id: "روايات", label: L("Novels", "روايات") },
  ],
};

const EN: Edition = {
  id: "wikisource-en",
  lang: "en",
  name: L("Wikisource (English)", "ويكي مصدر (الإنجليزية)"),
  categoryPrefix: "Category:",
  featured: [
    ["Pride and Prejudice (1813)", "PrideAndPrejudiceTitlePage.jpg"],
    ["Frankenstein, or the Modern Prometheus (Revised Edition, 1831)", "Christie's auction scan of Frankenstein 1818.jpg"],
    ["Dracula", "Dracula-First-Edition-1897.jpg"],
    ["Alice's Adventures in Wonderland (1866)", "AlicesAdventuresInWonderlandTitlePage.jpg"],
    ["The Adventures of Sherlock Holmes (1892, US)", "Adventures of sherlock holmes.jpg"],
    ["The Time Machine (Heinemann text)", "The Time Machine – Frontpage Heinemann.png"],
    ["Moby-Dick (1851) US edition", "Moby-Dick FE title page.jpg"],
    ["Treasure Island (1883)", "Treasure Island-Scribner's-1911.jpg"],
    ["The Picture of Dorian Gray (1891)", "Lippincott doriangray.jpg"],
    ["The Wonderful Wizard of Oz", "The Wonderful Wizard of Oz, 006.png"],
    ["The Call of the Wild (London)", "JackLondoncallwild.jpg"],
    ["The Jungle Book (Century edition)", "JunglebookCover.jpg"],
    ["Anne of Green Gables (1908)", "Montgomery Anne of Green Gables.jpg"],
    ["Little Women", "Houghton AC85.Aℓ194L.1869 pt.2aa - Little Women, title.jpg"],
    ["The Hound of the Baskervilles (Newnes, 1902)", "Cover (Hound of Baskervilles, 1902).jpg"],
    ["The Secret Garden", "Secret Garden-Kirk-0011.jpg"],
    ["Walden (1893) Thoreau", "Walden Thoreau.jpg"],
    ["The Republic of Plato", "Politeia beginning. Codex Parisinus graecus 1807.jpg"],
    ["The Art of War (Sun)", "The Art of War-Tangut script.jpg"],
    ["The Prince (Marriott)", "Nicolo Machiavelli, Il Principe, 1550, title page.jpg"],
    ["Meditations on First Philosophy", "Meditationes de prima philosophia 1641.jpg"],
  ],
  shelves: [
    { id: "Novels", label: L("Novels", "روايات") },
    { id: "Poetry", label: L("Poetry", "شعر") },
    { id: "Short stories", label: L("Short stories", "قصص قصيرة") },
    { id: "Plays", label: L("Plays", "مسرحيات") },
    { id: "Essays", label: L("Essays", "مقالات") },
    { id: "Philosophy", label: L("Philosophy", "فلسفة") },
    { id: "History", label: L("History", "تاريخ") },
    { id: "Children's literature", label: L("Children's books", "كتب أطفال") },
    { id: "Biographies", label: L("Biographies", "سير") },
  ],
};

const commons = (file: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=480`;

// Pages that are notes, not works: namespaces some editions keep in the main one.
const NOT_A_BOOK = /^(مستخدم|فهرس|مؤلف|تصنيف|نقاش|قالب|ويكي|User|Index|Author|Category|Talk|Template|Wikisource|Page|Portal|Help|File)\s*:/;

function edition(ed: Edition): BookSource {
  const host = `https://${ed.lang}.wikisource.org`;
  const covers = new Map(ed.featured.filter(([, f]) => f).map(([t, f]) => [t, commons(f!)]));
  const pageUrl = (title: string) => `${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const book = (title: string): BookSummary => ({ id: title, title, cover: covers.get(title), url: pageUrl(title), authors: [] });

  const api = <T>(ctx: Context, params: Record<string, string>, cacheMs?: number) =>
    ctx.http.json<T>(`${host}/w/api.php`, { query: { format: "json", formatversion: "2", ...params }, cacheMs });

  // Every page under the book, in reading order: the book links its parts in
  // order, and parts it doesn't link follow alphabetically.
  async function parts(ctx: Context, title: string): Promise<string[]> {
    const [all, page] = await Promise.all([
      api<{ query?: { allpages: { title: string }[] } }>(ctx, { action: "query", list: "allpages", apprefix: `${title}/`, apnamespace: "0", aplimit: "500" }, 30 * 60_000),
      api<{ parse?: { text: string } }>(ctx, { action: "parse", page: title, prop: "text", redirects: "1" }, 30 * 60_000).catch(() => ({ parse: undefined })),
    ]);
    const titles = new Set((all.query?.allpages ?? []).map((p) => p.title));
    // the parsed page's links in the order they appear (the links API sorts them)
    const linked = [...(page.parse?.text ?? "").matchAll(/href="\/wiki\/([^"#?]+)"/g)]
      .map((m) => {
        try {
          return decodeURIComponent(m[1]).replace(/_/g, " ");
        } catch {
          return "";
        }
      })
      .filter((t) => titles.has(t));
    const ordered = [...new Set(linked)];
    // a part's own subparts come right after it
    const rest = [...titles].filter((t) => !ordered.includes(t)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const out: string[] = [];
    for (const t of ordered) {
      out.push(t);
      for (const sub of rest) if (sub.startsWith(`${t}/`) && !out.includes(sub)) out.push(sub);
    }
    for (const t of rest) if (!out.includes(t)) out.push(t);
    return out;
  }

  async function shelf(ctx: Context, category: string, page: number): Promise<Paged<BookSummary>> {
    const d = await api<{ query?: { categorymembers: { title: string }[] } }>(ctx, {
      action: "query",
      list: "categorymembers",
      cmtitle: `${ed.categoryPrefix}${category}`,
      cmnamespace: "0",
      cmlimit: "500",
      cmsort: "sortkey",
    }, 60 * 60_000);
    const all = (d.query?.categorymembers ?? []).map((m) => m.title).filter((t) => !t.includes("/") && !NOT_A_BOOK.test(t) && !/^[.…]/.test(t));
    const start = (page - 1) * PER_PAGE;
    return { items: all.slice(start, start + PER_PAGE).map(book), hasNext: all.length > start + PER_PAGE };
  }

  return defineBookSource({
    id: ed.id,
    name: typeof ed.name === "string" ? ed.name : ed.name.en,
    lang: ed.lang,
    baseUrl: host,
    headers: { "User-Agent": AGENT, "Api-User-Agent": AGENT },
    rateLimit: { requests: 5, perMs: 1000 },
    listings: [
      { id: "featured", label: L("Classics", "روائع") },
      { id: "shelves", label: L("Shelves", "الرفوف"), filters: true },
    ],
    filters: [{ id: "shelf", type: "select", label: L("Shelf", "الرف"), options: ed.shelves.map((s) => ({ value: s.id, label: s.label })), default: ed.shelves[0].id }],

    async list(ctx, { listing, page, filters }) {
      if (listing === "featured") return { items: page === 1 ? ed.featured.map(([t]) => book(t)) : [], hasNext: false };
      const chosen = (filters as FilterValues).shelf;
      const category = typeof chosen === "string" && ed.shelves.some((s) => s.id === chosen) ? chosen : ed.shelves[0].id;
      return shelf(ctx, category, page);
    },

    async search(ctx, { query, page }) {
      const d = await api<{ query?: { search: { title: string }[] }; continue?: unknown }>(ctx, {
        action: "query",
        list: "search",
        srsearch: query,
        srnamespace: "0",
        srlimit: String(PER_PAGE),
        sroffset: String((page - 1) * PER_PAGE),
      });
      // a hit inside a book stands for the book
      const titles = [...new Set((d.query?.search ?? []).map((s) => s.title.split("/")[0]))].filter((t) => !NOT_A_BOOK.test(t));
      return { items: titles.map(book), hasNext: !!d.continue };
    },

    async details(ctx, id): Promise<BookDetails> {
      const [info, parsed] = await Promise.all([
        api<{ query?: { pages: { title: string; missing?: boolean; extract?: string; pageprops?: { disambiguation?: string; wikibase_item?: string } }[] } }>(ctx, {
          action: "query",
          titles: id,
          prop: "extracts|pageprops",
          exintro: "1",
          explaintext: "1",
          redirects: "1",
        }),
        api<{ parse?: { text: string } }>(ctx, { action: "parse", page: id, prop: "text", redirects: "1" }).catch(() => ({ parse: undefined })),
      ]);
      const p = info.query?.pages?.[0];
      if (!p || p.missing) throw new SourceError("not-found", `Wikisource has no page "${id}"`);
      const doc = ctx.html(parsed.parse?.text ?? "", host);
      const authors = [doc.one("#ws-author")?.text(), doc.one(".ws-author")?.text()]
        .map((a) => clean(a).replace(/^by\s+/i, ""))
        .filter(Boolean);
      const sections = await parts(ctx, p.title);
      // an intro that only repeats the table of contents isn't a description
      const extract = clean(p.extract);
      const listy = sections.filter((s) => extract.includes(s.slice(p.title.length + 1))).length >= 2;
      return {
        ...book(p.title),
        cover: covers.get(p.title) ?? (await wikidataImage(ctx, p.pageprops?.wikibase_item)),
        authors: [...new Set(authors)],
        altTitles: [],
        description: !listy && extract.length > 40 ? extract.slice(0, 1200) : undefined,
        genres: [],
        lang: ed.lang,
        files: [],
        readable: p.pageprops?.disambiguation === undefined,
      };
    },

    async sections(ctx, id): Promise<Chapter[]> {
      const list = await parts(ctx, id);
      // a work on a single page is its own only section
      if (!list.length) return [{ id, title: id, lang: ed.lang, url: pageUrl(id) }];
      return list.map((t, i) => ({ id: t, number: i + 1, title: t.slice(id.length + 1).replace(/\//g, " — "), lang: ed.lang, url: pageUrl(t) }));
    },

    async content(ctx, bookId, sectionId) {
      if (sectionId !== bookId && !sectionId.startsWith(`${bookId}/`)) throw new SourceError("not-found", `${sectionId} is not part of ${bookId}`);
      const d = await api<{ parse?: { title: string; text: string } }>(ctx, { action: "parse", page: sectionId, prop: "text", disableeditsection: "1", disabletoc: "1", redirects: "1" });
      if (!d.parse?.text) throw new SourceError("not-found", `Wikisource has no page "${sectionId}"`);
      const body = ctx
        .html(d.parse.text, host)
        .without("#dynamic_layout_overrider", "[style*='display:none']", "[style*='display: none']", ".ws-header", ".wst-header", "#headertemplate", ".noprint", ".metadata", ".navbox", ".ws-noexport", ".mw-editsection", "sup.reference", ".reference", ".mw-references-wrap", ".references", "style", ".licenseContainer", ".mw-empty-elt");
      const blocks = htmlToBlocks(body.html(), host).filter((b) => b.type !== "image" || !/\/(?:\d+px-)?(?:Wikisource-logo|Cc-|PD-|Public_domain)/i.test(b.src));
      return { title: sectionId === bookId ? d.parse.title : sectionId.slice(bookId.length + 1).replace(/\//g, " — "), blocks };
    },
  });
}

// A book's own image on Wikidata, or failing that, the image of the work it's an edition of.
async function wikidataImage(ctx: Context, item?: string): Promise<string | undefined> {
  if (!item || !/^Q\d+$/.test(item)) return undefined;
  type Claims = { claims?: Record<string, { mainsnak?: { datavalue?: { value?: string | { id?: string } } } }[]> };
  const claims = (id: string, property: string) =>
    ctx.http.json<Claims>("https://www.wikidata.org/w/api.php", { query: { action: "wbgetclaims", format: "json", entity: id, property }, cacheMs: 24 * 3_600_000 }).catch(() => ({}) as Claims);
  const own = (await claims(item, "P18")).claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (typeof own === "string") return commons(own);
  const work = (await claims(item, "P629")).claims?.P629?.[0]?.mainsnak?.datavalue?.value;
  const workId = typeof work === "object" ? work?.id : undefined;
  if (!workId) return undefined;
  const img = (await claims(workId, "P18")).claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return typeof img === "string" ? commons(img) : undefined;
}

export default defineExtension({
  pkg: "storm.booksto.wikisource",
  name: "Wikisource",
  version: "1.0.0",
  app: "booksto",
  sources: [edition(AR), edition(EN)],
});
