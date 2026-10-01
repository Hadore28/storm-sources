import { SDK_VERSION, type Extension, type MangaSource } from "./types";

export * from "./types";
export * from "./errors";
export * from "./utils";
export * from "./genres";

export function defineExtension(extension: Omit<Extension, "sdk">): Extension {
  return { ...extension, sdk: SDK_VERSION };
}

/** Typing helper; returns the source unchanged. */
export function defineSource(source: MangaSource): MangaSource {
  return source;
}
