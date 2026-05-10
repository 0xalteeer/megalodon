require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType
} = require('discord.js');

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const database = require('./database');

// Initialize database
database.initializeDatabase();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Load collections configuration
const configPath = path.join(__dirname, 'collections-config.json');
const collectionsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Global configuration
const CONFIG = {
  OPENSEA_API_KEY: process.env.opensea_api_key,
  VERIFICATION_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  POLL_INTERVAL: 10 * 1000, // 10 seconds
  MESSAGE_DELETE_DELAY: 4 * 1000 // 4 seconds
};

// Map collection IDs to their config for quick lookup
const collectionMap = {};
collectionsConfig.collections.forEach(collection => {
  collectionMap[collection.id] = collection;
});

// Bot ready event
client.once(Events.ClientReady, async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  await setupVerificationChannel();
});

// Setup verification channels with pinned embeds and buttons
async function setupVerificationChannel() {
  try {
    for (const collection of collectionsConfig.collections) {
      const channel = await client.channels.fetch(collection.channelId);

      if (!channel) {
        console.error(`Verification channel not found for collection ${collection.id}`);
        continue;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🔐 NFT Ownership Verification')
        .setDescription(
          'Click the button below to verify your NFT ownership. You will:\n' +
          '1. Provide your wallet address\n' +
          '2. Add a unique token to your OpenSea bio\n' +
          '3. Receive a role based on your NFT holdings\n\n'
        )
        .setFooter({ text: 'This is a secure verification process' });

      const button = new ButtonBuilder()
        .setCustomId(`start_verification_${collection.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Start Verification');

      const row = new ActionRowBuilder().addComponents(button);

      // Check if message already exists (fetch last 100 messages)
      const messages = await channel.messages.fetch({ limit: 100 });
      const existingMessage = messages.find(
        msg => msg.author.id === client.user.id && msg.embeds.length > 0 && msg.embeds[0].title === '🔐 NFT Ownership Verification'
      );

      if (!existingMessage) {
        const message = await channel.send({ embeds: [embed], components: [row] });
        await message.pin();
        console.log(`✅ Verification embed sent and pinned for collection: ${collection.id}`);
      } else {
        console.log(`✅ Verification embed already exists for collection: ${collection.id}`);
      }
    }
  } catch (error) {
    if (error.code === 'MissingPermissions' || error.message.includes('Missing Permissions')) {
      console.error('Missing Discord Permissions - Bot needs these permissions in the channel:');
      console.error('   • View Channels');
      console.error('   • Send Messages');
      console.error('   • Read Message History');
      console.error('   • Manage Roles (for role assignment)');
    } else {
      console.error('Error setting up verification channel:', error.message);
    }
  }
}

// Handle button interactions
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) {
      const customId = interaction.customId;
      if (customId.startsWith('start_verification_')) {
        const collectionId = customId.replace('start_verification_', '');
        await showWalletModal(interaction, collectionId);
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('wallet_input_modal_')) {
        const collectionId = interaction.customId.replace('wallet_input_modal_', '');
        await handleWalletSubmission(interaction, collectionId);
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

// Show wallet address input modal
async function showWalletModal(interaction, collectionId) {
  const modal = new ModalBuilder()
    .setCustomId(`wallet_input_modal_${collectionId}`)
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

  await interaction.showModal(modal);
}

// Handle wallet address submission
async function handleWalletSubmission(interaction, collectionId) {
  await interaction.deferReply({ flags: 64 });

  try {
    const collection = collectionMap[collectionId];
    if (!collection) {
      return await interaction.editReply('Invalid collection configuration.');
    }

    const walletAddress = interaction.fields.getTextInputValue('wallet_address').toLowerCase();
    const userId = interaction.user.id;

    // Validate wallet address format
    if (!/^0x[a-f0-9]{40}$/.test(walletAddress)) {
      const msg = await interaction.editReply('Invalid wallet address format. Must be 0x followed by 40 hex characters.');
      scheduleMessageDeletion(interaction, msg);
      return;
    }

    // Check if wallet was previously verified
    const isPreviouslyVerified = database.isWalletPreviouslyVerified(userId, walletAddress);

    if (isPreviouslyVerified) {
      // Re-verify: check current NFT holdings and update role
      await interaction.editReply('✅ This wallet was previously verified. Checking current NFT holdings...');
      await checkAndAssignRole(interaction, walletAddress, userId, collectionId);
      return;
    }

    // New verification: generate token and start bio check
    const token = generateVerificationToken();
    const attemptId = database.createVerificationAttempt(userId, walletAddress, token);

    const msg = await interaction.editReply(
      `**Verification Token:** \`${token}\`\n\n` +
      `Please add this token to your OpenSea bio within **5 minutes**:\n` +
      `1. Go to [OpenSea.io](https://opensea.io)\n` +
      `2. Click your profile\n` +
      `3. Edit your profile bio\n` +
      `4. Paste: \`${token}\`\n` +
      `5. Save changes\n\n`
    );

    // Start polling OpenSea bio
    await pollOpenSeaBio(interaction, walletAddress, token, attemptId, userId, collectionId);

  } catch (error) {
    console.error('❌ Error handling wallet submission:', error);
    const msg = await interaction.editReply('❌ An error occurred. Please try again.');
    scheduleMessageDeletion(interaction, msg);
  }
}

// Generate verification token in format MEGALODON-[random]
function generateVerificationToken() {
  const randomHex = crypto.randomBytes(6).toString('hex');
  return `MEGALODON-${randomHex}`;
}

// Poll OpenSea bio for verification token
async function pollOpenSeaBio(interaction, walletAddress, token, attemptId, userId, collectionId) {
  const startTime = Date.now();
  let verified = false;

  while (Date.now() - startTime < CONFIG.VERIFICATION_TIMEOUT) {
    try {
      const response = await axios.get(
        `https://api.opensea.io/api/v2/accounts/${walletAddress}`,
        {
          headers: {
            'X-API-KEY': CONFIG.OPENSEA_API_KEY,
            'Accept': 'application/json'
          }
        }
      );

      const bio = response.data.bio || '';

      if (bio.includes(token)) {
        verified = true;
        database.completeVerificationAttempt(attemptId);
        database.addVerifiedWallet(userId, walletAddress);

        const msg = await interaction.followUp({
          content: '✅ **Ownership Verified!** Checking your NFT holdings...',
          flags: 64,
          ephemeral: true
        });
        scheduleMessageDeletion(interaction, msg);

        // Check NFT ownership and assign role
        await checkAndAssignRole(interaction, walletAddress, userId, collectionId);
        return;
      }

    } catch (error) {
      if (error.response?.status === 404) {
        // Wallet not found on OpenSea
        const msg = await interaction.followUp({
          content: '❌ Wallet not found on OpenSea. Please verify the address is correct.',
          flags: 64,
          ephemeral: true
        });
        scheduleMessageDeletion(interaction, msg);
        return;
      } else if (error.response?.status === 401) {
        console.error('❌ OpenSea API key invalid');
        const msg = await interaction.followUp({
          content: '❌ API authentication error. Please contact support.',
          flags: 64,
          ephemeral: true
        });
        scheduleMessageDeletion(interaction, msg);
        return;
      }
      // Log other errors but continue polling
      console.warn('⚠️ OpenSea API error:', error.message);
    }

    // Wait before next poll
    await sleep(CONFIG.POLL_INTERVAL);
  }

  if (!verified) {
    const msg = await interaction.followUp({
      content: '❌ **Verification Timeout** - We didn\'t detect your bio update within 5 minutes. Please try again.',
      flags: 64,
      ephemeral: true
    });
    scheduleMessageDeletion(interaction, msg);
  }
}

// Check NFT ownership and assign role
async function checkAndAssignRole(interaction, walletAddress, userId, collectionId) {
  try {
    const collection = collectionMap[collectionId];
    if (!collection) {
      const msg = await interaction.followUp({
        content: '❌ Invalid collection configuration.',
        flags: 64,
        ephemeral: true
      });
      scheduleMessageDeletion(interaction, msg);
      return;
    }

    const nfts = await fetchNFTsFromCollection(walletAddress, collectionId);

    if (nfts.length === 0) {
      const msg = await interaction.followUp({
        content: `❌ You don't currently own any NFTs from this collection.`,
        flags: 64,
        ephemeral: true
      });
      scheduleMessageDeletion(interaction, msg);
      return;
    }

    // Get guild member and assign role
    const guild = interaction.guild;
    const member = await guild.members.fetch(userId);
    const role = guild.roles.cache.get(collection.roleId);

    if (!role) {
      console.error('❌ Role not found:', collection.roleId);
      const msg = await interaction.followUp({
        content: '❌ Role not found. Please contact support.',
        flags: 64,
        ephemeral: true
      });
      scheduleMessageDeletion(interaction, msg);
      return;
    }

    // Check if user already has the role
    if (member.roles.cache.has(collection.roleId)) {
      const nftList = nfts.map(nft => `• ${nft}`).join('\n');
      const msg = await interaction.followUp({
        content: `✅ You already have the role! **Your NFTs:**\n${nftList}`,
        flags: 64
      });
      scheduleMessageDeletion(interaction, msg);
      console.log(`ℹ️ User ${userId} already has role for wallet ${walletAddress}`);
      return;
    }

    // Assign the role
    await member.roles.add(role);

    const nftList = nfts.map(nft => `• ${nft}`).join('\n');

    const msg = await interaction.followUp({
      content: `🎉 **Success!** Role assigned!\n\n**Your NFTs:**\n${nftList}`,
      flags: 64
    });
    scheduleMessageDeletion(interaction, msg);

    console.log(`✅ Role assigned to user ${userId} for wallet ${walletAddress} in collection ${collectionId}`);

  } catch (error) {
    console.error('❌ Error checking NFT ownership:', error.message);
    const msg = await interaction.followUp({
      content: '❌ Error checking NFT holdings. Please try again.',
      flags: 64
    }).catch(() => {});
    if (msg) scheduleMessageDeletion(interaction, msg);
  }
}

// Fetch NFTs from specified collection
async function fetchNFTsFromCollection(walletAddress, collectionId) {
  try {
    const collection = collectionMap[collectionId];
    console.log(`🔍 Querying OpenSea for NFTs: wallet=${walletAddress}, chain=megaeth, collection=${collection.id}`);
    
    // Query user's NFTs on megaeth chain
    const response = await axios.get(
      `https://api.opensea.io/api/v2/chain/megaeth/account/${walletAddress}/nfts`,
      {
        headers: {
          'X-API-KEY': CONFIG.OPENSEA_API_KEY,
          'Accept': 'application/json'
        }
      }
    );

    let nfts = response.data.nfts || [];
    
    // Filter to only include NFTs from our collection
    nfts = nfts.filter(nft => nft.collection === collection.id);
    
    console.log(`✅ Found ${nfts.length} NFTs from ${collection.id} collection for wallet`);
    
    return nfts.map(nft => {
      if (nft.name) {
        return nft.name;
      }
      return `#${nft.identifier}`;
    });

  } catch (error) {
    console.error('❌ Error fetching NFTs:', error.response?.status, error.message);
    console.error('   Chain: megaeth');
    console.error('   Collection ID:', collectionId);
    console.error('   Wallet Address:', walletAddress);
    if (error.response?.data) {
      console.error('   Response:', error.response.data);
    }
    throw error;
  }
}

// Schedule message deletion after a delay
function scheduleMessageDeletion(interaction, message) {
  setTimeout(() => {
    message.delete().catch(() => {
      // Message already deleted or user dismissed it
    });
  }, CONFIG.MESSAGE_DELETE_DELAY);
}

// Utility sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  database.closeDatabase();
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(process.env.megalodon_token);
