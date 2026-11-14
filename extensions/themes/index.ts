import type { MangaSource } from "@storm-sources/sdk";
import { madara, type MadaraSite } from "./madara";

export type ThemeSite = { theme: "madara" } & MadaraSite;

export const themeSources = (sites: ThemeSite[]): MangaSource[] => sites.map((s) => madara(s));
