# Hosting the tools for the GitHub Pages link

The Pages site is static. To let its "Try Demo" buttons run the real tools, run one small server and point the site at it. The server is the same API you run locally plus the built site, on one port, behind an access code.

## What you need

- A host that runs a Docker image (or Node 24) and gives you a **persistent volume**. Saved daemons, credits, keys and generated images live in `/data`; without a volume they vanish on every deploy.
- One machine that stays on. The 12-hour reruns run inside the server, so do not let the host stop it when idle.
- An OpenRouter key.

## Environment variables

| Variable | Needed | What it does |
| --- | --- | --- |
| `API_ACCESS_CODE` | yes | The code visitors type. The server refuses to start without it (unless `ALLOW_OPEN_API=1`, never use that on a public host). Use a long random string. |
| `OPENROUTER_API_KEY` | yes | The key every run spends. |
| `CORS_ORIGIN` | yes for Pages | Comma separated exact origins allowed to call the API, e.g. `https://singularitystudiosdev.github.io`. No trailing path. |
| `REQUESTS_WEBHOOK_URL` | optional | Where "contact us" requests are forwarded. |
| `TRUST_PROXY` | set to `1` on a host with a proxy | Reads the visitor IP from `x-forwarded-for` for the wrong-code limit. Leave unset when the server is reached directly. |
| `PORT`, `HOST` | no | Default `8080` and `0.0.0.0`. |
| `DAEMON_DATA_DIR`, `DAEMON_CACHE_DIR` | no | Already `/data` and `/data/cache` in the image. |

The Roblox Open Cloud key and the Discord bot token are not environment variables: enter them in the app's Keys dialog once the site is connected. They are stored on the volume.

## Fly.io

```sh
fly launch --no-deploy --name your-app-name
fly volumes create data --size 1
fly secrets set API_ACCESS_CODE="$(openssl rand -base64 24)" OPENROUTER_API_KEY=sk-or-... CORS_ORIGIN=https://singularitystudiosdev.github.io TRUST_PROXY=1
fly deploy
```

Before `fly deploy`, make `fly.toml` say this (the volume, one always-on machine, the port):

```toml
[mounts]
  source = "data"
  destination = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  min_machines_running = 1
```

Read the access code back with `fly ssh console -C "printenv API_ACCESS_CODE"`, or pick your own and pass it to `fly secrets set`. The server is at `https://your-app-name.fly.dev`.

## Render or Railway

Create a web service from this repository with the Dockerfile, attach a disk or volume mounted at `/data`, and set the variables above (and `TRUST_PROXY=1`).

## Connect the Pages site

```sh
gh variable set API_BASE --body https://your-app-name.fly.dev
gh workflow run pages.yml
```

No trailing slash. The rebuilt site now calls your server. The first time a visitor opens a tool it asks for the access code and keeps it in that browser. To go back to the read-only preview, delete the variable (`gh variable delete API_BASE`) and re-run the workflow.

Try it without Pages: open `https://your-app-name.fly.dev` itself, which serves its own copy of the site.

## What to expect

- Anyone who has the access code spends your OpenRouter key. Share it only with people you trust, and change it with `fly secrets set API_ACCESS_CODE=...` to cut everyone off.
- Credits are per tool for the whole server, not per visitor. When they run out for one person they run out for all.
- Ten wrong codes in a minute from one address lock that address out for the rest of the minute, even for the right code.
- Generated thumbnails (`/api/img/...`) are readable without the code, because an image tag cannot send one. They are cached copies of public Roblox thumbnails.
- YouTube often shows a bot check to data-center IPs, so Hack and Content Creator may return partial results from a hosted server.
- Roblox rate limits apply per server IP, shared by every visitor.
- The Discord bot token and the Open Cloud key are stored on the server's volume. Whoever can open the machine can read them.
- One machine, one volume: it does not scale out, and a deploy restarts it (running jobs are recorded as aborted).
