// AnimeWitcher — what the Android app reads as a guest: its Firestore documents
// (details, episodes, servers) and its Algolia indexes (new episodes, search),
// with the search key the app itself publishes in Settings/constants.

import {
  SourceError,
  animeType,
  clean,
  defineAnimeSource,
  defineExtension,
  demographic,
  genreKey,
  minutes,
  status,
  type AnimeDetails,
  type AnimeSummary,
  type Context,
  type Episode,
  type Paged,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";
import { withDirect } from "../../../players";

const DOCS = "https://firestore.googleapis.com/v1/projects/animewitcher-1c66d/databases/(default)/documents";
const KEY = "AIzaSyAcbWRwfFNnCpoydDXlEALWnM_TYVcJOMU";
const PAGE = 24;
const L = (en: string, ar: string): Text => ({ en, ar });

// Firestore's REST answers wrap every value in its type
type FsValue = Record<string, unknown>;
function plain(v: FsValue): unknown {
  if ("mapValue" in v) return fields((v.mapValue as { fields?: Record<string, FsValue> }).fields);
  if ("arrayValue" in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(plain);
  if ("integerValue" in v) return Number(v.integerValue);
  if ("nullValue" in v) return null;
  return Object.values(v)[0];
}
const fields = (f: Record<string, FsValue> | undefined): Record<string, unknown> => Object.fromEntries(Object.entries(f ?? {}).map(([k, v]) => [k, plain(v)]));
const docPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function doc<T>(ctx: Context, path: string, cacheMs = 10 * 60_000): Promise<T | undefined> {
  const res = await ctx.http.request("GET", `${DOCS}/${docPath(path)}`, { query: { key: KEY }, cacheMs });
  if (res.status === 404) return undefined;
  if (res.status !== 200) throw new SourceError("blocked", `AnimeWitcher refused ${path} (${res.status})`);
  return fields((await res.json<{ fields?: Record<string, FsValue> }>()).fields) as T;
}

async function docs<T>(ctx: Context, path: string): Promise<(T & { id: string })[]> {
  const res = await ctx.http.json<{ documents?: { name: string; fields?: Record<string, FsValue> }[] }>(`${DOCS}/${docPath(path)}`, {
    query: { key: KEY, pageSize: "50" },
    cacheMs: 5 * 60_000,
  });
  return (res.documents ?? []).map((d) => ({ ...(fields(d.fields) as T), id: d.name.split("/").pop()! }));
}

// the search key the app reads on start, so a new one is picked up when they change it
async function algolia<T>(ctx: Context, index: string, body: Record<string, unknown>): Promise<{ hits: T[]; nbPages: number; page: number }> {
  const s = (await doc<{ search_settings?: { app_id_v4?: string; app_id?: string; api_key?: string } }>(ctx, "Settings/constants", 60 * 60_000))?.search_settings;
  const app = s?.app_id_v4 ?? s?.app_id;
  if (!app || !s?.api_key) throw new SourceError("changed", "AnimeWitcher no longer publishes its search settings");
  return ctx.http.json(`https://${app}-dsn.algolia.net/1/indexes/${index}/query`, {
    method: "POST",
    headers: { "X-Algolia-Application-Id": app, "X-Algolia-API-Key": s.api_key },
    json: body,
    cacheMs: 5 * 60_000,
  });
}

interface Series {
  objectID?: string;
  name?: string;
  poster_uri?: string;
  type?: string;
  story?: string;
  tags?: string[];
  duration?: string;
  details?: { season?: string; season_name?: string; eps_num?: string; state?: string; studio?: string[]; end_date?: string; start_date?: string };
  episode_name?: string;
  anime_id?: string;
}

const yearOf = (s?: string) => Number(/\b(19|20)\d{2}\b/.exec(s ?? "")?.[0]) || undefined;
const typeOf = (t?: string) => (/مسلسل/.test(t ?? "") ? "tv" : /فيلم/.test(t ?? "") ? "movie" : animeType(t));

const card = (s: Series): AnimeSummary => ({
  id: s.anime_id ?? s.objectID ?? "",
  title: clean(s.name),
  cover: s.poster_uri,
  type: typeOf(s.type),
  year: yearOf(s.details?.season ?? s.details?.season_name),
  latestEpisode: Number(/(\d+)\s*$/.exec(s.episode_name ?? "")?.[1]) || undefined,
});

async function page(ctx: Context, index: string, query: string, n: number): Promise<Paged<AnimeSummary>> {
  const r = await algolia<Series>(ctx, index, { query, page: n - 1, hitsPerPage: PAGE });
  const seen = new Set<string>();
  const items = r.hits.map(card).filter((c) => c.id && c.title && !seen.has(c.id) && seen.add(c.id));
  return { items, hasNext: r.page + 1 < r.nbPages };
}

const witcher = defineAnimeSource({
  id: "witcher",
  name: "AnimeWitcher",
  lang: "ar",
  baseUrl: "https://www.animewitcher.com",
  rateLimit: { requests: 6, perMs: 1000 },
  listings: [
    { id: "recent", label: L("New episodes", "أحدث الحلقات") },
    { id: "all", label: L("All anime", "كل الأنميات") },
  ],
  filters: [],

  list: (ctx, { listing, page: n }) => page(ctx, listing === "all" ? "series" : "recent", "", n),

  search: (ctx, { query, page: n }) => page(ctx, "series", query, n),

  async details(ctx, id): Promise<AnimeDetails> {
    const a = await doc<Series & { mal_id?: string }>(ctx, `anime_list/${id}`);
    if (!a) throw new SourceError("not-found", `AnimeWitcher has no anime "${id}"`);
    const d = a.details ?? {};
    const genres = (a.tags ?? []).map(clean).filter((g) => g && !demographic(g));
    const count = Number(/\d+/.exec(d.eps_num ?? "")?.[0]);
    return {
      id,
      title: clean(a.name) || id,
      cover: a.poster_uri,
      type: typeOf(a.type),
      status: /يعرض|مستمر/.test(d.state ?? "") ? "ongoing" : status(d.state),
      year: yearOf(d.season ?? d.start_date),
      altTitles: [],
      description: clean(a.story) || undefined,
      genres: genres.map((name) => ({ name, key: genreKey(name) })),
      studios: (d.studio ?? []).map(clean).filter(Boolean),
      season: clean(d.season ?? d.season_name) || undefined,
      episodeCount: Number.isInteger(count) && count > 0 ? count : undefined,
      duration: minutes(a.duration ? `${a.duration} min` : undefined),
    };
  },

  async episodes(ctx, id): Promise<Episode[]> {
    const s = await doc<{ episodes?: { doc_id: string; name?: string; title_translated?: string; thumb_uri?: string }[] }>(ctx, `anime_list/${id}/episodes_summery/summery`);
    return (s?.episodes ?? []).map((e) => ({
      id: e.doc_id,
      number: Number(/(\d+(?:\.\d+)?)\s*$/.exec(e.name ?? "")?.[1] ?? e.doc_id) || undefined,
      title: clean(e.title_translated) || undefined,
      thumbnail: e.thumb_uri,
    }));
  },

  async servers(ctx, animeId, episodeId) {
    const list = await docs<{ name?: string; link?: string; quality?: string; visible?: boolean }>(ctx, `anime_list/${animeId}/episodes/${episodeId}/servers`);
    const out: VideoServer[] = list
      .filter((s) => s.visible !== false && s.link && /^https?:\/\//.test(s.link))
      // MEGA plays only in its own embed page
      .map((s) => ({ name: s.name ?? new URL(s.link!).host, url: s.link!.replace(/mega\.(nz|io)\/file\//i, "mega.nz/embed/"), kind: "embed" as const, quality: s.quality, audio: "sub" as const, lang: "ar" }));
    // a file page in a frame plays nothing, so those only stay once they're a video
    const found = (await withDirect(ctx, out)).filter((s) => !(s.kind === "embed" && /mediafire\.com|pixeldrain\.com|firestream\.to/.test(s.url)));
    if (!found.length) throw new SourceError("not-found", `AnimeWitcher has no working copy of episode ${episodeId}`);
    return found;
  },
});

export default defineExtension({
  pkg: "storm.anisto.witcher",
  name: "AnimeWitcher",
  version: "1.0.8",
  app: "anisto",
  sources: [witcher],
});
