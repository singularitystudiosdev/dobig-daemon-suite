# Roblox Daemon Toolkit

Six tools for live operated Roblox games, styled after dobig.com/games: Creator Dox, Thumbnail Daemon, Discord Daemon,
Description Daemon, DMCA Daemon and Hack Daemon. Everything a tool shows comes from a real source during a real run.
Nothing is seeded, recorded or simulated.

```
npm install
npm run dev            # http://127.0.0.1:5190
npm run dev:keychain   # same, with an OpenRouter key read from the macOS keychain
npm run build          # typecheck + production build
```

## The flow

1. `#/` the hub: "Roblox Daemon Toolkit" and one 16:9 tile per tool.
2. `#/t/<tool>` the tool: the tile morphs into a card on the left, the description and **Try Demo** arrive on the right.
3. `#/demo/<tool>` the dashboard: tool switcher (top left), Keys, credits for that tool, an input, and a right-hand list of
   everything that tool is watching, with a **+** to add another.

A shareable link: `#/demo/hack-daemon?game=<roblox link or place id>`. It only prefills the input. Nothing starts until
you press the tool's button.

## Daemons

Every target you add becomes a daemon: a record on the server (in `.data/`) with a tool, a target, an interval and an
on/off switch. The dev server's scheduler reruns it when it is due, by default every 12 hours (6, 12 or 24 in the app).
A scheduled rerun costs the same credits as a manual one, and a rerun marks which findings are new since the last run.

- The right-hand list is the daemon list. Close the tab, reload, or restart the server and the list comes back.
- The daemon bar under each target header shows the switch and interval, the countdown to the next run, how the last run
  went, **Run now** with its real cost, the run history, and Remove.
- Runs execute on the server and keep going if the browser tab closes. Events are saved, so reopening the page replays
  the run and follows it live if it is still going.
- A daemon that cannot pay for its next run pauses itself and says "Out of credits".
- The scheduler lives in the Vite dev server process. If that process is stopped, reruns wait; an overdue daemon runs
  once when the server comes back, not once per missed interval.

## Credits

Credits are kept by the server, per tool, in `.data/credits.json`, and charged when a run starts. A run that fails is
refunded. Scale: Thumbnail Daemon starts at 10,000 and costs 250 per variant; the other five start at 5,000
(Hack and DMCA 1,500 per run; Discord, Description and Creator 1,000 per run). **Add credits** adds 5,000 to the
Thumbnail Daemon and 2,500 to the others. There is no payment: it is a local allowance that shows what a run costs.

## What each tool uses

| Tool | Real source | Needs |
|---|---|---|
| All game tools | Game link, title, description, players, visits and gallery thumbnails from Roblox public APIs. | Nothing. |
| Thumbnail Daemon | Variants generated live by Nano Banana 2.1 (`gemini-nano-banana-2.1`) when you press the button. Prompt: "Make a variant of this thumbnail with a novel perspective", with the thumbnail attached, 3 per gallery thumbnail. Its daemon is a free watcher that re-reads the gallery and flags new or changed thumbnails; it never generates or spends credits by itself. | A Gemini or OpenRouter key. |
| Hack Daemon | YouTube search results for exploit videos about the game. It names the vulnerability class, the affected game system and a server-side fix, and never outputs exploit code or download links. | An OpenRouter key. |
| DMCA Daemon | Roblox search for candidate copies of the game, each linked so you can check it. It prepares evidence and a draft notice. | An OpenRouter key. |
| Discord Daemon | Recent messages from your own server, read by your own bot, summed up as sentiment per person. Quotes are short excerpts. | A Discord bot token, the Message Content intent, and an OpenRouter key. |
| Description Daemon | The live Roblox description, drafted again and linted for policy. | An OpenRouter key. |
| Creator Dox | Public YouTube channel data for creators covering the game. Only public data; no private details. | An OpenRouter key. |

### What is and is not automated

- Nothing files a takedown. Roblox Rights Manager has no public API, so DMCA filing is a human step. The tool finds
  candidates, links them and prepares the notice. A wrong takedown carries liability under 17 U.S.C. 512(f), and a
  look-alike is never labelled certain.
- Description drafts are suggestions. You apply them on the Roblox game page.
- The Discord Daemon only reads servers where you have added your own bot, and never direct messages.

## Keys

Press **Keys** on any tool. Paste one key and the server decides what it is for:

- `sk-or-...` is an OpenRouter key. It serves image generation **and** the analysis the other five tools do, so one
  OpenRouter key runs the whole toolkit.
- Anything else is treated as a Gemini key (`AIza...`, billing enabled). It serves image generation only.
- The Discord bot token has its own dialog (Keys, then Discord bot token). Create a bot in the Discord developer portal,
  turn on the Message Content intent, invite it to your server with View Channels and Read Message History, and paste
  the token.

Keys are stored on this machine in `.data/secrets.json` (file mode 0600, git-ignored) and are never sent back to the
browser: the app only learns which keys exist. Images cost about $0.034 each; analysis calls cost a fraction of a cent.
A key left in this browser by an older build is deleted on first load.

You can also give the server a key from outside the app:

- **macOS keychain:** `npm run dev:keychain` reads an OpenRouter key from the keychain item named `OPENROUTER_API_KEY`
  (override with `KEYCHAIN_SERVICE` and `KEYCHAIN_ACCOUNT`) into the server's environment at launch. It is never
  written to a file.
- **Environment:** `GEMINI_API_KEY` or `OPENROUTER_API_KEY` in `.env.local` (git-ignored; see `.env.example`) or your
  shell. A Gemini key wins for images when both are set.

Without a key a tool does not invent anything: the run fails with an action that opens the Keys dialog, and the credits
are returned.

## The `.data` folder

Everything the server remembers lives in `.data/` (override with `DAEMON_DATA_DIR`): daemons, run events, credits and
secrets. It is git-ignored. Delete it to start from scratch. Point `DAEMON_DATA_DIR` at a temporary folder to test
without touching your real list.

## Code map

- `src/pages/Demo.tsx` and `src/demo/shell/**`: the dashboard, daemon bar, keys dialog, list and add card.
- `src/demo/findings/**`, `src/demo/thumbnail/**`, `src/demo/discord/**`: the per-tool workspaces and Discord pieces.
- `src/lib/api.ts`: the typed client for the server. `src/lib/runTypes.ts`: the wire types for runs and daemons.
- `server/`: the API, run engine, scheduler, credits, secrets and one analyzer per tool in `server/tools/`.
  `server/test/` has mocks of the image providers and Discord; tests never call the real services.
