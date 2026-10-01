// Every answer an extension gives is checked and tidied here before the site
// sees it. A broken answer becomes a "changed" error naming what was wrong,
// which is how the admin learns a site changed its layout.

import {
  GENRES,
  SourceError,
  clean,
  type Chapter,
  type FilterDef,
  type MangaDetails,
  type MangaSummary,
  type PageRef,
  type Paged,
} from "@storm-sources/sdk";

const isHttp = (u: unknown): u is string => typeof u === "string" && /^https?:\/\/[^\s]+$/.test(u);
const isIso = (d: unknown) => typeof d === "string" && !Number.isNaN(Date.parse(d));
const STATUSES = new Set(["ongoing", "completed", "hiatus", "cancelled", "unknown"]);
const TYPES = new Set(["manga", "manhwa", "manhua", "comic", "other"]);
const GENRE_SET = new Set<string>(GENRES);

function fail(what: string, detail?: unknown): never {
  throw new SourceError("changed", what, detail);
}

function summary(m: MangaSummary, where: string): MangaSummary {
  if (typeof m?.id !== "string" || !m.id.trim()) fail(`${where}: an item has no id`, m);
  const title = clean(m.title);
  if (!title) fail(`${where}: item ${m.id} has no title`, m);
  return {
    id: m.id.trim(),
    title,
    cover: isHttp(m.cover) ? m.cover : undefined,
    url: isHttp(m.url) ? m.url : undefined,
    type: m.type && TYPES.has(m.type) ? m.type : undefined,
    status: m.status && STATUSES.has(m.status) ? m.status : undefined,
    latestChapter: Number.isFinite(m.latestChapter) ? m.latestChapter : undefined,
    updatedAt: isIso(m.updatedAt) ? new Date(m.updatedAt!).toISOString() : undefined,
    rating: m.rating,
  };
}

export function checkPaged(p: Paged<MangaSummary>, where: string): Paged<MangaSummary> {
  if (!p || !Array.isArray(p.items)) fail(`${where}: no list returned`, p);
  const seen = new Set<string>();
  const items = p.items.map((m) => summary(m, where)).filter((m) => !seen.has(m.id) && seen.add(m.id));
  return { items, hasNext: !!p.hasNext && items.length > 0 };
}

export function checkDetails(m: MangaDetails, where: string): MangaDetails {
  const base = summary(m, where);
  return {
    ...base,
    altTitles: [...new Set((m.altTitles ?? []).map(clean).filter((t) => t && t !== base.title))],
    description: clean(m.description) || undefined,
    authors: [...new Set((m.authors ?? []).map(clean).filter(Boolean))],
    artists: [...new Set((m.artists ?? []).map(clean).filter(Boolean))],
    genres: (m.genres ?? [])
      .map((g) => ({ name: clean(g.name), key: g.key && GENRE_SET.has(g.key) ? g.key : undefined }))
      .filter((g) => g.name),
    demographic: m.demographic,
    year: Number.isInteger(m.year) && m.year! > 1900 && m.year! < 2100 ? m.year : undefined,
    originalLang: m.originalLang,
    links: m.links,
  };
}

export function checkChapters(list: Chapter[], where: string): Chapter[] {
  if (!Array.isArray(list)) fail(`${where}: no chapter list returned`, list);
  const seen = new Set<string>();
  const out: Chapter[] = [];
  for (const c of list) {
    if (typeof c?.id !== "string" || !c.id.trim()) fail(`${where}: a chapter has no id`, c);
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (!c.lang) fail(`${where}: chapter ${c.id} has no language`, c);
    out.push({
      id: c.id.trim(),
      number: Number.isFinite(c.number) ? c.number : undefined,
      volume: Number.isFinite(c.volume) ? c.volume : undefined,
      title: clean(c.title) || undefined,
      lang: c.lang,
      date: isIso(c.date) ? new Date(c.date!).toISOString() : undefined,
      group: clean(c.group) || undefined,
      url: isHttp(c.url) ? c.url : undefined,
      external: !!c.external,
      pages: Number.isInteger(c.pages) ? c.pages : undefined,
    });
  }
  // Newest first: by number when both have one, otherwise keep the source's order.
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.number !== undefined && b.c.number !== undefined && a.c.number !== b.c.number ? b.c.number - a.c.number : a.i - b.i))
    .map(({ c }) => c);
}

export function checkPages(pages: PageRef[], where: string): PageRef[] {
  if (!Array.isArray(pages) || pages.length === 0) fail(`${where}: the chapter has no pages`, pages);
  return pages.map((p, i) => {
    if (!isHttp(p?.url)) fail(`${where}: page ${i + 1} has no usable address`, p);
    return { url: p.url, width: p.width, height: p.height };
  });
}

export function checkFilters(filters: FilterDef[], where: string): FilterDef[] {
  if (!Array.isArray(filters)) fail(`${where}: filters are not a list`, filters);
  const ids = new Set<string>();
  for (const f of filters) {
    if (!f?.id || ids.has(f.id)) fail(`${where}: filter ids must be unique`, f);
    ids.add(f.id);
    if ("options" in f && (!Array.isArray(f.options) || f.options.length === 0)) fail(`${where}: filter ${f.id} has no options`, f);
  }
  return filters;
}
