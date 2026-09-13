# Noir Music — Telegram Mini App

Personal MP3 library for Telegram: send an audio or `.mp3` file to the bot, then open the Mini App to play it and organise it into playlists.

## What is included

- Telegram long-polling bot with `/start`, `/app` and `/help`.
- MP3 receiving from `audio` and `document` Telegram messages.
- Local durable JSON library and MP3 storage.
- Telegram Mini App interface in black and white: library, player, create/edit playlists.
- Signed Telegram `initData` verification — users can only access their own audio.
- HTTP range support, so the browser player can seek through tracks.

## Run

1. Install a current Node.js release (Node 20+). No npm packages are required.
2. Copy `.env.example` to `.env`, put a **new** BotFather token in `BOT_TOKEN`, and set `APP_URL` to the public HTTPS URL where this server will run.
3. Run `node server.js` (or `npm start` if npm is available).
4. Send the bot an MP3 and tap **Open player**. On first start, the server registers the command list and the Telegram menu button automatically.

Telegram Mini Apps require HTTPS. For development you can expose port 3000 using a tunnel such as Cloudflare Tunnel, then set the resulting `https://…` URL as `APP_URL` and restart the server. Put persistent storage on a volume when deploying: `data/` contains metadata and `uploads/` contains MP3 files.

## Commands

- `/start` — introductory message and an Open player button
- `/app` — open the player
- `/help` — upload instructions

## Safety

The application does not embed credentials in frontend files. Do not send bot tokens in chats, commits, screenshots, or logs. If a token was shared, revoke/regenerate it in @BotFather before configuration.
