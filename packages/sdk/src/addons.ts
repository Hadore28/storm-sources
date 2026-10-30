// Addons add abilities to the site itself rather than a content source: a bot, a
// notifier, anything that reacts to what happens on storm. They ship in the same
// signed repo as extensions and only reach the site through `ctx`.

import { SDK_VERSION, type SettingDef, type Text } from "./types";

export const ADDONS = "addons";

/** A value the admin types once; it's stored encrypted and never shown again. */
export type AddonSetting = SettingDef | { id: string; type: "secret"; label: Text; description?: Text };

/** public: the community. staff: the team. security: sign-ins and anything suspicious. */
export type Audience = "public" | "staff" | "security";

export interface StormEvent {
  type: string;
  audience: Audience;
  title: string;
  text?: string;
  url?: string;
  at: string;
}

export interface CommandOption {
  name: string;
  description: string;
  kind: "text" | "number";
  required?: boolean;
}

export interface StormCommand {
  name: string;
  description: string;
  options: CommandOption[];
  /** the answer has private details, so it must not appear in a shared chat */
  private?: boolean;
}

export interface CommandCaller {
  platform: string;
  id: string;
}

export interface AddonContext {
  settings: Record<string, string | boolean>;
  siteUrl: string;
  /** where this addon's outside service sends things */
  hookUrl: string;
  /** a value only storm and this addon's service know */
  hookSecret: string;
  commands: StormCommand[];
  /** Runs a command as the caller; staff checks and the audit log happen on storm's side. */
  run(name: string, args: Record<string, string>, caller: CommandCaller): Promise<string>;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  log(message: string): void;
}

export interface HookRequest {
  /** names in lower case */
  headers: Record<string, string>;
  body: string;
}

export interface HookResponse {
  status: number;
  json?: unknown;
}

export interface Addon {
  /** reverse-domain package name, e.g. "storm.addons.discord" */
  pkg: string;
  name: string;
  version: string;
  sdk: number;
  app: typeof ADDONS;
  /** always empty; keeps the repo tools working on addons and extensions alike */
  sources: never[];
  description: string;
  settings: AddonSetting[];
  /** Something happened on storm. */
  onEvent?(event: StormEvent, ctx: AddonContext): Promise<void>;
  /** A request arrived from the addon's outside service. */
  hook?(request: HookRequest, ctx: AddonContext): Promise<HookResponse>;
  /** Settings changed: tell the outside service what it needs to know. */
  sync?(ctx: AddonContext): Promise<void>;
}

export function defineAddon(addon: Omit<Addon, "sdk" | "app" | "sources">): Addon {
  return { ...addon, sdk: SDK_VERSION, app: ADDONS, sources: [] };
}

export const isAddon = (ext: { app: string }): ext is Addon => ext.app === ADDONS;

/** A plain line of what an event says, for services without rich messages. */
export const eventText = (e: StormEvent) => [e.title, e.text, e.url].filter(Boolean).join("\n\n");
