// Shared by the live-TV sources: channel categories, country names, feeds and M3U playlists.

import { clean, type ChannelSummary, type Context, type FilterDef, type Paged, type Text, type VideoServer } from "@storm-sources/sdk";

export const L = (en: string, ar: string): Text => ({ en, ar });
export const PER_PAGE = 48;

export const CATEGORIES: Record<string, Text> = {
  general: L("General", "عامة"),
  news: L("News", "أخبار"),
  sports: L("Sports", "رياضة"),
  movies: L("Movies", "أفلام"),
  series: L("Series", "مسلسلات"),
  kids: L("Kids", "أطفال"),
  animation: L("Animation", "رسوم متحركة"),
  music: L("Music", "موسيقى"),
  religious: L("Religious", "دينية"),
  documentary: L("Documentary", "وثائقية"),
  education: L("Education", "تعليمية"),
  entertainment: L("Entertainment", "ترفيه"),
  comedy: L("Comedy", "كوميديا"),
  culture: L("Culture", "ثقافة"),
  cooking: L("Cooking", "طبخ"),
  family: L("Family", "عائلية"),
  lifestyle: L("Lifestyle", "أسلوب حياة"),
  business: L("Business", "اقتصاد"),
  science: L("Science", "علوم"),
  travel: L("Travel", "سفر"),
  outdoor: L("Outdoor", "طبيعة"),
  auto: L("Cars", "سيارات"),
  classic: L("Classic", "كلاسيكية"),
  legislative: L("Parliament", "برلمانية"),
  public: L("Public", "عامة رسمية"),
  weather: L("Weather", "طقس"),
  relax: L("Relax", "استرخاء"),
  shop: L("Shopping", "تسوّق"),
  interactive: L("Interactive", "تفاعلية"),
};

/** Lowercase key for a playlist's own group name, e.g. "News" → "news". */
export const categoryKey = (name: string) => clean(name).toLowerCase().replace(/\s+/g, "-");

const names = (lang: string) => {
  try {
    return new Intl.DisplayNames([lang], { type: "region" });
  } catch {
    return null;
  }
};
const EN = names("en");
const AR = names("ar");

export function countryLabel(code: string): Text {
  const c = code.toUpperCase();
  const flag = /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((x) => 0x1f1e6 + x.charCodeAt(0) - 65)) : "";
  const en = (() => {
    try {
      return EN?.of(c) ?? c;
    } catch {
      return c;
    }
  })();
  const ar = (() => {
    try {
      return AR?.of(c) ?? en;
    } catch {
      return en;
    }
  })();
  return flag ? L(`${flag} ${en}`, `${flag} ${ar}`) : L(en, ar);
}

/** The country in an iptv-org id like "AlJazeera.qa" or "2M.ma@SD". */
export const countryOfId = (id: string) => /\.([a-z]{2})(?:@|$)/.exec(id)?.[1]?.toUpperCase();

/** Country and category filters, from what the channels actually have; most common first. */
export function channelFilters(channels: { country?: string; categories?: string[] }[], labels: (key: string) => Text | string = (k) => CATEGORIES[k] ?? k): FilterDef[] {
  const countries = new Map<string, number>();
  const categories = new Map<string, number>();
  for (const c of channels) {
    if (c.country) countries.set(c.country, (countries.get(c.country) ?? 0) + 1);
    for (const g of c.categories ?? []) categories.set(g, (categories.get(g) ?? 0) + 1);
  }
  const byCount = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const filters: FilterDef[] = [];
  if (countries.size)
    filters.push({
      id: "country",
      type: "select",
      label: L("Country", "الدولة"),
      options: [{ value: "", label: L("All", "الكل") }, ...byCount(countries).map((c) => ({ value: c, label: countryLabel(c) }))],
      default: "",
    });
  if (categories.size)
    filters.push({
      id: "category",
      type: "select",
      label: L("Category", "التصنيف"),
      options: [{ value: "", label: L("All", "الكل") }, ...byCount(categories).map((g) => ({ value: g, label: labels(g) }))],
      default: "",
    });
  return filters;
}

export function paged<T>(items: T[], page: number): Paged<T> {
  const start = (page - 1) * PER_PAGE;
  return { items: items.slice(start, start + PER_PAGE), hasNext: items.length > start + PER_PAGE };
}

/** Folds a name for search: case, spacing and Arabic letter forms. */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\s\-_.]+/g, "");

