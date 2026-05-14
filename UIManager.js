const {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');
const CollectionManager = require('./CollectionManager');

class UIManager {
  createVerificationEmbed() {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔐 NFT Ownership Verification')
      .setDescription(
        'Click the buttons below to verify your NFT ownership or manage your wallets. You will:\n' +
        '1. Provide your wallet address\n' +
        '2. Add a unique token to your OpenSea bio (main profile **or** that wallet’s profile page)\n' +
        '3. Receive roles based on your NFT holdings\n\n' +
        '**Manage your wallets:** Use the "Manage Wallets" button to check, add, or remove verified wallets.\n'
      )
      .setFooter({ text: 'This is a secure verification process' });
  }

  createVerificationButtons() {
    const verifyButton = new ButtonBuilder()
      .setCustomId('start_verification')
      .setStyle(ButtonStyle.Primary)
      .setLabel('Verify Wallet');

    const manageButton = new ButtonBuilder()
      .setCustomId('manage_wallets')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Manage Wallets');

    return new ActionRowBuilder().addComponents(verifyButton, manageButton);
  }

  createWalletModal() {
    const modal = new ModalBuilder()
      .setCustomId('wallet_input_modal')
      .setTitle('Enter Your Wallet Address');

    const walletInput = new TextInputBuilder()
      .setCustomId('wallet_address')
      .setLabel('Wallet Address (0x...)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('0x...')
      .setRequired(true)
      .setMinLength(42)
      .setMaxLength(42);

    const row = new ActionRowBuilder().addComponents(walletInput);
    modal.addComponents(row);
    return modal;
  }

  createWalletManagementEmbed(walletList) {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('💼 Wallet Management')
      .setDescription(`**Your Verified Wallets:**\n${walletList}\n\n**Actions:**`)
      .setFooter({ text: 'Manage your verified wallets across all collections' });
  }

  createWalletManagementSelect(allWallets) {
    const collectionsByAddress = new Map();
    for (const w of allWallets) {
      if (!collectionsByAddress.has(w.wallet_address)) {
        collectionsByAddress.set(w.wallet_address, []);
      }
      collectionsByAddress.get(w.wallet_address).push(w.collection_id);
    }

    const deleteOptions = [...collectionsByAddress.entries()].map(([wallet_address, collectionIds]) => {
      const colsDesc = `Collections: ${collectionIds.join(', ')}`;
      const desc = colsDesc.length > 100 ? `${colsDesc.slice(0, 97)}...` : colsDesc;
      return new StringSelectMenuOptionBuilder()
        .setLabel(`🗑️ Delete ${wallet_address.slice(0, 6)}...${wallet_address.slice(-4)}`)
        .setValue(`delete_${wallet_address}`)
        .setDescription(desc);
    });

    const options = [
      new StringSelectMenuOptionBuilder()
        .setLabel('➕ Add Another Wallet')
        .setValue('add_wallet')
        .setDescription('Verify a new wallet'),
      ...deleteOptions
    ];

    return new StringSelectMenuBuilder()
      .setCustomId('wallet_action')
      .setPlaceholder('Choose an action...')
      .addOptions(options);
  }

  createDeleteConfirmEmbed(walletAddress) {
    return new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('⚠️ Confirm Deletion')
      .setDescription(
        `Are you sure you want to delete wallet \`${walletAddress}\`?\n\n` +
        `Roles will be removed if you no longer hold NFTs from those collections.`
      );
  }

  createDeleteConfirmButtons(walletAddress) {
    const confirmButton = new ButtonBuilder()
      .setCustomId(`confirm_delete_${walletAddress}`)
      .setStyle(ButtonStyle.Danger)
      .setLabel('Yes, Delete');

    const cancelButton = new ButtonBuilder()
      .setCustomId('manage_wallets')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Cancel');

    return new ActionRowBuilder().addComponents(confirmButton, cancelButton);
  }

  createVerificationTokenEmbed(token) {
    return `**Verification Token:** \`${token}\`\n\n` +
      `Please add this token to an OpenSea bio within **5 minutes** (either works):\n` +
      `• **Main account:** Profile → Settings / Edit profile → bio\n` +
      `• **Wallet profile:** Open your wallet’s OpenSea page (e.g. from Portfolio) and edit that profile’s bio\n` +
      `Steps:\n` +
      `1. Go to [OpenSea.io](https://opensea.io)\n` +
      `2. Open **Profile** (or your wallet’s profile page)\n` +
      `3. Edit the **bio** field\n` +
      `4. Paste: \`${token}\`\n` +
      `5. Save changes\n\n`;
  }

  formatNFTList(nfts) {
    return nfts.map(nft => `• ${nft}`).join('\n');
  }

  formatVerificationResults(results) {
    const collections = CollectionManager.getAllCollections();
    const lines = [];
    
    for (const collection of collections) {
      const nfts = results[collection.id] || [];
      if (nfts.length > 0) {
        lines.push(`**${collection.name}:** ${nfts.length} NFT(s)`);
      }
    }
    
    return lines.length > 0 ? lines.join('\n') : 'No NFTs found in any collection';
  }
}

module.exports = new UIManager();
