const database = require('./database');
const CollectionManager = require('./CollectionManager');
const NFTChecker = require('./NFTChecker');
const RoleManager = require('./RoleManager');

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
          const usersWithRoles = database.getAllUsersWithRoles(guildId);

          for (const { user_id: userId } of usersWithRoles) {
            try {
              const member = await guild.members.fetch(userId).catch(() => null);
              if (!member) continue;

              const wallets = database.getAllVerifiedWalletsByUser(userId);
              const collectionMap = {};

              for (const wallet of wallets) {
                if (!collectionMap[wallet.collection_id]) {
                  collectionMap[wallet.collection_id] = [];
                }
                collectionMap[wallet.collection_id].push(wallet);
              }

              for (const [collectionId, collectionWallets] of Object.entries(collectionMap)) {
                const collection = CollectionManager.getCollectionById(collectionId);
                if (!collection) continue;

                let totalHoldings = 0;
                
                for (const wallet of collectionWallets) {
                  try {
                    const nftCount = await this.nftChecker.fetchNFTCountFromCollection(
                      wallet.wallet_address, 
                      collectionId
                    );
                    database.updateHoldingCount(userId, wallet.wallet_address, collectionId, nftCount);
                    totalHoldings += nftCount;
                  } catch (error) {
                    console.warn(`Failed to check holdings for ${wallet.wallet_address}:`, error.message);
                  }
                }

                if (totalHoldings === 0 && collection.roleId) {
                  const role = guild.roles.cache.get(collection.roleId);
                  if (role && member.roles.cache.has(collection.roleId)) {
                    await member.roles.remove(role).catch(err => {
                      console.error(`Failed to remove role:`, err.message);
                    });
                    database.removeUserRole(userId, guildId, collection.roleId, collectionId);
                    console.log(`🔄 Role removed from user ${userId} for ${collectionId}`);
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
