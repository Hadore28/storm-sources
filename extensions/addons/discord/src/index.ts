import { defineAddon, type AddonContext, type Audience, type HookResponse } from "@storm-sources/sdk";

const API = "https://discord.com/api/v10";
const COLOR: Record<Audience, number> = { public: 0x7c5cff, staff: 0x38bdf8, security: 0xfbbf24 };
const OPTION = { text: 3, number: 10 } as const;
const MAX_AGE_SECONDS = 300;
const EPHEMERAL = 64;

const hex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));

async function call(ctx: AddonContext, method: string, path: string, body: unknown) {
  const res = await ctx.fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${ctx.settings.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function signedByDiscord(publicKey: string, signature: string, timestamp: string, body: string) {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(signature), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

// every answer is only visible to whoever asked, and can't ping anyone
const reply = (content: string): HookResponse => ({
  status: 200,
  json: { type: 4, data: { content: content.slice(0, 2000), flags: EPHEMERAL, allowed_mentions: { parse: [] } } },
});

export default defineAddon({
  pkg: "storm.addons.discord",
  name: "Discord bot",
  version: "1.0.0",
  description: "Posts storm's news and alerts to Discord channels, and gives staff slash commands.",
  settings: [
    { id: "token", type: "secret", label: "Bot token", description: "Discord Developer Portal → your app → Bot → Reset Token." },
    { id: "publicKey", type: "text", label: "Public key", default: "", description: "General Information → Public Key." },
    { id: "applicationId", type: "text", label: "Application ID", default: "", description: "General Information → Application ID." },
    { id: "guildId", type: "text", label: "Server ID", default: "", description: "Right-click your server → Copy Server ID." },
    { id: "public", type: "text", label: "Announcements channel ID", default: "", description: "News and updates for everyone. Empty turns them off." },
    { id: "staff", type: "text", label: "Staff channel ID", default: "", description: "Tickets, reports, sign-ups and Premium." },
    { id: "security", type: "text", label: "Security channel ID", default: "", description: "Staff sign-ins and new admin addresses." },
  ],

  async onEvent(event, ctx) {
    const channel = String(ctx.settings[event.audience] ?? "");
    if (!channel || !ctx.settings.token) return;
    await call(ctx, "POST", `/channels/${channel}/messages`, {
      embeds: [{ title: event.title.slice(0, 256), description: event.text?.slice(0, 4000), url: event.url, color: COLOR[event.audience], timestamp: event.at }],
      allowed_mentions: { parse: [] },
    });
  },

  async hook({ headers, body }, ctx) {
    const ok = await signedByDiscord(String(ctx.settings.publicKey ?? ""), headers["x-signature-ed25519"] ?? "", headers["x-signature-timestamp"] ?? "", body);
    if (!ok) return { status: 401, json: { error: "bad signature" } };
    const i = JSON.parse(body) as {
      type: number;
      data?: { name: string; options?: { name: string; value: string | number }[] };
      member?: { user: { id: string } };
      user?: { id: string };
    };
    if (i.type === 1) return { status: 200, json: { type: 1 } };
    const id = i.member?.user.id ?? i.user?.id;
    if (i.type !== 2 || !i.data || !id) return { status: 400 };
    const args = Object.fromEntries((i.data.options ?? []).map((o) => [o.name, String(o.value)]));
    return reply(await ctx.run(i.data.name, args, { platform: "discord", id }));
  },

  async sync(ctx) {
    const { token, applicationId, guildId } = ctx.settings;
    if (!token || !applicationId || !guildId) return;
    await call(
      ctx,
      "PUT",
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      ctx.commands.map((c) => ({
        name: c.name,
        description: c.description.slice(0, 100),
        // hidden until the server's owner gives staff roles access
        default_member_permissions: "0",
        options: c.options.map((o) => ({ name: o.name, description: o.description.slice(0, 100), type: OPTION[o.kind], required: !!o.required })),
      })),
    );
  },
});
