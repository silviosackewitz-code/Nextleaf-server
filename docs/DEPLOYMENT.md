# Installation, updates and backup

Use Docker and Compose on a Linux server or Raspberry Pi. Run the source build
on the target architecture. ARM64 and AMD64 are the release workflow targets.
Keep the service behind a trusted private network such as Tailscale.

```sh
docker build -t nextleaf-server:0.1.5-local .
sudo install -d -m 0750 /opt/nextleaf-app
sudo install -d -o 10001 -g 10001 -m 0700 /srv/nextleaf
sudo install -m 0644 deploy/release/docker-compose.yml /opt/nextleaf-app/docker-compose.yml
sudo install -m 0600 deploy/release/example.env /opt/nextleaf-app/.env
cd /opt/nextleaf-app
sudo docker compose up -d
curl --fail http://127.0.0.1:8787/api/health
```

Use these installation commands only for a fresh installation. On an existing
server, retain the existing .env, data path, OAuth configuration and overlays.
All later Compose operations must include the same overlays as the running stack.
The container runs as UID/GID 10001 and binds to host loopback port 8787.
Set NEXTLEAF_HTTP_HOSTS to the exact private HTTPS hostname when using Tailscale
Serve. A Host allowlist is not authentication: keep REST/web/sync private.

Before updating, stop the stack cleanly, back up the complete data directory and
deployment configuration with permissions preserved, and retain the old image.
Never copy only a live SQLite .db while WAL writers are active. A cleanly stopped
directory copy or SQLite backup API produces a consistent database backup.
Protect backups: tasks, notes, OAuth state and tokens are personal data.

Build the candidate image using a new immutable local tag. Test it with
`python3 deploy/check_container.py --image <candidate>` and, when available,
`--upgrade-from <previous-image>`. Change TASKMANAGER_IMAGE only after successful
checks, then start the stack and verify health, Review, sync and browser assets.
Database migrations are forward changes. To roll back, stop the stack and restore
the matching data/config/image backup together. Do not point an old binary at a
newer schema or overwrite newer client edits without reconciliation.

This source-only repository split does not change an already installed server,
its database, its hostname or its locally stored Docker images.
