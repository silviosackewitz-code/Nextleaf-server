# Nextleaf server setup: instructions for an AI agent

You are an AI agent setting up a Nextleaf sync server for a person who may not be
technical. Follow these instructions exactly. Where they do not cover a situation,
stop and ask the user instead of improvising.

Written on 2026-11-11. The example image tags below follow the server version.

## Hard rules

1. **Never expose the server listener publicly.** The web, REST and sync listener
   (container port 8787) has no login. Anyone who reaches it can read and change
   all tasks. A Host allowlist (`NEXTLEAF_HTTP_HOSTS`) is not authentication.
2. **Never use Tailscale Funnel, port forwarding, a public reverse proxy or an
   opened firewall port for port 8787.** Use only Tailscale Serve, which stays
   inside the user's tailnet.
3. **Never delete, empty or overwrite an existing data folder**, `.env` file or
   Compose configuration. If an installation already exists, stop and ask.
4. **Make a backup before any update** (see "Updates" below).
5. **Ask the user before installing software** (Docker, Tailscale, Node, Rust) and
   **before changing firewall settings**. Explain in one sentence what and why.
6. **Never ask the user for passwords, keys or tokens in the chat.** If a command
   needs `sudo` or a sign-in, let the user type it into their own terminal or the
   browser window that the tool opens.
7. Do not print or commit secrets. Keep `.env` at mode `0600`.
8. Do not report a step as done unless you ran it and checked its output.

## Facts from the repository

All paths are relative to a clone of
`https://github.com/silviosackewitz-code/Nextleaf-server`.

- `Dockerfile` builds the image from source. It runs the frontend and backend
  tests during the build. The container runs as UID/GID 10001, listens on 8787
  and stores its database at `/data/taskmanager.db`.
- `deploy/release/docker-compose.yml` publishes the port only on host loopback
  (`127.0.0.1:8787:8787`), mounts `${NEXTLEAF_DATA_DIR:-/srv/nextleaf}` to
  `/data`, and does **not** create a missing data folder
  (`create_host_path: false`).
- `deploy/release/example.env` is the environment template. It sets
  `TASKMANAGER_IMAGE`, `NEXTLEAF_DATA_DIR`, `NEXTLEAF_MCP_TOKEN` (leave empty;
  MCP is optional and not part of this setup), `NEXTLEAF_MCP_HOSTS` and a
  commented `NEXTLEAF_HTTP_HOSTS`.
- `GET /api/health` returns JSON with `"status":"ok"` and a `capabilities` list
  that names the sync version as `sync-vN`.
- **No prebuilt image or download release exists.** The repository has no
  published releases. You must build the image from source on the target machine
  (README.md, "Deploy"; docs/DEPLOYMENT.md says to build on the target
  architecture). Use a tag that names the version in `backend/Cargo.toml`, for
  example `nextleaf-server:0.4.0-local`; the environment templates carry the
  same example tag.
- The Nextleaf app accepts a sync address only if it starts with `https://`. The
  only exceptions are `http://localhost`, `http://127.0.0.1` and `http://[::1]`.
  A phone therefore needs the `https://` address from Tailscale Serve.

## Step 0: inspect before changing anything

Find out, and tell the user, before you continue:

- Which target this is: the user's laptop for a trial, a Raspberry Pi or other
  Linux computer at home, or a VPS.
- Whether Nextleaf is already installed: does `/opt/nextleaf-app` or
  `/srv/nextleaf` exist, does `docker ps` show a Nextleaf container, is anything
  already using port 8787? If yes, **stop**. Do not reinstall. Ask the user, and
  use "Updates" below only with their agreement.
- Whether Docker (with the Compose plugin), Git and Tailscale are installed.
- On a laptop or Pi: whether the user wants only a one-computer trial or also a
  phone.

## Target A: laptop, local trial

Use this when the Nextleaf app and the server run on the same Mac. The app address
is then `http://localhost:8787`. No Tailscale is needed for this.

