// A live-TV source from one hosted M3U playlist. Feeds sharing a channel id become one channel.

import { SourceError, defineTvSource, type ChannelSummary, type Text, type TvSource } from "@storm-sources/sdk";
import { CATEGORIES, L, categoryKey, channelFilters, countryOfId, feedServers, filterChannels, memo, paged, shortId, splitTitle, parseM3u, type Feed } from "./shared";

interface Options {
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
  playlist: string;
  /** groups that are countries in this playlist, not categories */
  groupsAreCountries?: boolean;
}

interface Rec extends ChannelSummary {
  feeds: Feed[];
}

export function m3uSource(o: Options): TvSource {
  const groupNames = new Map<string, string>();

  const catalog = memo(3 * 3_600_000, async (ctx) => {
    const text = await ctx.http.text(o.playlist, { timeoutMs: 45_000 });
    const recs = new Map<string, Rec>();
    for (const e of parseM3u(text)) {
      if (!e.url) continue;
      const { name, quality } = splitTitle(e.title);
      if (!name) continue;
      const tvg = e.tvgId?.split("@")[0];
      const id = tvg ? tvg.replace(/[^\w.-]/g, "") : `u-${shortId(e.url)}`;
      const groups = o.groupsAreCountries ? [] : (e.group ?? "").split(";").map((g) => g.trim()).filter(Boolean);
      for (const g of groups) groupNames.set(categoryKey(g), g);
      let rec = recs.get(id);
      if (!rec) {
        rec = { id, title: name, cover: e.logo, country: e.country || (tvg ? countryOfId(tvg) : undefined), categories: groups.map(categoryKey), feeds: [] };
        recs.set(id, rec);
      }
      if (!rec.cover && e.logo) rec.cover = e.logo;
      rec.feeds.push({ url: e.url, quality, referrer: e.referrer, userAgent: e.userAgent });
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