export function filterChannels<T extends ChannelSummary & { names?: string }>(all: T[], filters: Record<string, unknown>, query = ""): T[] {
  const country = typeof filters.country === "string" ? filters.country : "";
  const category = typeof filters.category === "string" ? filters.category : "";
  const q = fold(query);
  const rows = all.filter((c) => (!country || c.country === country) && (!category || c.categories?.includes(category)) && (!q || fold(c.names ?? c.title).includes(q)));
  if (!q) return rows;
  // the name itself, then names starting with it, then a word starting with it
  const rank = (c: T) => {
    const t = fold(c.title);
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    return c.title.toLowerCase().split(/[\s\-_.]+/).some((w) => fold(w).startsWith(q)) ? 2 : 3;
  };
  return rows.map((c) => [rank(c), c] as const).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

export interface Feed {
  url: string;
  quality?: string;
  referrer?: string;
  userAgent?: string;
  label?: string;
}

const qRank = (q?: string) => parseInt(q ?? "", 10) || 0;

// third-party hosts that restream other broadcasters, and paid channels no free feed carries
const RESTREAMS = /^https?:\/\/([^/]*\.)?(primetv\.cc\.cd|bozztv\.com|magictvbox\.com)[:/]/i;
const PAID = /\b(bein|ssc|osn)\b/i;

/** A feed storm leaves out: a restream, or a paid channel. */
export const unwanted = (url: string, name = "") => RESTREAMS.test(url) || PAID.test(name);

/**
 * A channel's feeds as servers, best quality first. Plain-http feeds and feeds that need
 * a Referer can't play straight from an https page, so storm streams those.
 */
export function feedServers(feeds: Feed[]): VideoServer[] {
  return [...feeds]
    .filter((f) => /^https?:\/\//.test(f.url) && !/\.(mpd|ts)(\?|$)/i.test(f.url) && !/(youtube\.com|youtu\.be|twitch\.tv|dailymotion\.com)\//.test(f.url))
    .sort((a, b) => qRank(b.quality) - qRank(a.quality))
    .map((f, i) => {
      const host = new URL(f.url).host.replace(/^www\./, "");
      return {
        name: f.label || `${i + 1} · ${host}`,
        url: f.url,
        kind: /\.mp4(\?|$)/i.test(f.url) ? "mp4" : "hls",
        quality: f.quality || undefined,
        referer: f.referrer || (f.url.startsWith("http://") ? `${new URL(f.url).origin}/` : undefined),
      } satisfies VideoServer;
    });
}

export interface M3uEntry extends Feed {
  title: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  country?: string;
}

const ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;

export function parseM3u(text: string): M3uEntry[] {
  const out: M3uEntry[] = [];
  let cur: M3uEntry | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const attrs: Record<string, string> = {};
      for (const m of line.matchAll(ATTR)) attrs[m[1].toLowerCase()] = m[2];
      const name = line.slice(line.lastIndexOf(",") + 1).trim();
      cur = {
        title: name || attrs["tvg-name"] || attrs["tvg-id"] || "",
        logo: attrs["tvg-logo"] || undefined,
        group: attrs["group-title"] || undefined,
        tvgId: attrs["tvg-id"] || undefined,
        country: (attrs["tvg-country"] || "").split(/[;,]/)[0].toUpperCase() || undefined,
        referrer: attrs["http-referrer"] || undefined,
        userAgent: attrs["http-user-agent"] || undefined,
        url: "",
      };
    } else if (line.startsWith("#EXTGRP:")) {
      if (cur && !cur.group) cur.group = line.slice(8).trim();
    } else if (line.startsWith("#EXTVLCOPT:")) {
      const [k, ...v] = line.slice(11).split("=");
      if (cur && /^http-referrer$/i.test(k)) cur.referrer = v.join("=");
      if (cur && /^http-user-agent$/i.test(k)) cur.userAgent = v.join("=");
    } else if (!line.startsWith("#") && cur) {
      cur.url = line;
      out.push(cur);
      cur = null;
    }
  }
  return out;
}

/** "Channel (1080p) [Geo-blocked]" → name "Channel", quality "1080p". */
export function splitTitle(title: string) {
  const quality = /\((\d{3,4}p)\)/.exec(title)?.[1];
  const name = clean(title.replace(/\(\d{3,4}p\)|\[[^\]]*\]|[ⓈⓉⓎⒼⓋ]/g, ""));
  return { name, quality };
}

export function shortId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Keeps a slow-built catalog in memory for a while, shared by every call. */
export function memo<T>(ttlMs: number, build: (ctx: Context) => Promise<T>) {
  let at = 0;
  let value: Promise<T> | null = null;
  return (ctx: Context) => {
    if (!value || Date.now() - at > ttlMs) {
      at = Date.now();
      value = build(ctx).catch((e) => {
        value = null;
        throw e;
      });
    }
    return value;
  };
}
