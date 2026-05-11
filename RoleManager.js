const CollectionManager = require('./CollectionManager');
const database = require('./database');

class RoleManager {
  async assignRoleIfEligible(member, userId, guild, guildId, nftResults) {
    let rolesAssigned = 0;
    const allCollections = CollectionManager.getAllCollections();

    for (const collection of allCollections) {
      const nfts = nftResults[collection.id] || [];
      
      if (nfts.length === 0) continue;

      const role = guild.roles.cache.get(collection.roleId);
      if (!role) {
        console.error('❌ Role not found:', collection.roleId);
        continue;
      }

      if (!member.roles.cache.has(collection.roleId)) {
        try {
          await member.roles.add(role);
          rolesAssigned++;
          database.addUserRole(userId, guildId, collection.roleId, collection.id);
          console.log(`✅ Role assigned to user ${userId} for collection ${collection.id}`);
        } catch (error) {
          console.error(`Failed to assign role for ${collection.id}:`, error.message);
        }
      } else {
        database.addUserRole(userId, guildId, collection.roleId, collection.id);
      }
    }

    return rolesAssigned;
  }

  async removeRoleIfNoHoldings(member, userId, guild, guildId) {
    let rolesRemoved = 0;
    const allCollections = CollectionManager.getAllCollections();

    for (const collection of allCollections) {
      const remainingWallets = database.getUserVerifiedWalletsForCollection(userId, collection.id);
      const hasAnyNFTs = remainingWallets.some(w => w.current_holding_count > 0);

      if (!hasAnyNFTs && collection.roleId) {
        const role = guild.roles.cache.get(collection.roleId);
        if (role && member.roles.cache.has(collection.roleId)) {
          try {
            await member.roles.remove(role);
            database.removeUserRole(userId, guildId, collection.roleId, collection.id);
            rolesRemoved++;
            console.log(`✅ Role removed from user ${userId} for collection ${collection.id}`);
          } catch (error) {
            console.error(`Failed to remove role for ${collection.id}:`, error.message);
          }
        }
      }
    }

    return rolesRemoved;
  }
}

module.exports = new RoleManager();
