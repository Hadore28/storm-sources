// Manga sites in Indonesian that run on shared themes. The list starts from
// Keiyoushi's sources (Apache-2.0) and keeps the sites that pass storm's live check.

import { defineExtension } from "@storm-sources/sdk";
import { themeSources, type ThemeSite } from "../../../themes";
import sites from "./sites.json";

export default defineExtension({
  pkg: "storm.mangasto.sites-id",
  name: "Manga sites: Indonesian",
  version: "1.0.1",
  app: "mangasto",
  sources: themeSources(sites as ThemeSite[]),
});
