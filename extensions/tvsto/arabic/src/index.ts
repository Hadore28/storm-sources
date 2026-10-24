// Arabic-language channels: IPTV-org's Arabic playlist and okalharbi's hand-picked list, merged.

import { defineExtension } from "@storm-sources/sdk";
import { m3uSource } from "../../m3u";

export default defineExtension({
  pkg: "storm.tvsto.arabic",
  name: "قنوات عربية",
  version: "1.1.0",
  app: "tvsto",
  sources: [
    m3uSource({
      id: "arabic-tv",
      name: "قنوات عربية",
      lang: "ar",
      baseUrl: "https://iptv-org.github.io",
      playlists: ["https://iptv-org.github.io/iptv/languages/ara.m3u", "https://raw.githubusercontent.com/okalharbi/Arabic_channels/main/ar_list.m3u"],
      skipHosts: /^https?:\/\/[^/]*(bozztv\.com|magictvbox\.com)[:/]/,
    }),
  ],
});
