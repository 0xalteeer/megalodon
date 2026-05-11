require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const database = require('./database');
const CollectionManager = require('./CollectionManager');
const UIManager = require('./UIManager');
const VerificationFlow = require('./VerificationFlow');
const WalletManager = require('./WalletManager');
const PeriodicChecker = require('./PeriodicChecker');

// Initialize
database.initializeDatabase();
const verificationFlow = new VerificationFlow(process.env.opensea_api_key);
const periodicChecker = new PeriodicChecker(process.env.opensea_api_key);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

// Bot ready
client.once(Events.ClientReady, async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  await setupVerificationChannels();
  periodicChecker.start(client);
});

// Interaction handler
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId === 'start_verification') {
        await showWalletModal(interaction);
      } else if (customId === 'manage_wallets') {
        await showWalletManagement(interaction);
      } else if (customId.startsWith('confirm_delete_')) {
        const walletAddress = customId.replace('confirm_delete_', '');
        await interaction.deferReply({ flags: 64 });
        await WalletManager.confirmWalletDeletion(interaction, walletAddress);
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'wallet_action') {
        const action = interaction.values[0];
        await interaction.deferReply({ flags: 64 });

        if (action === 'add_wallet') {
          await showWalletModal(interaction);
        } else if (action.startsWith('delete_')) {
          const walletAddress = action.replace('delete_', '');
          await WalletManager.handleWalletDeletion(interaction, walletAddress);
        }
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'wallet_input_modal') {
        await interaction.deferReply({ flags: 64 });
        await handleWalletSubmission(interaction);
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'An error occurred. Please try again.',
        flags: 64,
        ephemeral: true
      }).catch(() => {});
    }
  }
});

async function setupVerificationChannels() {
  try {
    const channelIds = CollectionManager.getAllChannelIds();

    for (const channelId of channelIds) {
      try {
        const channel = await client.channels.fetch(channelId);

        if (!channel) {
          console.error(`Channel not found: ${channelId}`);
          continue;
        }

        const embed = UIManager.createVerificationEmbed();
        const row = UIManager.createVerificationButtons();

        const messages = await channel.messages.fetch({ limit: 100 });
        const existingMessage = messages.find(msg => {
          if (msg.author.id !== client.user.id) return false;
          if (msg.embeds.length === 0) return false;
          return msg.embeds[0].title === '🔐 NFT Ownership Verification';
        });

        if (!existingMessage) {
          const message = await channel.send({ embeds: [embed], components: [row] });
          await message.pin();
          console.log(`✅ Verification embed sent and pinned for channel ${channelId}`);
        } else {
          console.log(`✅ Verification embed already exists for channel ${channelId}`);
        }
      } catch (error) {
        console.error(`Error setting up channel ${channelId}:`, error.message);
        if (error.message.includes('Missing Permissions')) {
          console.error('Missing Discord Permissions - Bot needs: View Channels, Send Messages, Read Message History, Manage Roles');
        }
      }
    }
  } catch (error) {
    console.error('Error in setupVerificationChannels:', error.message);
  }
}

async function showWalletModal(interaction) {
  const modal = UIManager.createWalletModal();
  await interaction.showModal(modal);
}

async function handleWalletSubmission(interaction) {
  try {
    const walletAddress = interaction.fields.getTextInputValue('wallet_address').toLowerCase();
    const userId = interaction.user.id;

    if (!/^0x[a-f0-9]{40}$/.test(walletAddress)) {
      const msg = await interaction.editReply('Invalid wallet address format. Must be 0x followed by 40 hex characters.');
      verificationFlow.scheduleMessageDeletion(msg);
      return;
    }

    const token = verificationFlow.generateVerificationToken();
    const attemptId = database.createVerificationAttempt(userId, walletAddress, token);

    const msg = await interaction.editReply(UIManager.createVerificationTokenEmbed(token));

    await verificationFlow.pollOpenSeaBio(interaction, walletAddress, token, attemptId, userId);

  } catch (error) {
    console.error('Error handling wallet submission:', error);
    const msg = await interaction.editReply('❌ An error occurred. Please try again.');
    verificationFlow.scheduleMessageDeletion(msg);
  }
}

async function showWalletManagement(interaction) {
  await interaction.deferReply({ flags: 64 });

  try {
    const userId = interaction.user.id;
    const allWallets = database.getUserVerifiedWallets(userId);

    if (allWallets.length === 0) {
      const msg = await interaction.editReply('You haven\'t verified any wallets yet. Click "Verify Wallet" to get started.');
      return;
    }

    const walletList = WalletManager.formatWalletList(allWallets);
    const select = UIManager.createWalletManagementSelect(allWallets);
    const row = new (require('discord.js')).ActionRowBuilder().addComponents(select);
    const embed = UIManager.createWalletManagementEmbed(walletList);

    await interaction.editReply({ embeds: [embed], components: [row] });

  } catch (error) {
    console.error('Error showing wallet management:', error);
    await interaction.editReply('An error occurred while loading your wallets.');
  }
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  database.closeDatabase();
  client.destroy();
  process.exit(0);
});

client.login(process.env.megalodon_token);
