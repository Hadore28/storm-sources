import { defineAddon, eventText, type AddonContext, type StormCommand } from "@storm-sources/sdk";

const MAX_MESSAGE = 4000;

async function call(ctx: AddonContext, method: string, body: unknown) {
  // the address holds the token, so a failed connection must not repeat it
  const res = await ctx
    .fetch(`https://api.telegram.org/bot${ctx.settings.token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .catch(() => {
      throw new Error("Telegram couldn't be reached");
    });
  if (!res.ok) throw new Error(`Telegram answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// never parsed as markup: usernames and messages are other people's text
const send = (ctx: AddonContext, chat: string | number, text: string, replyTo?: number) =>
  call(ctx, "sendMessage", { chat_id: chat, text: text.slice(0, MAX_MESSAGE), link_preview_options: { is_disabled: true }, reply_to_message_id: replyTo });

/** Words in order, the last text option taking whatever is left. */
function argsOf(command: StormCommand, words: string[]) {
  const args: Record<string, string> = {};
  command.options.forEach((o, i) => {
    const last = i === command.options.length - 1;
    const value = last && o.kind === "text" ? words.slice(i).join(" ") : words[i];
    if (value) args[o.name] = value;
  });
  return args;
}

const usage = (c: StormCommand) => `/${c.name} ${c.options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(" ")}`.trim();

export default defineAddon({
  pkg: "storm.addons.telegram",
  name: "Telegram bot",
  version: "1.0.0",
  description: "Posts storm's news and alerts to Telegram chats, and gives staff slash commands.",
  settings: [
    { id: "token", type: "secret", label: "Bot token", description: "From @BotFather, after /newbot." },
    { id: "public", type: "text", label: "Announcements chat", default: "", description: "@channelname or a numeric chat ID. Empty turns them off." },
    { id: "staff", type: "text", label: "Staff chat ID", default: "", description: "Tickets, reports, sign-ups and Premium." },
    { id: "security", type: "text", label: "Security chat ID", default: "", description: "Staff sign-ins and new admin addresses." },
  ],

  async onEvent(event, ctx) {
    const chat = String(ctx.settings[event.audience] ?? "");
    if (chat && ctx.settings.token) await send(ctx, chat, eventText(event));
  },

  async hook({ headers, body }, ctx) {
    if (headers["x-telegram-bot-api-secret-token"] !== ctx.hookSecret) return { status: 401, json: { error: "bad secret" } };
    const m = (JSON.parse(body) as { message?: { message_id: number; text?: string; chat: { id: number; type: string }; from?: { id: number } } }).message;
    if (!m?.text?.startsWith("/") || !m.from) return { status: 200 };
    const [head, ...words] = m.text.trim().split(/\s+/);
    const name = head.slice(1).split("@")[0].toLowerCase();
    const command = ctx.commands.find((c) => c.name === name);
    if (!command) return { status: 200 };
    if (command.private && m.chat.type !== "private") {
      await send(ctx, m.chat.id, "Send this to me in a private chat.", m.message_id);
      return { status: 200 };
    }
    if (command.options.some((o, i) => o.required && !words[i])) {
      await send(ctx, m.chat.id, `Use: ${usage(command)}`, m.message_id);
      return { status: 200 };
    }
    await send(ctx, m.chat.id, await ctx.run(name, argsOf(command, words), { platform: "telegram", id: String(m.from.id) }), m.message_id);
    return { status: 200 };
  },

  async sync(ctx) {
    if (!ctx.settings.token) return;
    await call(ctx, "setWebhook", { url: ctx.hookUrl, secret_token: ctx.hookSecret, allowed_updates: ["message"] });
    await call(ctx, "setMyCommands", { commands: ctx.commands.map((c) => ({ command: c.name, description: c.description.slice(0, 256) })) });
  },
});