**Option A1: run from source** (README.md, "Run from source"). Needs Node 22
(22.23.2 or newer in that line) and Rust 1.99.1. Ask before installing them.

```sh
git clone https://github.com/silviosackewitz-code/Nextleaf-server.git
cd Nextleaf-server
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
mkdir -p data
cd backend
TASKMANAGER_DATABASE_URL=sqlite://../data/taskmanager.db \
  TASKMANAGER_WEB_DIR=../frontend/dist cargo run --locked --bin nextleaf-server
```

The server binds to `127.0.0.1:8787` by default (`backend/src/lib.rs`). It runs
only while this terminal command runs. The data is in the `data` folder of the
clone; do not delete it.

**Option A2: Docker.** The Compose file and the steps in Target B are written for
Linux. Running them under Docker Desktop on macOS or Windows (data folder owned
by UID 10001, paths outside `/srv`) is **not covered or tested** by the
repository. If you use it, set `NEXTLEAF_DATA_DIR` to an absolute folder in the
user's home directory, tell the user that this path is untested, and verify
health and a restart before you report success.

**Adding a phone to a laptop trial.** Install Tailscale on the laptop and the
phone (ask first), then follow "Private HTTPS with Tailscale Serve" below on the
laptop. Tell the user that sync works only while the laptop is on and awake.

Health check:

```sh
curl --fail http://127.0.0.1:8787/api/health
```

## Target B: Raspberry Pi or other Linux computer at home

