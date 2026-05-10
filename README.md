# Megalodon - MegaEth NFT Discord Verification Bot

A Discord bot that verifies MegaEth NFT ownership through a secure OpenSea bio-based verification system. Users can prove they hold NFTs from specified collections and automatically receive Discord roles.

## Overview

Megalodon provides a seamless way to grant Discord roles based on actual NFT ownership on the MegaEth chain. The verification process is secure, uses time-limited tokens, and supports multiple NFT collections with different role assignments.

## Features

- **Secure Bio Verification**: Users prove ownership by adding a unique token to their OpenSea bio
- **Multi-Collection Support**: Configure multiple MegaEth collections, each with their own roles and verification channels
- **Smart Role Assignment**: Check if users already have roles before assigning (prevents redundant assignments)
- **Automatic Cleanup**: Temporary verification messages auto-delete after completion
- **Multi-Wallet Support**: Users can verify multiple wallets without repeated bio verification
- **Real-time NFT Display**: Shows users which specific NFTs they own after verification
- **Audit Trail**: SQLite database tracks all verified wallets and verification attempts

## How Verification Works

1. User clicks "Start Verification" button in a designated Discord channel
2. User provides their Ethereum wallet address via a modal
3. Bot generates a unique `MEGALODON-[random]` verification token
4. User adds token to their OpenSea bio within a 5-minute window
5. Bot polls OpenSea API every 10 seconds to detect the bio update
6. Once bio verified, bot queries OpenSea for NFTs in the configured collection
7. If NFTs found, bot assigns the configured Discord role
8. Temporary messages auto-delete, leaving only the success message (briefly)

For returning users verifying a previously used wallet, steps 3-5 are skipped and the bot immediately checks current NFT holdings.

## Installation

### Requirements

- Node.js 18 or higher
- Discord Bot token (with Guilds intent enabled)
- OpenSea API key
- A Discord server where you can manage roles and create channels

### Setup Steps

1. **Clone and install dependencies**:
```bash
git clone https://github.com/0xalteeer/megalodon.git
cd megalodon
npm install
```

2. **Configure your Discord bot**:
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application or select existing one
   - Go to Bot section and copy your token
   - Enable "Guilds" intent in the Intents section
   - Add these permissions to the bot: View Channels, Send Messages, Read Message History, Manage Roles

3. **Create `.env` file** with your API keys:
```
megalodon_token=YOUR_DISCORD_BOT_TOKEN
opensea_api_key=YOUR_OPENSEA_API_KEY
```

4. **Configure collections** in `collections-config.json`:
```json
{
  "collections": [
    {
      "id": "world-computer-netizens-megaeth",
      "name": "World Computer Netizens",
      "roleId": "YOUR_DISCORD_ROLE_ID",
      "channelId": "YOUR_VERIFICATION_CHANNEL_ID"
    }
  ]
}
```

5. **Start the bot**:
```bash
npm start
```

You should see:
```
✅ Bot logged in as megalodon#XXXX
✅ Verification embed sent and pinned for collection: world-computer-netizens-megaeth
```

## Configuration

All configuration is done through two files:

### `.env` - API Keys (DO NOT COMMIT)
```
megalodon_token=YOUR_DISCORD_BOT_TOKEN
opensea_api_key=YOUR_OPENSEA_API_KEY
```

### `collections-config.json` - Collections and Roles
```json
{
  "collections": [
    {
      "id": "collection-slug-from-opensea",
      "name": "Display Name",
      "roleId": "DISCORD_ROLE_ID",
      "channelId": "VERIFICATION_CHANNEL_ID"
    },
    {
      "id": "another-collection",
      "name": "Another Collection",
      "roleId": "ANOTHER_ROLE_ID",
      "channelId": "ANOTHER_CHANNEL_ID"
    }
  ]
}
```

To find the correct collection slug, visit OpenSea, navigate to your collection, and check the URL: `opensea.io/collection/{slug}`

## Database

The bot uses SQLite to track verification data in `verification.db` (auto-created on first run).

**verified_wallets** table:
- `id`: Unique identifier
- `user_id`: Discord user ID
- `wallet_address`: Ethereum wallet address
- `verified_at`: Timestamp of verification

**verification_attempts** table:
- `id`: Unique identifier
- `user_id`: Discord user ID
- `wallet_address`: Ethereum wallet address
- `token`: Generated verification token (MEGALODON-[token])
- `created_at`: When attempt was created
- `completed_at`: When verification completed (null if failed)
- `success`: 1 if successful, 0 if failed

Query the database manually:
```bash
sqlite3 verification.db
> SELECT * FROM verified_wallets;
> SELECT * FROM verification_attempts WHERE success = 1;
```

