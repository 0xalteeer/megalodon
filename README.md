# Megalodon — NFT Discord verification bot

Discord bot that verifies NFT ownership through OpenSea (bio-based proof) and assigns Discord roles from `collections-config.json`. Supports **multiple collections**, **multiple chains** (per collection), **multiple wallets per user**, and **periodic holding checks** so roles stay aligned with what users actually hold.

## Overview

Users prove they control a wallet by placing a time-limited token in an OpenSea profile bio. The bot polls OpenSea, then queries NFT holdings per configured collection (using each collection’s `chain`). Verified wallets and holding counts are stored in SQLite; roles are granted or removed using **aggregate holdings across all verified wallets** for each collection.

## Features

- **Bio verification** — Unique `MEGALODON-…` token; user adds it to an OpenSea bio within a configurable window (default 5 minutes). Bio text is merged from the wallet account payload and related resolved identities (e.g. linked profile paths OpenSea exposes).
- **Per-collection chain** — Each collection sets its own `chain` (for example `megaeth`, `ethereum`) for OpenSea API queries; not hardcoded to a single network.
- **Multi-collection** — Each collection can have its own `roleId` and verification `channelId`.
- **Wallet management UI** — **Manage Wallets** lists verified addresses, current holding counts (only collections with holdings, or a short message if none grant roles), **add** another wallet, or **delete** a wallet with confirmation. Deleting re-evaluates roles from remaining wallets.
- **Returning wallets** — If the address was already verified, the bot can **refresh holdings** without repeating the bio step (from a server verification flow).
- **Smart roles** — Adds a role when the user has at least one qualifying NFT in that collection; removes it only when **all** verified wallets show **zero** holdings for that collection (and the collection has a `roleId`).
- **Periodic checks** — Background job (default every **15 minutes**) re-fetches counts for verified users, updates the database, and adjusts roles. OpenSea errors for a specific wallet/collection are logged and **do not** overwrite `current_holding_count` for that pair on that run.
- **Audit data** — SQLite stores verified wallets (per user, address, and collection), holding counts, verification attempts, and assigned roles (`user_roles`).

## How verification works

1. User opens a configured verification channel and uses **Verify Wallet** or **Manage Wallets** → **Add Another Wallet**.
2. User submits a wallet address (0x + 40 hex chars).
3. **New address:** Bot creates a verification attempt, shows the token, and polls OpenSea for the token in the merged bio until timeout or success.
4. On success, the bot loads NFTs for **every** configured collection, upserts `verified_wallets` rows, and updates `current_holding_count` per collection.
5. Roles are applied via `RoleManager` (and removed if nothing qualifies).
6. Ephemeral follow-ups can be scheduled for auto-deletion after success or errors (see `VerificationFlow`).

**Already-verified address:** Holdings are refreshed from OpenSea, counts updated, and roles synced without a new bio challenge (must be used from inside the guild verification flow).

## Installation

### Requirements

- Node.js 18+
- Discord application / bot token
- OpenSea API key
- A server where the bot can manage roles and post in verification channels

### Setup

1. **Clone and install**

```bash
git clone https://github.com/0xalteeer/megalodon.git
cd megalodon
npm install
```

2. **Discord bot** ([Developer Portal](https://discord.com/developers/applications))

- Copy the bot token.
- Enable intents your deployment needs (the code registers **Guilds** and **Direct Messages**; ensure the bot can post and use components in your verification channels).
- Invite with permissions such as: View Channels, Send Messages, Read Message History, Manage Roles (and any others your server requires). The bot’s role must sit **above** roles it assigns.

3. **Environment — `.env`** (do not commit)

```
megalodon_token=YOUR_DISCORD_BOT_TOKEN
opensea_api_key=YOUR_OPENSEA_API_KEY
```

4. **`collections-config.json`** — Each collection needs `id` (OpenSea collection slug), `name`, optional `roleId`, `channelId` for the verification embed, and **`chain`** for API calls.

```json
{
  "collections": [
    {
      "id": "world-computer-netizens-megaeth",
      "name": "World Computer Netizens",
      "roleId": "YOUR_DISCORD_ROLE_ID",
      "channelId": "YOUR_VERIFICATION_CHANNEL_ID",
      "chain": "megaeth"
    }
  ]
}
```

Collection slug: from `https://opensea.io/collection/{slug}`. Use an OpenSea-supported `chain` value for the v2 API.

5. **Run**

```bash
npm start
```

On startup the bot ensures a pinned verification embed exists per configured `channelId`, then starts the periodic holding checker.

## Configuration

| Location | Purpose |
|----------|---------|
| `.env` | `megalodon_token`, `opensea_api_key` |
| `collections-config.json` | Collections, Discord role/channel IDs, per-collection `chain` |

### Tuning (code)

In `VerificationFlow` and `PeriodicChecker` / `verificationBot.js`, defaults include verification timeout, bio poll interval, and periodic check interval (see constructor arguments and where `PeriodicChecker` is constructed).

## Database (`verification.db`)

Created automatically. Important pieces:

- **`verified_wallets`** — `user_id`, `wallet_address`, `collection_id`, `verified_at`, `last_check_at`, `current_holding_count`.
- **`verification_attempts`** — Wallet, token, timestamps, success flag.
- **`user_roles`** — Tracks role assignments tied to `collection_id` for cleanup and periodic logic.

Example:

```bash
sqlite3 verification.db
SELECT * FROM verified_wallets;
```

## Discord permissions (summary)

- Post and use buttons/menus in verification channels.
- **Manage Roles**, with bot role ordered above assignable roles.

## Project layout

```
megalodon/
├── verificationBot.js    # Discord client, interactions, channel setup
├── VerificationFlow.js   # Token generation, bio polling, completion flow
├── NFTChecker.js         # OpenSea NFT queries per collection/chain
├── CollectionManager.js  # Loads collections-config.json
├── RoleManager.js        # Grant/remove roles from holding state
├── WalletManager.js      # Wallet list formatting, delete + role follow-up
├── UIManager.js          # Embeds, modals, buttons, select menus
├── PeriodicChecker.js    # Scheduled holding refresh
├── database.js           # SQLite access
├── collections-config.json
├── package.json
├── .env                  # local secrets (gitignored)
└── README.md
```

## Security notes

- Proof uses a **short-lived** public bio token, not private keys.
- Keys live in `.env` only.
- Verification attempts are logged for auditing.

## Troubleshooting

- **Intents / missing channel access** — Check Developer Portal intents and channel overwrites for the bot.
- **Wrong chain / no NFTs** — Confirm `chain` and collection `id` match OpenSea.
- **Role not applied** — Role ID, hierarchy, and `Manage Roles` must be correct.
- **Bio never detected** — Token must match exactly; user must save bio within the timeout; check API errors in logs.

## License

MIT — see `LICENSE`.
