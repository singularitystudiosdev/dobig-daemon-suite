# Roblox Daemon Toolkit

Six tools for live operated Roblox games, styled after dobig.com/games: Creator Dox, Thumbnail Daemon,
Discord Daemon, Description Daemon, DMCA Daemon and Hack Daemon.

```
npm install
npm run dev        # http://127.0.0.1:5190
npm run build      # typecheck + production build
```

## The flow

1. `#/` the hub: "Roblox Daemon Toolkit" and one 16:9 tile per tool.
2. `#/t/<tool>` the tool: the tile morphs into a card on the left, the description and **Try Demo** arrive on the right.
3. `#/demo/<tool>` the dashboard: tool switcher (top left), credits for that tool, a game link input, and a
   right-hand list of games with a **+** to add another.

A shareable demo link: `#/demo/thumbnail-daemon?game=<roblox link or place id>`. It only prefills the input. Nothing
starts until you press the tool's button (or Enter in the input).

## What is real and what is simulated

| | |
|---|---|
| Game link, title, description, players, visits, gallery thumbnails | **Real**, from Roblox public APIs through the dev server (`/api/game`). |
| Thumbnail Daemon variants | **Real**, generated live by Nano Banana 2.1 (`gemini-nano-banana-2.1`) each time you press the button. Prompt: "Make a variant of this thumbnail with a novel perspective", with the thumbnail attached, 3 per gallery thumbnail. Nothing is pre-made, recorded or stored. |
| Creator Dox, Discord, Description, DMCA and Hack findings | **Simulated** from seeded demo datasets keyed to the game. Labelled "Simulated demo data". |
| Credits | Mock, stored in the browser per tool. |

## Generating thumbnails

Nothing is generated until you press the button. Every press, including Regenerate and a retry, is a fresh live call
to Nano Banana 2.1 from the dev server, one per tile. It needs a paid image key, at about $0.034 per variant, so a
four-thumbnail game is 12 variants, roughly $0.41. Two providers serve the same model:

- **Google Gemini API** (`gemini-nano-banana-2.1`): a key starting `AIza`, billing enabled. There is no free tier.
- **OpenRouter** (`google/gemini-nano-banana-2.1`): a key starting `sk-or-`, with credits.

Give the server a key one of these ways:

- **macOS keychain:** `npm run dev:keychain` reads an OpenRouter key from the keychain item named
  `OPENROUTER_API_KEY` (override with `KEYCHAIN_SERVICE` and `KEYCHAIN_ACCOUNT`) into the server's environment at
  launch. It is never written to a file.
- **Environment:** `GEMINI_API_KEY` or `OPENROUTER_API_KEY` in `.env.local` (git-ignored; see `.env.example`) or your
  shell. A Gemini key wins when both are set.
- **In the app:** paste a key into the **Key** dialog on the Thumbnail Daemon dashboard. It is kept in this browser and
  sent only to your local server, as a request header.

Without a key nothing is generated: the dashboard says a key is needed and returns the credits.

Server code is in `server/`: Roblox link parsing and gallery fetch (60 requests a minute, `retry-after` honoured),
both image providers, and an NDJSON stream of results. `server/test/` holds a mock of both providers and a smoke test
(usage in the header of `smoke.mjs`); the tests never call the real services.