## Discord Bot Permissions

The bot requires these permissions in verification channels:
- **View Channels**: See the channel
- **Send Messages**: Send verification embeds and messages
- **Read Message History**: Check for existing verification embeds
- **Manage Roles**: Assign roles to users

The bot role must be positioned **above** all roles it assigns in the server's role hierarchy.

## Understanding the Verification Flow

### New User Flow
```
User clicks "Start Verification"
  ↓
User enters wallet address
  ↓
Bot generates token (MEGALODON-abc123...)
  ↓
User adds token to OpenSea bio
  ↓
Bot polls and detects bio update (every 10 seconds, max 5 minutes)
  ↓
Bot checks OpenSea for NFTs in collection
  ↓
NFTs found → Bot assigns role
NFTs not found → Bot notifies user
```

### Returning User Flow
```
User enters previously verified wallet
  ↓
Bot detects prior verification
  ↓
Bot immediately checks current NFT holdings
  ↓
Role assigned if user still holds NFTs
```

### Role Assignment Logic
- Bot checks if user **already has** the target role
- If yes: Skips assignment, displays owned NFTs
- If no: Assigns role and displays owned NFTs

## Troubleshooting

### "Used disallowed intents" Error
- Go to Discord Developer Portal → Your Application → Bot
- Enable "Guilds" intent
- Restart the bot

### Bot Not Responding
- Verify bot token is correct in `.env`
- Ensure bot has Guilds intent enabled
- Check bot has required permissions in verification channel
- Verify bot is in the correct Discord server

### "Wallet Not Found on OpenSea" Error
- Verify wallet address is correct (case doesn't matter, bot normalizes to lowercase)
- Check that wallet actually exists on OpenSea
- Ensure OpenSea API key is active and valid

### "NFTs Not Detected" Error
- Verify user actually owns NFTs in the configured collection
- Check collection ID in `collections-config.json` matches OpenSea collection slug
- Ensure NFTs are on the MegaEth chain specifically
- Verify OpenSea API key has sufficient quota

### Bio Update Not Detected
- User must update their OpenSea profile bio within 5 minutes
- Token must be **exact** (case-sensitive)
- Verify OpenSea API key is active
- Check bot logs for API errors

### Role Not Assigned
- Verify role ID is correct in `collections-config.json`
- Check bot role is positioned above the target role in Discord role hierarchy
- Ensure bot has "Manage Roles" permission in the server
- Verify the role exists in the Discord server

## Project Structure

```
megalodon/
├── verificationBot.js           # Main bot logic and Discord interactions
├── database.js                  # SQLite database operations
├── collections-config.json      # Configuration for NFT collections and roles
├── verification.db              # SQLite database (auto-created)
├── package.json                 # Dependencies and scripts
├── .env                         # Environment variables (API keys only)
├── LICENSE                      # MIT License
└── README.md                    # This file
```

## File Descriptions

- **verificationBot.js**: Main application. Handles Discord interactions, OpenSea API calls, role assignment, and message management.
- **database.js**: SQLite database helper functions. Manages verified wallets and verification attempts.
- **collections-config.json**: JSON configuration file for collections. Add/edit collections here without modifying code.
- **verification.db**: SQLite database file. Created automatically on first run, stores all verification data.

## Security Considerations

- **Token-based Verification**: Users prove ownership through a unique token placed in their OpenSea bio
- **Time-limited Tokens**: Verification window is 5 minutes; tokens expire after
- **Wallet Validation**: Validates Ethereum address format before processing
- **API Keys Protected**: Sensitive keys stored in `.env`, never hardcoded
- **Audit Trail**: All verification attempts logged to database with timestamps
- **No Private Keys**: Bot never requests or stores private keys

## Common Questions

**Q: Can I add more collections?**
A: Yes! Edit `collections-config.json` and add more collection objects to the array. Restart the bot.

**Q: What if a user loses their wallet or keys?**
A: They can verify again with a different wallet. The bot supports multi-wallet verification.

**Q: What happens if a user sells their NFTs?**
A: The role persists. Consider implementing a periodic check or manual role removal if needed.

**Q: Can I change the 5-minute verification timeout?**
A: Yes, in `verificationBot.js`, change `VERIFICATION_TIMEOUT: 5 * 60 * 1000` to your desired milliseconds.

**Q: How often should I back up the database?**
A: Regularly. The `verification.db` file contains all verification history. Consider regular backups for production use.

## Support & Issues

If you encounter issues:
1. Check the troubleshooting section above
2. Review bot console output for error messages
3. Verify all configuration values are correct
4. Check Discord permissions and role hierarchy
5. Ensure OpenSea API key is valid and has quota available

## License

MIT License - See LICENSE file for details

