const database = require('./database');
const CollectionManager = require('./CollectionManager');
const UIManager = require('./UIManager');

class WalletManager {
  formatWalletList(wallets) {
    if (wallets.length === 0) {
      return 'No verified wallets yet.';
    }

    const allCollections = CollectionManager.getAllCollections();
    const roleCollections = allCollections.filter(c => c.roleId);

    const byAddress = new Map();
    for (const w of wallets) {
      const key = w.wallet_address.toLowerCase();
      if (!byAddress.has(key)) {
        byAddress.set(key, { displayAddress: w.wallet_address, counts: new Map() });
      }
      const entry = byAddress.get(key);
      entry.counts.set(w.collection_id, w.current_holding_count);
    }

    const collectionsToShow =
      roleCollections.length > 0 ? roleCollections : allCollections;

    let index = 0;
    const blocks = [];
    for (const { displayAddress, counts } of byAddress.values()) {
      index += 1;
      const lines = collectionsToShow.map(c => {
        const n = counts.has(c.id) ? counts.get(c.id) : 0;
        return `   • **${c.name}:** ${n} NFT(s)`;
      });
      blocks.push(`${index}. \`${displayAddress}\`\n${lines.join('\n')}`);
    }

    return blocks.join('\n\n');
  }

  async handleWalletDeletion(interaction, walletAddress) {
    const userId = interaction.user.id;

    const embed = UIManager.createDeleteConfirmEmbed(walletAddress);
    const row = UIManager.createDeleteConfirmButtons(walletAddress);

    await interaction.editReply({ embeds: [embed], components: [row] });
  }

  async confirmWalletDeletion(interaction, walletAddress) {
    const userId = interaction.user.id;
    const guild = interaction.guild;

    try {
      const allWallets = database.getUserVerifiedWallets(userId);
      const walletsToDelete = allWallets.filter(
        w => w.wallet_address.toLowerCase() === walletAddress.toLowerCase()
      );

      for (const wallet of walletsToDelete) {
        database.deleteVerifiedWallet(userId, wallet.wallet_address, wallet.collection_id);
      }

      // Check if user should keep roles
      const member = await guild.members.fetch(userId);
      const collections = CollectionManager.getAllCollections();

      for (const collection of collections) {
        const remainingWallets = database.getUserVerifiedWalletsForCollection(userId, collection.id);
        const hasAnyNFTs = remainingWallets.some(w => w.current_holding_count > 0);

        if (!hasAnyNFTs && collection.roleId) {
          const role = guild.roles.cache.get(collection.roleId);
          if (role && member.roles.cache.has(collection.roleId)) {
            await member.roles.remove(role).catch(() => {});
            database.removeUserRole(userId, guild.id, collection.roleId, collection.id);
          }
        }
      }

      const msg = await interaction.editReply({
        content: `✅ Wallet \`${walletAddress}\` has been deleted.`,
        embeds: [],
        components: []
      });

    } catch (error) {
      console.error('Error deleting wallet:', error);
      await interaction.editReply('An error occurred while deleting the wallet.');
    }
  }
}

module.exports = new WalletManager();
