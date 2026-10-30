import { describe, expect, test } from "bun:test";
import { ADDONS, isAddon, type AddonContext, type StormEvent } from "@storm-sources/sdk";
import discord from "./discord/src/index";
import telegram from "./telegram/src/index";

const hex = (b: ArrayBuffer | Uint8Array) => Buffer.from(b as ArrayBuffer).toString("hex");
const event: StormEvent = { type: "site.update", audience: "public", title: "New update", text: "Hello", at: new Date().toISOString() };

function context(settings: AddonContext["settings"]) {
  const sent: { url: string; body: any }[] = [];
  const runs: unknown[][] = [];
  const ctx: AddonContext = {
    settings,
    siteUrl: "https://storm.test",
    hookUrl: "https://storm.test/hook",
    hookSecret: "s3cret",
    commands: [
      { name: "ban", description: "Ban", options: [{ name: "username", description: "Who", kind: "text", required: true }, { name: "reason", description: "Why", kind: "text" }] },
      { name: "code", description: "Code", options: [], private: true },
    ],
    run: async (...a) => (runs.push(a), "done"),
    fetch: async (url, init) => (sent.push({ url, body: JSON.parse(String(init?.body)) }), new Response("{}")),
    log: () => {},
  };
  return { ctx, sent, runs };
}

test("both are addons", () => {
  for (const a of [discord, telegram]) {
    expect(a.app).toBe(ADDONS);
    expect(isAddon(a)).toBe(true);
    expect(a.sources).toEqual([]);
  }
});

describe("discord", () => {
  async function signed(body: string) {
    const keys = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body));
    return { publicKey: hex(await crypto.subtle.exportKey("raw", keys.publicKey)), headers: { "x-signature-ed25519": hex(sig), "x-signature-timestamp": timestamp } };
  }

  test("answers Discord's ping", async () => {
    const body = JSON.stringify({ type: 1 });
    const s = await signed(body);
    const r = await discord.hook!({ headers: s.headers, body }, context({ publicKey: s.publicKey }).ctx);
    expect(r).toEqual({ status: 200, json: { type: 1 } });
  });

  test("refuses a forged or changed request", async () => {
    const body = JSON.stringify({ type: 2, data: { name: "ban" }, user: { id: "1" } });
    const s = await signed(body);
    const { ctx, runs } = context({ publicKey: s.publicKey });
    expect((await discord.hook!({ headers: s.headers, body: body.replace("ban", "code") }, ctx)).status).toBe(401);
    expect((await discord.hook!({ headers: {}, body }, ctx)).status).toBe(401);
    expect(runs).toEqual([]);
  });

  test("runs a command and answers privately", async () => {
    const body = JSON.stringify({ type: 2, data: { name: "ban", options: [{ name: "username", value: "x" }] }, member: { user: { id: "42" } } });
    const s = await signed(body);
    const { ctx, runs } = context({ publicKey: s.publicKey });
    const r = (await discord.hook!({ headers: s.headers, body }, ctx)) as { json: any };
    expect(runs[0]).toEqual(["ban", { username: "x" }, { platform: "discord", id: "42" }]);
    expect(r.json.data.flags).toBe(64);
    expect(r.json.data.allowed_mentions).toEqual({ parse: [] });
  });

  test("posts to the audience's channel, nowhere when it's empty", async () => {
    const a = context({ token: "t", public: "123" });
    await discord.onEvent!(event, a.ctx);
    expect(a.sent[0].url).toContain("/channels/123/messages");
    expect(a.sent[0].body.allowed_mentions).toEqual({ parse: [] });
    const b = context({ token: "t", public: "" });
    await discord.onEvent!(event, b.ctx);
    expect(b.sent).toEqual([]);
  });
});

describe("telegram", () => {
  const headers = { "x-telegram-bot-api-secret-token": "s3cret" };
  const update = (text: string, type = "private") => JSON.stringify({ message: { message_id: 7, text, chat: { id: 9, type }, from: { id: 42 } } });

  test("refuses anything without the secret", async () => {
    const { ctx, runs } = context({ token: "t" });
    expect((await telegram.hook!({ headers: {}, body: update("/ban x") }, ctx)).status).toBe(401);
    expect(runs).toEqual([]);
  });

  test("the last text option takes the rest of the line", async () => {
    const { ctx, runs } = context({ token: "t" });
    await telegram.hook!({ headers, body: update("/ban@storm_bot someone spam and abuse") }, ctx);
    expect(runs[0]).toEqual(["ban", { username: "someone", reason: "spam and abuse" }, { platform: "telegram", id: "42" }]);
  });

  test("private commands don't run in a group", async () => {
    const { ctx, runs, sent } = context({ token: "t" });
    await telegram.hook!({ headers, body: update("/code", "supergroup") }, ctx);
    expect(runs).toEqual([]);
    expect(sent[0].body.text).toContain("private chat");
  });

  test("a missing option shows how to use it", async () => {
    const { ctx, runs, sent } = context({ token: "t" });
    await telegram.hook!({ headers, body: update("/ban") }, ctx);
    expect(runs).toEqual([]);
    expect(sent[0].body.text).toContain("/ban <username> [reason]");
  });

  test("sends plain text, never markup", async () => {
    const { ctx, sent } = context({ token: "t", public: "@storm" });
    await telegram.onEvent!(event, ctx);
    expect(sent[0].body.chat_id).toBe("@storm");
    expect(sent[0].body.parse_mode).toBeUndefined();
  });
});
