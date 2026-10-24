// Arabic-language channels: IPTV-org's Arabic playlist, okalharbi's hand-picked list and LiveTVCollector's Egypt list, merged.

import { defineExtension } from "@storm-sources/sdk";
import { m3uSource } from "../../m3u";

export default defineExtension({
  pkg: "storm.tvsto.arabic",
  name: "قنوات عربية",
  version: "1.2.0",
  app: "tvsto",
  sources: [
    m3uSource({
      id: "arabic-tv",
      name: "قنوات عربية",
      lang: "ar",
      baseUrl: "https://iptv-org.github.io",
      playlists: [
        "https://iptv-org.github.io/iptv/languages/ara.m3u",
        "https://raw.githubusercontent.com/okalharbi/Arabic_channels/main/ar_list.m3u",
        "https://raw.githubusercontent.com/myfriendqaz/LiveTVCollector/main/LiveTV/Egypt/LiveTV.m3u",
      ],
    }),
  ],
});
