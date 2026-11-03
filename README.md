# Nextleaf Server

Self-hosted task management, a responsive browser interface and optional device
synchronization. Open source under GPL-3.0-only; see LICENSE and THIRD_PARTY_NOTICES.txt.
This repository contains the server and web application. Native client targets,
signing material and native installation packages are maintained separately.

Organize tasks in Parallel or Sequential projects, use Focus, Waiting, Scheduled,
Someday and Later, save Perspectives and run a Review whenever you need one.
Inbox is always available for clarification; projects and standalone lists have
their own review intervals. Four themes and configurable sidebar entries are included.

## Run from source

Use Node 22.23.2 or newer in the Node 22 line and Rust 1.99.1 (the versions pinned
in the Dockerfile). Python 3 is used by deployment checks.

```sh
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
mkdir -p data
cd backend
TASKMANAGER_DATABASE_URL=sqlite://../data/taskmanager.db \
  TASKMANAGER_WEB_DIR=../frontend/dist cargo run --locked --bin nextleaf-server
```

Open http://127.0.0.1:8787. For frontend development, run
`npm --prefix frontend run dev` alongside the backend.

## Deploy

Build locally on the server with `docker build -t nextleaf-server:0.1.5-local .`.
See [installation and backup](docs/DEPLOYMENT.md) for Compose, private HTTPS,
upgrades and recovery. The initial source split does not imply that prebuilt
images or download releases exist; build from source until a tested release is published.

Keep the ordinary web/API/sync listener private. It is a single-owner service;
its REST API has no public login. Tailscale Serve can provide private HTTPS.
Tailscale is separate software, not part of Nextleaf's synchronization engine.
Never expose the app listener with Funnel or a public reverse proxy.

Optional agent access uses the separate authenticated MCP endpoint. See
[MCP](docs/MCP.md). Sync protocol 6 includes Perspectives and Review; incompatible
clients are rejected before writing. Keep client and server versions compatible.

## Development

`cargo test --locked --manifest-path backend/Cargo.toml` runs backend tests.
The frontend command above runs its tests; `npm --prefix frontend run build`
checks types and production bundling. Container builds run both test suites.
All GTD, validation, scheduling and merge rules live in the Rust backend.

Public history starts with a server-only snapshot. Older licenses granted for
previously published Nextleaf versions remain valid. No private app Git history
is imported into this repository.
