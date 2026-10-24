// Free-TV: a hand-checked playlist of free channels, grouped by country.

import { defineExtension } from "@storm-sources/sdk";
import { m3uSource } from "../../m3u";

export default defineExtension({
  pkg: "storm.tvsto.freetv",
  name: "Free-TV",
  version: "1.0.0",
  app: "tvsto",
  sources: [
    m3uSource({
      id: "freetv",
      name: "Free-TV",
      lang: "all",
      baseUrl: "https://github.com/Free-TV/IPTV",
      playlist: "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",
      groupsAreCountries: true,
    }),
  ],
});
