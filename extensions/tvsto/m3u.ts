// A live-TV source from hosted M3U playlists. Feeds sharing a channel id become one channel, across playlists.

import { SourceError, defineTvSource, type ChannelSummary, type Text, type TvSource } from "@storm-sources/sdk";
import { CATEGORIES, L, unwanted, categoryKey, channelFilters, countryOfId, feedServers, filterChannels, fold, memo, paged, shortId, splitTitle, parseM3u, type Feed } from "./shared";

interface Options {
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
  playlists: string[];
  /** groups that are countries in this playlist, not categories */
  groupsAreCountries?: boolean;
}

interface Rec extends ChannelSummary {
  feeds: Feed[];
}

export function m3uSource(o: Options): TvSource {
  const groupNames = new Map<string, string>();

  const catalog = memo(3 * 3_600_000, async (ctx) => {
    // a playlist that doesn't answer leaves the others
    const texts = await Promise.all(o.playlists.map((url) => ctx.http.text(url, { timeoutMs: 45_000 }).catch(() => "")));
    if (texts.every((t) => !t)) throw new SourceError("network", `${o.name}: no playlist answered`);
    const recs = new Map<string, Rec>();
    const byName = new Map<string, string>();
    for (const e of texts.flatMap(parseM3u)) {
      if (!e.url || unwanted(e.url, e.title)) continue;
      const { name, quality } = splitTitle(e.title);
      if (!name) continue;
      // a feed without a channel id joins the channel of the same name
      const tvg = e.tvgId?.split("@")[0];
      const key = fold(name);
      const id = tvg?.replace(/[^\w.-]/g, "") || byName.get(key) || `u-${shortId(tvg || key)}`;
      if (!byName.has(key)) byName.set(key, id);
      const groups = o.groupsAreCountries ? [] : (e.group ?? "").split(";").map((g) => g.trim()).filter((g) => g && !/^undefined$/i.test(g));
      for (const g of groups) groupNames.set(categoryKey(g), g);
      let rec = recs.get(id);
      if (!rec) {
        rec = { id, title: name, cover: e.logo, country: e.country || (tvg ? countryOfId(tvg) : undefined), categories: groups.map(categoryKey), feeds: [] };
        recs.set(id, rec);
      }
      if (!rec.cover && e.logo) rec.cover = e.logo;
      for (const g of groups.map(categoryKey)) if (!rec.categories!.includes(g)) rec.categories!.push(g);
      // one stream can carry two channels' names, e.g. MBC 3 and MBC 3 USA
      if (!rec.feeds.some((f) => f.url === e.url)) rec.feeds.push({ url: e.url, quality, referrer: e.referrer, userAgent: e.userAgent });
    }
    const list = [...recs.values()]
      .map((r) => ({ ...r, streams: r.feeds.length, quality: r.feeds.find((f) => f.quality)?.quality }))
      .sort((a, b) => Number(!!b.cover) - Number(!!a.cover) || a.title.localeCompare(b.title));
    return { list, byId: new Map(list.map((r) => [r.id, r])) };
  });

  const label = (key: string): Text => CATEGORIES[key] ?? groupNames.get(key) ?? key;
  const summary = ({ feeds: _f, ...c }: Rec): ChannelSummary => c;

  return defineTvSource({
    id: o.id,
    name: o.name,
    lang: o.lang,
    baseUrl: o.baseUrl,
    listings: [{ id: "channels", label: L("Channels", "القنوات"), filters: true }],
    filters: async (ctx) => channelFilters((await catalog(ctx)).list, label),
    searchFilters: true,

    async list(ctx, { page, filters }) {
      return paged(filterChannels((await catalog(ctx)).list, filters).map(summary), page);
    },

    async search(ctx, { query, page, filters }) {
      return paged(filterChannels((await catalog(ctx)).list, filters, query).map(summary), page);
    },

    async details(ctx, id) {
      const c = (await catalog(ctx)).byId.get(id);
      if (!c) throw new SourceError("not-found", `${o.name} has no channel ${id}`);
      return summary(c);
    },

    async servers(ctx, id) {
      const c = (await catalog(ctx)).byId.get(id);
      if (!c) throw new SourceError("not-found", `${o.name} has no channel ${id}`);
      return feedServers(c.feeds);
    },
  });
}
