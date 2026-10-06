// AniTaku — the JSON API behind the AniTaku Android app (an EasyPlex backend).
// Episodes are files on MediaFire and Pixeldrain; each is turned into its
// direct video file so it plays in storm's own player.

import {
  SourceError,
  clean,
  defineAnimeSource,
  defineExtension,
  demographic,
  genreKey,
  year,
  type AnimeDetails,
  type AnimeSummary,
  type Context,
  type Episode,
  type Paged,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";

const API = "https://anitakuapp.hasalaty.com/public/api";
// What the app sends: a fixed token, its package name, and a salt after every path.
const SALT = "UECatLeZvbJKKgjRMwTPv6trTk8wuxV9qab4tJ20YACgtSWvLAWTSu1LEbi0JPLTwfhupKyRM2H483M52qfmYfly8iCdG44JTOtJ171jBgQ1UEVCXxjHYrvkjhb9bkGP";
const APP_HEADERS = {
  "User-Agent": "EasyPlex (Android 7.1.2; SM-G977N; samsung beyond1q; en)",
  Packagename: "com.anitaku",
  Authorization: "Bearer greenfubukitatsumakisaitamayellowgenosopmthirdseaoson",
};
const L = (en: string, ar: string): Text => ({ en, ar });

interface AtCard {
  id: number;
  type?: string;
  name?: string;
  title?: string;
  poster_path?: string;
  vote_average?: number;
}
interface AtVideo {
  server?: string;
  link?: string;
  lang?: string;
  embed?: number;
  hls?: number;
}
interface AtEpisode {
  id: number;
  episode_number?: number;
  name?: string;
  air_date?: string;
  still_path?: string;
  videos?: AtVideo[];
}
interface AtShow extends AtCard {
  original_name?: string;
  overview?: string;
  backdrop_path?: string;
  first_air_date?: string;
  release_date?: string;
  genres?: { name?: string }[];
  networks?: { name?: string }[];
  tmdb_id?: number | string;
  imdb_external_id?: string;
  seasons?: { season_number: number; episodes?: AtEpisode[] }[];
  videos?: AtVideo[];
}

const api = <T>(ctx: Context, path: string, query?: Record<string, string | number>, cacheMs?: number) =>
  ctx.http.json<T>(`${API}/${path}/${SALT}`, { query, headers: APP_HEADERS, cacheMs });

const card = (o: AtCard): AnimeSummary => ({
  id: `${o.type === "movie" ? "movie" : "serie"}:${o.id}`,
  title: clean(o.name ?? o.title),
  cover: o.poster_path,
  type: o.type === "movie" ? "movie" : "tv",
});

const split = (id: string) => {
  const m = /^(serie|movie):(\d+)$/.exec(id);
  if (!m) throw new SourceError("not-found", `AniTaku has no title "${id}"`);
  return { kind: m[1], num: m[2] };
};

const show = (ctx: Context, id: string) => {
  const { kind, num } = split(id);
  return api<AtShow>(ctx, kind === "movie" ? `media/detail/${num}` : `series/show/${num}`, undefined, 10 * 60_000);
};

async function paged(ctx: Context, path: string, page: number): Promise<Paged<AnimeSummary>> {
  const d = await api<{ data?: AtCard[]; current_page?: number; last_page?: number }>(ctx, path, { page });
  return { items: (d.data ?? []).map(card), hasNext: (d.current_page ?? 1) < (d.last_page ?? 1) };
}

// MediaFire file pages carry the file's direct address on their download button.
async function mediafire(ctx: Context, link: string): Promise<string | undefined> {
  const html = await ctx.http.text(link, { retries: 1, cacheMs: 10 * 60_000 });
  const scrambled = /data-scrambled-url="([^"]+)"/.exec(html)?.[1];
  if (scrambled) {
    try {
      const url = atob(scrambled);
      if (/^https?:\/\/download\d*\.mediafire\.com\//.test(url)) return url;
    } catch {
      // fall through to the plain link
    }
  }
  return /href="(https?:\/\/download\d*\.mediafire\.com\/[^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
}

