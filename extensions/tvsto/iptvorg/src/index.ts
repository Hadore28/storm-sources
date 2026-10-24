// IPTV-org: the big public catalog of free-to-air channels, published as static JSON.
// streams.json holds the feeds, channels.json the names, countries and categories, logos.json the logos.

import { SourceError, clean, defineExtension, defineTvSource, type ChannelSummary, type Context } from "@storm-sources/sdk";
import { L, unwanted, channelFilters, feedServers, filterChannels, memo, paged, shortId, type Feed } from "../../shared";

const API = "https://iptv-org.github.io/api";

interface Stream {
  channel: string | null;
  title: string;
  url: string;
  quality: string | null;
  referrer: string | null;
  user_agent: string | null;
}
interface Channel {
  id: string;
  name: string;
  alt_names?: string[];
  country?: string;
  categories?: string[];
  is_nsfw?: boolean;
  closed?: string | null;
  website?: string | null;
}
interface Logo {
  channel: string;
  feed: string | null;
  url: string;
}

interface Rec extends ChannelSummary {
  names: string;
  website?: string;
  feeds: Feed[];
}

const catalog = memo(6 * 3_600_000, async (ctx: Context) => {
  const get = <T>(file: string) => ctx.http.json<T>(`${API}/${file}`, { timeoutMs: 60_000 });
  const [streams, channels, logos] = await Promise.all([get<Stream[]>("streams.json"), get<Channel[]>("channels.json"), get<Logo[]>("logos.json").catch(() => [] as Logo[])]);
  const byChannel = new Map(channels.map((c) => [c.id, c]));
  const logo = new Map<string, string>();
  for (const l of logos) if (l.channel && (!logo.has(l.channel) || !l.feed)) logo.set(l.channel, l.url);

  const recs = new Map<string, Rec>();
  for (const s of streams) {
    if (!s.url) continue;
    const ch = s.channel ? byChannel.get(s.channel) : undefined;
    if (unwanted(s.url, ch?.name ?? s.title)) continue;
    if (ch?.is_nsfw || ch?.categories?.includes("xxx") || ch?.closed) continue;
    const id = ch?.id ?? `u-${shortId(s.url)}`;
    let rec = recs.get(id);
    if (!rec) {
      const title = clean(ch?.name ?? s.title.replace(/\(\d{3,4}p\)|\[[^\]]*\]/g, ""));
      if (!title) continue;
      rec = {
        id,
        title,
        names: [title, ...(ch?.alt_names ?? [])].join(" "),
        cover: (ch && logo.get(ch.id)) || undefined,
        country: ch?.country && /^[A-Z]{2}$/.test(ch.country) ? ch.country : undefined,
        categories: ch?.categories ?? [],
        website: ch?.website ?? undefined,
        feeds: [],
      };
      recs.set(id, rec);
    }
    rec.feeds.push({ url: s.url, quality: s.quality ?? undefined, referrer: s.referrer ?? undefined, userAgent: s.user_agent ?? undefined });
  }
  const list = [...recs.values()]
    .map((r) => ({ ...r, streams: r.feeds.length, quality: [...r.feeds].sort((a, b) => (parseInt(b.quality ?? "") || 0) - (parseInt(a.quality ?? "") || 0))[0]?.quality }))
    .sort((a, b) => Number(!!b.cover) - Number(!!a.cover) || a.title.localeCompare(b.title));
  return { list, byId: new Map(list.map((r) => [r.id, r])) };
});

const summary = ({ feeds: _f, names: _n, website: _w, ...c }: Rec): ChannelSummary => c;

const iptvorg = defineTvSource({
  id: "iptvorg",
  name: "IPTV-org",
  lang: "all",
  baseUrl: "https://iptv-org.github.io",
  listings: [{ id: "channels", label: L("Channels", "القنوات"), filters: true }],
  filters: async (ctx) => channelFilters((await catalog(ctx)).list),
  searchFilters: true,

  async list(ctx, { page, filters }) {
    return paged(filterChannels((await catalog(ctx)).list, filters).map(summary), page);
  },

  async search(ctx, { query, page, filters }) {
    return paged(filterChannels((await catalog(ctx)).list, filters, query).map(summary), page);
  },

  async details(ctx, id) {
    const c = (await catalog(ctx)).byId.get(id);
    if (!c) throw new SourceError("not-found", `IPTV-org has no channel ${id}`);
    return { ...summary(c), website: c.website };
  },

  async servers(ctx, id) {
    const c = (await catalog(ctx)).byId.get(id);
    if (!c) throw new SourceError("not-found", `IPTV-org has no channel ${id}`);
    return feedServers(c.feeds);
  },
});

export default defineExtension({
  pkg: "storm.tvsto.iptvorg",
  name: "IPTV-org",
  version: "1.0.1",
  app: "tvsto",
  sources: [iptvorg],
});
