import { SDK_VERSION, type AnimeSource, type BookSource, type Extension, type FilmSource, type MangaSource, type NovelSource } from "./types";

export * from "./types";
export * from "./errors";
export * from "./utils";
export * from "./genres";
export * from "./text";

type ExtensionInput = Extension extends infer E ? (E extends Extension ? Omit<E, "sdk"> : never) : never;

export function defineExtension(extension: ExtensionInput): Extension {
  return { ...extension, sdk: SDK_VERSION } as Extension;
}

// Typing helpers; each returns the source unchanged.
export function defineSource(source: MangaSource): MangaSource {
  return source;
}
export const defineAnimeSource = (source: AnimeSource): AnimeSource => source;
export const defineFilmSource = (source: FilmSource): FilmSource => source;
export const defineNovelSource = (source: NovelSource): NovelSource => source;
export const defineBookSource = (source: BookSource): BookSource => source;