async function playable(ctx: Context, v: AtVideo): Promise<VideoServer | null> {
  const link = v.link?.trim();
  if (!link || !/^https?:\/\//.test(link)) return null;
  const quality = /\b(4K|FHD|HD|SD)\b/i.exec(v.server ?? "")?.[1]?.toUpperCase();
  const base = { name: clean((v.server ?? "").replace(/\b(4K|FHD|HD|SD)\b/i, "")) || new URL(link).host, quality, audio: "sub" as const, lang: /arab/i.test(v.lang ?? "") ? "ar" : undefined };
  if (v.hls || /\.m3u8(\?|$)/.test(link)) return { ...base, url: link, kind: "hls" };
  if (v.embed) return { ...base, url: link, kind: "embed" };
  const pixeldrain = /pixeldrain\.com\/u\/([A-Za-z0-9]+)/.exec(link)?.[1];
  if (pixeldrain) return { ...base, url: `https://pixeldrain.com/api/file/${pixeldrain}`, kind: "mp4" };
  if (/mediafire\.com\/file\//.test(link)) {
    const direct = await mediafire(ctx, link).catch(() => undefined);
    return direct ? { ...base, url: direct, kind: "mp4" } : null;
  }
  if (/\.(mp4|webm)(\?|$)/.test(link)) return { ...base, url: link, kind: "mp4" };
  return { ...base, url: link, kind: "embed" };
}

// Seasons here are story arcs; episodes are numbered straight through, as the app shows them.
function allEpisodes(s: AtShow): (AtEpisode & { n: number })[] {
  let n = 0;
  return (s.seasons ?? [])
    .slice()
    .sort((a, b) => a.season_number - b.season_number)
    .flatMap((season) => (season.episodes ?? []).slice().sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0)))
    .map((e) => ({ ...e, n: ++n }));
}

const anitaku = defineAnimeSource({
  id: "anitaku",
  name: "AniTaku",
  lang: "ar",
  baseUrl: "https://anitakuapp.hasalaty.com",
  rateLimit: { requests: 4, perMs: 1000 },
  cache: { servers: 8 * 60_000 },
  listings: [
    { id: "latest", label: L("Recently added", "أُضيفت حديثاً") },
    { id: "popular", label: L("Most watched", "الأكثر مشاهدة") },
  ],
  filters: [],

  list: (ctx, { listing, page }) => paged(ctx, listing === "popular" ? "series/byviews" : "genres/latestseries/all", page),

  async search(ctx, { query, page }) {
    if (page > 1) return { items: [], hasNext: false };
    const d = await api<{ search?: AtCard[] }>(ctx, `search/${encodeURIComponent(query)}`);
    return { items: (d.search ?? []).map(card), hasNext: false };
  },

  async details(ctx, id): Promise<AnimeDetails> {
    const { kind } = split(id);
    const s = await show(ctx, id);
    if (!s?.id) throw new SourceError("not-found", `AniTaku has no title "${id}"`);
    const tags = (s.genres ?? []).map((g) => clean(g.name)).filter(Boolean);
    const episodes = kind === "movie" ? 1 : allEpisodes(s).length;
    return {
      ...card({ ...s, type: kind === "movie" ? "movie" : "serie" }),
      altTitles: [clean(s.original_name)].filter(Boolean),
      description: clean(s.overview) || undefined,
      year: year(s.first_air_date ?? s.release_date),
      genres: [...new Set(tags)].filter((g) => !demographic(g) && g !== "جوسي").map((name) => ({ name, key: genreKey(name) })),
      studios: (s.networks ?? []).map((n) => clean(n.name)).filter(Boolean),
      episodeCount: episodes || undefined,
      links: { tmdb: s.tmdb_id ? String(s.tmdb_id) : undefined, imdb: s.imdb_external_id || undefined },
    };
  },

  async episodes(ctx, id): Promise<Episode[]> {
    if (split(id).kind === "movie") return [{ id: "movie", number: 1 }];
    return allEpisodes(await show(ctx, id)).map((e) => ({
      id: String(e.id),
      number: e.n,
      title: clean(e.name) || undefined,
      date: e.air_date,
      thumbnail: e.still_path,
    }));
  },

  async servers(ctx, animeId, episodeId) {
    const s = await show(ctx, animeId);
    const videos = split(animeId).kind === "movie" ? (s.videos ?? []) : (allEpisodes(s).find((e) => String(e.id) === episodeId)?.videos ?? []);
    if (!videos.length) throw new SourceError("not-found", `AniTaku has no video for episode ${episodeId}`);
    return (await Promise.all(videos.slice(0, 8).map((v) => playable(ctx, v)))).filter((v): v is VideoServer => !!v);
  },
});

export default defineExtension({
  pkg: "storm.anisto.anitaku",
  name: "AniTaku",
  version: "1.0.0",
  app: "anisto",
  sources: [anitaku],
});
