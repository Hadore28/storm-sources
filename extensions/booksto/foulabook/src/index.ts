// Foulabook — Arabic books as PDFs. The files are sent as downloads and refuse
// to be framed, so reading online goes through the Google viewer the site's own
// reader uses, next to the plain download.

import {
  SourceError,
  clean,
  defineBookSource,
  defineExtension,
  genreKey,
  type BookDetails,
  type BookFile,
  type BookSummary,
  type Context,
  type Doc,
  type FilterValues,
  type Paged,
  type Text,
} from "@storm-sources/sdk";

const SITE = "https://foulabook.com";
const L = (en: string, ar: string): Text => ({ en, ar });

// The site's categories, as its sidebar lists them.
const CATEGORIES = [
  "الأدب العربي", "الأدب العالمي", "قانون", "لغة", "صحة وطب", "فنون", "إقتصاد وأعمال", "بيوغرافيا ومذكرات", "كتب أطفال",
  "تاريخ وجغرافيا", "غرائب وأساطير", "صحافة وإعلام", "المرأة والعائلة", "مراجع", "كتب دينية", "علوم إسلامية",
  "العلوم والطبيعة", "كتب سياسية", "كتب الفلسفة", "علوم إجتماعية", "سفر ورحلات", "علوم عسكرية", "علم النفس",
  "كتب التنمية البشرية", "كتب منوعة", "كتب الخيال العلم", "كتب تعليم لغات", "علوم الحيوان", "كتب علوم الهندسة",
  "كتب الزراعة والإنتاج", "كتب طرائف ونوادر", "كتب تعليمية", "طبخ وطعام", "رياضة وتسالي", "قضايا فكرية", "مجلات",
  "الدراسات والأبحاث",
];

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const slugOf = (url: string | null) => {
  const m = url?.match(/\/ar\/book\/([^/?#]+)/)?.[1];
  return m ? decode(m) : undefined;
};
const bookUrl = (slug: string) => `${SITE}/ar/book/${encodeURIComponent(slug)}`;
// titles come wrapped in the site's phrasing: "تحميل كتاب … تأليف … pdf"
const cleanTitle = (t: string) => clean(t).replace(/^تحميل\s+كتاب\s*/, "").replace(/\s*تأليف\s+.*$/, "").replace(/\s*pdf\s*$/i, "").trim();

function cards(doc: Doc, page: number): Paged<BookSummary> {
  const items = doc.all("li.related-item").flatMap((li): BookSummary[] => {
    const id = slugOf(li.one("a[href*='/ar/book/']")?.href() ?? null);
    const img = li.one("img");
    const title = cleanTitle(img?.attr("alt") ?? li.one("h5")?.text() ?? "");
    if (!id || !title) return [];
    return [{ id, title, cover: img?.href("src") ?? undefined, url: bookUrl(id), authors: [] }];
  });
  const hasNext = doc.all(`a[href*='page=${page + 1}']`).length > 0;
  return { items, hasNext };
}

const category = (filters: FilterValues) => (typeof filters.category === "string" && CATEGORIES.includes(filters.category) ? filters.category : "");

const foulabook = defineBookSource({
  id: "foulabook",
  name: "Foulabook",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 2, perMs: 1000 },
  listings: [{ id: "latest", label: L("Latest books", "أحدث الكتب"), filters: true }],
  filters: [
    {
      id: "category",
      type: "select",
      label: L("Category", "التصنيف"),
      options: CATEGORIES.map((c) => ({ value: c, label: c, genre: genreKey(c) })),
    },
  ],

  async list(ctx, { page, filters }) {
    const cat = category(filters);
    const path = cat ? `/ar/books/${encodeURIComponent(cat.replace(/\s+/g, "-"))}` : "/ar/books";
    return cards(await ctx.http.doc(`${SITE}${path}`, { query: { page: page > 1 ? page : undefined } }), page);
  },

  async search(ctx, { query, page }) {
    return cards(await ctx.http.doc(`${SITE}/ar/searching`, { query: { search: query, page: page > 1 ? page : undefined } }), page);
  },

  async details(ctx, id): Promise<BookDetails> {
    const doc = await ctx.http.doc(bookUrl(id));
    const title = cleanTitle(doc.one("h1")?.text() ?? "");
    if (!title) throw new SourceError("changed", "Foulabook book page has no title");
    const info = new Map(
      doc.all(".portfolio-v-blog-item-info li").map((li) => {
        const [k, ...v] = clean(li.text()).split(":");
        return [clean(k), clean(v.join(":"))];
      }),
    );
    const field = (word: string) => [...info.entries()].find(([k]) => k.includes(word))?.[1] ?? "";
    const authors = doc
      .all("a[href*='/ar/author/']")
      .map((a) => clean(a.text()))
      .filter((n) => n && !n.startsWith("كتب أخرى"));
    const og = doc.one("meta[property='og:description']")?.attr("content") ?? "";
    const description = clean(og)
      .replace(/^تحميل\s+كتاب[\s\S]*?\bpdf\b\s*/i, "")
      .replace(/^الكاتب\s*/, "")
      .replace(new RegExp(`^${authors[0]?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") ?? "\\b\\B"}`), "")
      .replace(/هذا الكتاب من تأليف[\s\S]*$/, "")
      .trim();
    const genres = [...new Set([field("ﺘﺼﻨﻴﻒ") || field("التصنيف"), field("الفئة")].filter(Boolean))].map((name) => ({ name, key: genreKey(name) }));
    const size = field("الحجم").replace(/\bMo\b/, "MB").replace(/\bKo\b/, "KB");
    const pages = Number(field("الصفحات").replace(/[^\d]/g, ""));
    const download = doc.html().match(/\/book\/downloading\/(\d+)/)?.[1];
    const files: BookFile[] = [];
    const viewer = await viewerUrl(ctx, id);
    if (viewer) files.push({ format: "pdf", url: viewer, size: size || undefined, viewable: true });
    if (download) files.push({ format: "pdf", url: `${SITE}/book/downloading/${download}`, size: size || undefined });
    return {
      id,
      title,
      url: bookUrl(id),
      cover: doc.one("meta[property='og:image']")?.attr("content") ?? undefined,
      authors: [...new Set(authors)],
      altTitles: [],
      description: description || undefined,
      genres,
      pages: pages > 0 ? pages : undefined,
      lang: field("اللغة").includes("العربية") ? "ar" : field("اللغة").includes("الإنجليزية") ? "en" : undefined,
      files,
      readable: false,
    };
  },
});

// The site's reader frames its PDF in Google's viewer; the same address can be framed on storm.
async function viewerUrl(ctx: Context, id: string) {
  try {
    const html = await ctx.http.text(`${SITE}/ar/read/${encodeURIComponent(id)}`);
    const file = html.match(/docs\.google\.com\/viewer\?url=([^&"']+)/)?.[1];
    if (!file) return undefined;
    const pdf = new URL(decode(file).trim()).toString();
    return `https://docs.google.com/viewer?url=${encodeURIComponent(pdf)}&embedded=true`;
  } catch {
    return undefined;
  }
}

export default defineExtension({
  pkg: "storm.booksto.foulabook",
  name: "Foulabook",
  version: "1.0.0",
  app: "booksto",
  sources: [foulabook],
});