Prerequisites (ask before installing): Docker Engine with the Compose plugin
(https://docs.docker.com/engine/install/), Git, and Tailscale
(https://tailscale.com/download/linux). Building on a Raspberry Pi compiles Rust
and can take a long time; the repository gives no build time or memory figure.
Use a 64-bit operating system; the release workflow targets ARM64 and AMD64.

1. Clone and build (from docs/DEPLOYMENT.md, with the current version tag):

   ```sh
   git clone https://github.com/silviosackewitz-code/Nextleaf-server.git
   cd Nextleaf-server
   grep '^version' backend/Cargo.toml
   sudo docker build -t nextleaf-server:0.4.0-local .
   ```

   Use the version printed by `grep` in the tag. If the user is in the
   `docker` group, `sudo` is not needed for Docker commands.

2. Install configuration and an empty data folder (docs/DEPLOYMENT.md; fresh
   installation only):

   ```sh
   sudo install -d -m 0750 /opt/nextleaf-app
   sudo install -d -o 10001 -g 10001 -m 0700 /srv/nextleaf
   sudo install -m 0644 deploy/release/docker-compose.yml /opt/nextleaf-app/docker-compose.yml
   sudo install -m 0600 deploy/release/example.env /opt/nextleaf-app/.env
   ```

3. Edit `/opt/nextleaf-app/.env`: set `TASKMANAGER_IMAGE` to the exact tag you
   built. Keep `NEXTLEAF_DATA_DIR=/srv/nextleaf` and leave `NEXTLEAF_MCP_TOKEN`
   empty.

4. Validate and start:

   ```sh
   sudo docker compose --env-file /opt/nextleaf-app/.env -f /opt/nextleaf-app/docker-compose.yml config --quiet
   sudo docker compose --env-file /opt/nextleaf-app/.env -f /opt/nextleaf-app/docker-compose.yml up -d --wait
   sudo docker compose --env-file /opt/nextleaf-app/.env -f /opt/nextleaf-app/docker-compose.yml ps
   curl --fail http://127.0.0.1:8787/api/health
   ```

   Do not run `docker compose pull`; the image exists only locally. If health
   fails, read the logs before anything else:

   ```sh
   sudo docker compose --env-file /opt/nextleaf-app/.env -f /opt/nextleaf-app/docker-compose.yml logs --tail 100
   ```

5. Follow "Private HTTPS with Tailscale Serve" below.

## Target C: VPS

Same as Target B, with these additions:

- The Compose file publishes port 8787 only on `127.0.0.1`. Do not change that
  mapping. Do not open port 8787 (or 443 for Nextleaf) in the provider's firewall
  or on the host. Nextleaf is reached only through Tailscale Serve.
- If the VPS firewall blocks Tailscale itself, tell the user and ask before
  changing anything. Follow https://tailscale.com/kb for the specific firewall.
- Tell the user that the hosting provider stores the disk that holds their tasks,
  and that backups on the same VPS do not protect against losing the VPS.

## Private HTTPS with Tailscale Serve

The server computer and every phone or computer that syncs must be in the same
tailnet. HTTPS certificates must be allowed in the tailnet; Tailscale guides the
user through that when needed. Reference:
https://tailscale.com/docs/reference/tailscale-cli/serve

1. Check what is already configured, so you do not replace another service:

   ```sh
   sudo tailscale serve status
   sudo tailscale funnel status
   ```

   If HTTPS port 443 is already used by another service, stop and ask the user.

2. Enable Serve for Nextleaf (from the repository's installation guide):

   ```sh
   sudo tailscale serve --bg http://127.0.0.1:8787
   sudo tailscale serve status
   ```

   On macOS, use the `tailscale` command as described in Tailscale's documentation
   for the user's Tailscale app variant; `sudo` may not apply.

3. Read the `https://<machine>.<tailnet>.ts.net` address from the status output.
4. For Docker installs, set `NEXTLEAF_HTTP_HOSTS` in `/opt/nextleaf-app/.env` to
   that exact hostname: no `https://`, no port, no path, no wildcard. Recreate:

   ```sh
   sudo docker compose --env-file /opt/nextleaf-app/.env -f /opt/nextleaf-app/docker-compose.yml up -d --wait
   ```

   Without this, requests through the Tailscale hostname are refused with
   "Untrusted Host or Origin". For Option A1, start the server with
   `NEXTLEAF_HTTP_HOSTS=<hostname>` in front of the `cargo run` command.
5. Check that Funnel is **not** enabled for this port (`tailscale funnel status`).
6. If the tailnet is shared with other people, tell the user that everyone who
   can reach this machine on port 443 can read and change their tasks, and that
   Tailscale access rules can restrict this. Do not change those rules yourself.

## Updates

Before any update: stop the stack, back up the complete data folder and the
configuration with permissions preserved, and keep the old image. Never copy only
the live `.db` file while the server runs. Then build a new image with a new tag,
change `TASKMANAGER_IMAGE`, start, and check health. Details:
[DEPLOYMENT.md](DEPLOYMENT.md). Update the server and the apps so their sync
versions match; an incompatible app is refused without changing data.

## Verification checklist

Check every item and report each result to the user:

- [ ] `curl --fail http://127.0.0.1:8787/api/health` on the server returns
      `"status":"ok"` and the capabilities include one `sync-vN` entry.
- [ ] For Docker: `docker compose ... ps` shows the service healthy and the port
      as `127.0.0.1:8787->8787/tcp`, not `0.0.0.0`.
- [ ] For a phone: `curl --fail https://<hostname>/api/health` succeeds from
      another device in the tailnet.
- [ ] `tailscale funnel status` shows no Funnel for Nextleaf.
- [ ] No firewall rule, router port forward or public proxy points to port 8787.
- [ ] After `docker compose ... up -d --wait` a second time (or a restart of the
      source server), the health check still succeeds and the data folder still
      exists.
- [ ] The data folder location and the backup method are written down for the
      user.

## What to tell the user at the end

Give the user one sentence with the exact address, for example:

> Open Nextleaf, go to **Settings → Local data and sync**, type
> `https://<machine>.<tailnet>.ts.net` into the address field (it shows
> `https://your-server` while empty) and press **Connect and sync**. Enter the
> same address on every device you want to sync.

For a one-Mac trial without Tailscale, the address is `http://localhost:8787`.
Also tell them: the server has no password yet, so it must stay inside Tailscale;
and where the data folder is, so they can back it up.
