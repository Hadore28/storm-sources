// AnimeSlayer — the public API behind the AnimeSlayer Android app. Each episode
// points at a list of copies on other hosts, which storm turns into direct streams.

import {
  SourceError,
  animeType,
  clean,
  defineAnimeSource,
  defineExtension,
  demographic,
  genreKey,
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

const API = "https://anslayer.com/anime/public";
// the app's own client; the copies host returns nothing to a request carrying it
const APP = { "Client-Id": "android-app2", "Client-Secret": "7befba6263cc14c90d2f1d6da2c5cf9b251bfbbd", "User-Agent": "okhttp/4.9.1" };
const PAGE = 25;
const L = (en: string, ar: string): Text => ({ en, ar });

interface SlAnime {
  anime_id: string;
  anime_name: string;
  anime_type?: string;
  anime_status?: string;
  anime_season?: string;
  anime_release_year?: string;
  anime_genres?: string;
  anime_description?: string;
  anime_english_title?: string;
  anime_cover_image_url?: string;
  latest_episode_name?: string;
}
interface SlEpisode {
  episode_id: string;
  episode_name?: string;
  episode_number: string;
  episode_urls?: { episode_server_name: string; episode_url: string }[];
}

const api = async <T>(ctx: Context, path: string, query: Record<string, string>, cacheMs?: number) =>
  (await ctx.http.json<{ response: T }>(`${API}/${path}`, { query, headers: APP, cacheMs })).response;

const statusOf = (s?: string) => (/currently airing/i.test(s ?? "") ? "ongoing" : /finished/i.test(s ?? "") ? "completed" : status(s));

const card = (a: SlAnime): AnimeSummary => ({
  id: a.anime_id,
  title: clean(a.anime_name),
  cover: a.anime_cover_image_url,
  type: animeType(a.anime_type) ?? (/^tv/i.test(a.anime_type ?? "") ? "tv" : undefined),
  status: statusOf(a.anime_status),
  year: Number(a.anime_release_year) || undefined,
  latestEpisode: Number(/(\d+)\s*$/.exec(a.latest_episode_name ?? "")?.[1]) || undefined,
});

async function animes(ctx: Context, body: Record<string, unknown>, page: number): Promise<Paged<AnimeSummary>> {
  const r = await api<{ data?: SlAnime[] }>(ctx, "animes/get-published-animes", { json: JSON.stringify({ ...body, _offset: (page - 1) * PAGE }) }, 5 * 60_000);
  const items = (r.data ?? []).map(card);
  return { items, hasNext: items.length === PAGE };
}

const episodeList = (ctx: Context, id: string) =>
  api<{ data?: SlEpisode[] }>(ctx, "episodes/get-episodes", { json: JSON.stringify({ anime_id: Number(id) }) }, 10 * 60_000).then((r) => r.data ?? []);

// services that have shut down; older episodes still list them
const DEAD = /(^|\.)(fembed|vidlox|jawcloud|uptostream|tune|highstream|streamvid|vidbm|mystream|gounlimited|cloudvideo)\.[a-z]+$/i;

const hostName = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Server";
  }
};

const slayer = defineAnimeSource({
  id: "slayer",
  name: "AnimeSlayer",
  lang: "ar",
  baseUrl: "https://anslayer.com",
  rateLimit: { requests: 4, perMs: 1000 },
  listings: [
    { id: "latest", label: L("New episodes", "أحدث الحلقات") },
    { id: "top", label: L("Top rated", "الأعلى تقييماً") },
    { id: "az", label: L("A–Z", "أبجدياً") },
  ],
  filters: [],

  list: (ctx, { listing, page }) =>
    animes(ctx, { list_type: listing === "top" ? "top_anime" : listing === "az" ? "anime_list" : "latest_episodes" }, page),

  search: (ctx, { query, page }) => animes(ctx, { list_type: "anime_list", anime_name: query }, page),

  async details(ctx, id): Promise<AnimeDetails> {
    const a = await api<SlAnime>(ctx, "anime/get-anime-details", { anime_id: id, fetch_episodes: "No", more_info: "No" }, 30 * 60_000);
    if (!a?.anime_name) throw new SourceError("not-found", `AnimeSlayer has no anime "${id}"`);
    const genres = (a.anime_genres ?? "").split(/[,،]/).map(clean).filter((g) => g && !demographic(g));
    const english = clean(a.anime_english_title);
    return {
      ...card(a),
      url: undefined,
      altTitles: english && english !== clean(a.anime_name) ? [english] : [],
      description: clean(a.anime_description) || undefined,
      genres: genres.map((name) => ({ name, key: genreKey(name) })),
      studios: [],
      season: a.anime_season && a.anime_release_year ? `${a.anime_season} ${a.anime_release_year}` : undefined,
    };
  },

  async episodes(ctx, id): Promise<Episode[]> {
    const list = await episodeList(ctx, id);
    // the episode number is what people know; episode_id is an internal row
    return list
      .map((e) => ({ id: e.episode_number, number: Number(e.episode_number) || undefined, title: clean(e.episode_name) || undefined }))
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  },

  async servers(ctx, animeId, episodeId) {
    const ep = (await episodeList(ctx, animeId)).find((e) => e.episode_number === episodeId);
    if (!ep) throw new SourceError("not-found", `AnimeSlayer has no episode ${episodeId}`);
    const out: VideoServer[] = [];
    for (const u of ep.episode_urls ?? []) {
      // "cdn" is the app's old player, gone for good
      if (u.episode_server_name === "cdn" || !/^https?:\/\//.test(u.episode_url)) continue;
      if (u.episode_server_name === "muilt") {
        const copies = await ctx.http.json<unknown>(u.episode_url, { headers: { "User-Agent": "okhttp/4.9.1" }, cacheMs: 10 * 60_000 }).catch(() => []);
        for (const link of Array.isArray(copies) ? copies : []) {
          if (typeof link === "string" && /^https?:\/\//.test(link) && !DEAD.test(hostName(link))) out.push({ name: hostName(link), url: link, kind: "embed", audio: "sub", lang: "ar" });
        }
        continue;
      }
      out.push({ name: u.episode_server_name, url: u.episode_url, kind: /\.m3u8(\?|$)/.test(u.episode_url) ? "hls" : /\.mp4(\?|$)/.test(u.episode_url) ? "mp4" : "embed", audio: "sub", lang: "ar" });
    }
    // a MediaFire page in a frame plays nothing
    const found = (await withDirect(ctx, out)).filter((s) => !(s.kind === "embed" && /mediafire\.com|drive\.google\.com\/(?!file\/d\/[^/]+\/preview)/.test(s.url)));
    if (!found.length) throw new SourceError("not-found", `AnimeSlayer has no working copy of episode ${episodeId}`);
    return found;
  },
});

export default defineExtension({
  pkg: "storm.anisto.slayer",
  name: "AnimeSlayer",
  version: "1.0.2",
  app: "anisto",
  sources: [slayer],
});
