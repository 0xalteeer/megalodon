const database = require('./database');
const CollectionManager = require('./CollectionManager');
const NFTChecker = require('./NFTChecker');

class PeriodicChecker {
  constructor(apiKey, interval = 15 * 60 * 1000) {
    this.nftChecker = new NFTChecker(apiKey);
    this.interval = interval;
  }

  async performCheck(client) {
    console.log('🔄 Starting periodic NFT holding check...');
    
    try {
      const guilds = client.guilds.cache;

      for (const [guildId, guild] of guilds) {
        try {
          await guild.roles.fetch().catch(() => {});

          const userIds = database.getDistinctVerifiedUserIds();

          for (const userId of userIds) {
            try {
              const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
              if (!member) continue;

              const wallets = database.getAllVerifiedWalletsByUser(userId);
              if (wallets.length === 0) continue;

              const canonicalByLower = new Map();
              for (const w of wallets) {
                const key = w.wallet_address.toLowerCase();
                if (!canonicalByLower.has(key)) {
                  canonicalByLower.set(key, w.wallet_address);
                }
              }

              for (const collection of CollectionManager.getAllCollections()) {
                let totalHoldings = 0;

                for (const walletAddress of canonicalByLower.values()) {
                  try {
                    const nftCount = await this.nftChecker.fetchNFTCountFromCollection(
                      walletAddress,
                      collection.id
                    );
                    database.addVerifiedWallet(userId, walletAddress, collection.id);
                    database.updateHoldingCount(userId, walletAddress, collection.id, nftCount);
                    totalHoldings += nftCount;
                  } catch (error) {
                    console.warn(
                      `Failed to check holdings for ${walletAddress} / ${collection.id}:`,
                      error.message
                    );
                  }
                }

                if (!collection.roleId) continue;

                const role = guild.roles.cache.get(collection.roleId);
                if (!role) {
                  console.warn(
                    `⚠️ Role ${collection.roleId} not found in guild ${guildId} (collection ${collection.id})`
                  );
                  continue;
                }

                if (totalHoldings === 0) {
                  if (member.roles.cache.has(collection.roleId)) {
                    await member.roles.remove(role).catch(err => {
                      console.error(`Failed to remove role:`, err.message);
                    });
                    database.removeUserRole(userId, guildId, collection.roleId, collection.id);
                    console.log(`🔄 Role removed from user ${userId} for ${collection.id}`);
                  }
                } else {
                  if (!member.roles.cache.has(collection.roleId)) {
                    try {
                      await member.roles.add(role);
                      console.log(`🔄 Role assigned to user ${userId} for ${collection.id}`);
                    } catch (err) {
                      console.error(`Failed to assign role for ${collection.id}:`, err.message);
                    }
                  }
                  if (member.roles.cache.has(collection.roleId)) {
                    database.addUserRole(userId, guildId, collection.roleId, collection.id);
                  }
                }
              }
            } catch (error) {
              console.error(`Error processing user ${userId}:`, error.message);
            }
          }
        } catch (error) {
          console.error(`Error in guild ${guildId}:`, error.message);
        }
      }

      console.log('✅ Periodic holding check completed');
    } catch (error) {
      console.error('❌ Error in periodic check:', error.message);
    }
  }

  start(client) {
    console.log(`⏱️ Periodic holding check will run every ${this.interval / 1000 / 60} minutes`);
    this.performCheck(client);
    setInterval(() => this.performCheck(client), this.interval);
  }
}

module.exports = PeriodicChecker;
