// Arabic-language channels, from IPTV-org's Arabic playlist.

import { defineExtension } from "@storm-sources/sdk";
import { m3uSource } from "../../m3u";

export default defineExtension({
  pkg: "storm.tvsto.arabic",
  name: "قنوات عربية",
  version: "1.0.0",
  app: "tvsto",
  sources: [
    m3uSource({
      id: "arabic-tv",
      name: "قنوات عربية",
      lang: "ar",
      baseUrl: "https://iptv-org.github.io",
      playlist: "https://iptv-org.github.io/iptv/languages/ara.m3u",
    }),
  ],
});
