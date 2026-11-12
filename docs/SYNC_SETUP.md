# Sync your devices

English · [Deutsch](SYNC_SETUP.de.md) · [Español](SYNC_SETUP.es-MX.md)

## You do not need a server

Nextleaf works on its own. Your tasks are saved on your device. You need a server
only if you want the same tasks on more than one device.

## What sync is and what you need

Sync copies changes between your devices through your own Nextleaf server. Nobody
else runs a server for you. You need:

- A computer that runs the server. Your laptop is fine for trying it out. For sync
  at any time, use a Raspberry Pi at home or a rented server (VPS).
- Tailscale, a private network between your own devices. At the time of writing
  (2026-11-11), Tailscale's "Personal" plan is free. Check
  [Tailscale's pricing](https://tailscale.com/pricing) for the current terms.

## Three ways

- **Your laptop.** Good for a first try. Sync only works while the laptop is on
  and awake.
- **A Raspberry Pi at home.** Always on, uses little power, and your data stays
  in your home.
- **A rented server (VPS).** Always on, and you do not need hardware at home. The
  hosting company stores your data on its machines.

## Let your AI assistant set it up

You do not have to type commands yourself. Open an AI assistant that can work on
your computer or server (for example Claude, Codex or a ChatGPT agent) and paste
this:

```text
Please set up a Nextleaf sync server for me. Follow the instructions in
https://github.com/silviosackewitz-code/Nextleaf-server/blob/main/docs/AGENT_SETUP.md
exactly. Ask me before you install software or change firewall settings.
Never ask me for passwords in the chat. When you are done, tell me the exact
address I have to type into the Nextleaf app and where to type it.
```

## Where to enter the address

In the app, open **Settings**, then **Local data and sync**. Type the address into
the address field (it shows `https://your-server` while empty) and press
**Connect and sync**.

## Try it on one Mac

If the server runs on the same Mac as the app, the address is
`http://localhost:8787`. This plain `http` address works only on that Mac.

## Add a phone

A phone needs an address that starts with `https://`. Install Tailscale on the
server computer and on the phone, and sign in to the same Tailscale account on
both. Your assistant turns on Tailscale Serve, which gives the server a private
`https://` address. Enter that address on every device.

## Safety

> **Never make the server reachable from the internet.** The server has no
> password yet. Anyone who can reach it can read and change all your tasks. Do
> not use port forwarding, a public proxy or Tailscale Funnel for it. Keep it
> inside your Tailscale network.

## Backups and updates

Make a backup before every update. Your assistant can follow
[DEPLOYMENT.md](DEPLOYMENT.md) for backups and updates.

The app and the server must have compatible versions. If they do not, the app
refuses to sync and changes nothing. Update both.

## Server password

A server password is planned. It is not available yet.

---

Written on 2026-11-11.
