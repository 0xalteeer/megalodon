const database = require('./database');
const CollectionManager = require('./CollectionManager');
const UIManager = require('./UIManager');

class WalletManager {
  formatWalletList(wallets) {
    if (wallets.length === 0) {
      return 'No verified wallets yet.';
    }

    return wallets
      .map((w, i) => {
        const collections = CollectionManager.getAllCollections()
          .filter(c => c.id === w.collection_id)
          .map(c => c.name)
          .join(', ');
        return `${i + 1}. \`${w.wallet_address}\`\n   Collections: ${collections}\n   Holdings: ${w.current_holding_count} NFT(s)`;
      })
      .join('\n');
  }

  async handleWalletDeletion(interaction, walletAddress) {
    const userId = interaction.user.id;
    const allWallets = database.getUserVerifiedWallets(userId);
    
    const walletsForAddress = allWallets.filter(w => w.wallet_address === walletAddress);
    
    const embed = UIManager.createDeleteConfirmEmbed(walletAddress);
    const row = UIManager.createDeleteConfirmButtons(walletAddress);

    await interaction.editReply({ embeds: [embed], components: [row] });
  }

  async confirmWalletDeletion(interaction, walletAddress) {
    const userId = interaction.user.id;
    const guild = interaction.guild;

    try {
      const allWallets = database.getUserVerifiedWallets(userId);
      const walletsToDelete = allWallets.filter(w => w.wallet_address === walletAddress);

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
