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
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const database = require('./database');

// Initialize database
database.initializeDatabase();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

// Load collections configuration
const configPath = path.join(__dirname, 'collections-config.json');
const collectionsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Global configuration
const CONFIG = {
  OPENSEA_API_KEY: process.env.opensea_api_key,
  VERIFICATION_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  POLL_INTERVAL: 10 * 1000, // 10 seconds
  MESSAGE_DELETE_DELAY: 4 * 1000, // 4 seconds
  HOLDING_CHECK_INTERVAL: 15 * 60 * 1000 // 15 minutes
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
  // Start periodic holding checks
  startPeriodicHoldingCheck();
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
          '3. Receive a role based on your NFT holdings\n\n' +
          '**Manage your wallets:** Use the "Manage Wallets" button to check, add, or remove verified wallets.\n'
        )
        .setFooter({ text: 'This is a secure verification process' });

      const verifyButton = new ButtonBuilder()
        .setCustomId(`start_verification_${collection.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Start Verification');

      const manageButton = new ButtonBuilder()
        .setCustomId(`manage_wallets_${collection.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Manage Wallets');

      const row = new ActionRowBuilder().addComponents(verifyButton, manageButton);

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
      } else if (customId.startsWith('manage_wallets_')) {
        const collectionId = customId.replace('manage_wallets_', '');
        await showWalletManagementMenu(interaction, collectionId);
      } else if (customId.startsWith('delete_wallet_')) {
        const [, collectionId, walletAddress] = customId.match(/delete_wallet_(.+)_(.+)/) || [];
        if (collectionId && walletAddress) {
          await handleWalletDeletion(interaction, collectionId, walletAddress);
        }
      } else if (customId.startsWith('confirm_delete_')) {
        const [, collectionId, walletAddress] = customId.match(/confirm_delete_(.+)_(.+)/) || [];
        if (collectionId && walletAddress) {
          await confirmWalletDeletion(interaction, collectionId, walletAddress);
        }
      } else if (customId === 'add_another_wallet') {
        const collectionId = interaction.message.embeds[0]?.footer?.text?.match(/col:(\S+)/)?.[1];
        if (collectionId) {
          await showWalletModal(interaction, collectionId);
        }
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('wallet_action_')) {
        const collectionId = interaction.customId.replace('wallet_action_', '');
        const action = interaction.values[0];
        
        if (action === 'add_wallet') {
          await showWalletModal(interaction, collectionId);
        } else if (action.startsWith('delete_')) {
          const walletAddress = action.replace('delete_', '');
          await showDeleteConfirmation(interaction, collectionId, walletAddress);
        } else if (action === 'back') {
          await showWalletManagementMenu(interaction, collectionId);
        }
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

// Show wallet management menu
async function showWalletManagementMenu(interaction, collectionId) {
  await interaction.deferReply({ flags: 64 });

  try {
    const userId = interaction.user.id;
    const wallets = database.getUserVerifiedWalletsForCollection(userId, collectionId);
    const collection = collectionMap[collectionId];

    if (!collection) {
      return await interaction.editReply('Invalid collection configuration.');
    }

    if (wallets.length === 0) {
      const msg = await interaction.editReply(
        `**${collection.name}**\n\n` +
        `You haven't verified any wallets for this collection yet. Click "Start Verification" to add one.`
      );
      return;
    }

    const walletList = wallets
      .map((w, i) => `${i + 1}. \`${w.wallet_address}\`\n   Holdings: ${w.current_holding_count} NFT(s)`)
      .join('\n');

    const options = [
      new StringSelectMenuOptionBuilder()
        .setLabel('➕ Add Another Wallet')
        .setValue('add_wallet')
        .setDescription('Verify a new wallet for this collection'),
      ...wallets.map(w => 
        new StringSelectMenuOptionBuilder()
          .setLabel(`🗑️ Delete ${w.wallet_address.slice(0, 6)}...${w.wallet_address.slice(-4)}`)
          .setValue(`delete_${w.wallet_address}`)
          .setDescription(`Remove wallet from verification`)
      )
    ];

    const select = new StringSelectMenuBuilder()
      .setCustomId(`wallet_action_${collectionId}`)
      .setPlaceholder('Choose an action...')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`💼 Wallet Management - ${collection.name}`)
      .setDescription(`**Your Verified Wallets:**\n${walletList}\n\n**Actions:**`)
      .setFooter({ text: `col:${collectionId}` });

    await interaction.editReply({ embeds: [embed], components: [row] });

  } catch (error) {
    console.error('Error showing wallet management menu:', error);
    await interaction.editReply('An error occurred while loading your wallets.');
  }
}

// Show delete confirmation
async function showDeleteConfirmation(interaction, collectionId, walletAddress) {
  await interaction.deferReply({ flags: 64 });

  try {
    const collection = collectionMap[collectionId];
    
    const confirmButton = new ButtonBuilder()
      .setCustomId(`confirm_delete_${collectionId}_${walletAddress}`)
      .setStyle(ButtonStyle.Danger)
      .setLabel('Yes, Delete');

    const cancelButton = new ButtonBuilder()
      .setCustomId(`manage_wallets_${collectionId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Cancel');

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('⚠️ Confirm Deletion')
      .setDescription(
        `Are you sure you want to delete wallet \`${walletAddress}\` from **${collection.name}**?\n\n` +
        `If you no longer hold NFTs from this collection in any verified wallet, the role will be removed.`
      );

    await interaction.editReply({ embeds: [embed], components: [row] });

  } catch (error) {
    console.error('Error showing delete confirmation:', error);
    await interaction.editReply('An error occurred.');
  }
}

// Confirm wallet deletion
async function confirmWalletDeletion(interaction, collectionId, walletAddress) {
  await interaction.deferReply({ flags: 64 });

  try {
    const userId = interaction.user.id;
    const collection = collectionMap[collectionId];
    const guild = interaction.guild;
    const member = await guild.members.fetch(userId);

    const deleted = database.deleteVerifiedWallet(userId, walletAddress, collectionId);

    if (!deleted) {
      return await interaction.editReply('Wallet not found or already deleted.');
    }

    // Check if user has any other wallets with NFTs for this collection
    const remainingWallets = database.getUserVerifiedWalletsForCollection(userId, collectionId);
    const hasAnyNFTs = remainingWallets.some(w => w.current_holding_count > 0);

    // If no remaining wallets with NFTs, remove the role
    if (!hasAnyNFTs && collection.roleId) {
      const role = guild.roles.cache.get(collection.roleId);
      if (role && member.roles.cache.has(collection.roleId)) {
        await member.roles.remove(role);
        database.removeUserRole(userId, guild.id, collection.roleId, collectionId);
        console.log(`✅ Role removed from user ${userId} (wallet deletion)`);
      }
    }

    const msg = await interaction.editReply(
      `✅ Wallet \`${walletAddress}\` has been deleted from **${collection.name}**.\n` +
      (hasAnyNFTs ? '✅ You still have NFTs from other wallets, so your role remains.' : '⚠️ Role has been removed as you no longer hold any NFTs from this collection.')
    );
    scheduleMessageDeletion(interaction, msg);

  } catch (error) {
    console.error('Error confirming wallet deletion:', error);
    await interaction.editReply('An error occurred while deleting the wallet.');
  }
}

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

    // Check if wallet was previously verified for this collection
    const isPreviouslyVerified = database.isWalletPreviouslyVerified(userId, walletAddress, collectionId);

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
        database.addVerifiedWallet(userId, walletAddress, collectionId);

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

    // Update holding count in database
    database.updateHoldingCount(userId, walletAddress, collectionId, nfts.length);

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
        content: `✅ You already have the role! **Your NFTs from this wallet:**\n${nftList}`,
        flags: 64
      });
      scheduleMessageDeletion(interaction, msg);
      console.log(`ℹ️ User ${userId} already has role for wallet ${walletAddress}`);
      database.addUserRole(userId, guild.id, collection.roleId, collectionId);
      return;
    }

    // Assign the role
    await member.roles.add(role);
    database.addUserRole(userId, guild.id, collection.roleId, collectionId);

    const nftList = nfts.map(nft => `• ${nft}`).join('\n');

    const msg = await interaction.followUp({
      content: `🎉 **Success!** Role assigned!\n\n**Your NFTs from this wallet:**\n${nftList}`,
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
    const chain = collection.chain || 'ethereum';
    
    console.log(`🔍 Querying OpenSea for NFTs: wallet=${walletAddress}, chain=${chain}, collection=${collection.id}`);
    
    // Query user's NFTs on the specified chain
    const response = await axios.get(
      `https://api.opensea.io/api/v2/chain/${chain}/account/${walletAddress}/nfts`,
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
    
    console.log(`✅ Found ${nfts.length} NFTs from ${collection.id} collection for wallet on ${chain}`);
    
    return nfts.map(nft => {
      if (nft.name) {
        return nft.name;
      }
      return `#${nft.identifier}`;
    });

  } catch (error) {
    console.error('❌ Error fetching NFTs:', error.response?.status, error.message);
    const collection = collectionMap[collectionId];
    console.error('   Chain:', collection.chain || 'ethereum');
    console.error('   Collection ID:', collectionId);
    console.error('   Wallet Address:', walletAddress);
    if (error.response?.data) {
      console.error('   Response:', error.response.data);
    }
    throw error;
  }
}

// Periodic holding check function
async function performPeriodicHoldingCheck() {
  console.log('🔄 Starting periodic NFT holding check...');
  
  try {
    // Get all guilds the bot is in
    const guilds = client.guilds.cache;

    for (const [guildId, guild] of guilds) {
      try {
        // Get all users who have verified wallets
        const usersWithRoles = database.getAllUsersWithRoles(guildId);

        for (const { user_id: userId } of usersWithRoles) {
          try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) continue; // User left the guild

            // Get all verified wallets for this user
            const wallets = database.getAllVerifiedWalletsByUser(userId);
            
            // Group by collection and check holdings
            const collectionMap2 = {};
            for (const wallet of wallets) {
              if (!collectionMap2[wallet.collection_id]) {
                collectionMap2[wallet.collection_id] = [];
              }
              collectionMap2[wallet.collection_id].push(wallet);
            }

            // Check each collection
            for (const [collectionId, collectionWallets] of Object.entries(collectionMap2)) {
              const collection = collectionMap[collectionId];
              if (!collection) continue;

              // Count total NFTs across all wallets for this collection
              let totalHoldings = 0;
              
              for (const wallet of collectionWallets) {
                try {
                  const nftCount = await fetchNFTCountFromCollection(wallet.wallet_address, collectionId);
                  database.updateHoldingCount(userId, wallet.wallet_address, collectionId, nftCount);
                  totalHoldings += nftCount;
                } catch (error) {
                  console.warn(`Failed to check holdings for ${wallet.wallet_address}:`, error.message);
                  // Keep previous count on error to avoid removing roles due to API failures
                }
              }

              // If total holdings is 0, remove the role
              if (totalHoldings === 0 && collection.roleId) {
                const role = guild.roles.cache.get(collection.roleId);
                if (role && member.roles.cache.has(collection.roleId)) {
                  await member.roles.remove(role).catch(err => {
                    console.error(`Failed to remove role from user ${userId}:`, err.message);
                  });
                  database.removeUserRole(userId, guildId, collection.roleId, collectionId);
                  console.log(`🔄 Role removed from user ${userId} (no NFT holdings for ${collectionId})`);
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
    console.error('❌ Error in periodic holding check:', error.message);
  }
}

// Fetch NFT count from collection (without returning full details)
async function fetchNFTCountFromCollection(walletAddress, collectionId) {
  try {
    const collection = collectionMap[collectionId];
    const chain = collection.chain || 'ethereum';
    
    const response = await axios.get(
      `https://api.opensea.io/api/v2/chain/${chain}/account/${walletAddress}/nfts`,
      {
        headers: {
          'X-API-KEY': CONFIG.OPENSEA_API_KEY,
          'Accept': 'application/json'
        }
      }
    );

    let nfts = response.data.nfts || [];
    nfts = nfts.filter(nft => nft.collection === collection.id);
    
    return nfts.length;
  } catch (error) {
    if (error.response?.status === 404) {
      return 0; // Wallet not found, assume no holdings
    }
    throw error;
  }
}

// Start periodic holding check
function startPeriodicHoldingCheck() {
  console.log(`⏱️ Periodic holding check will run every ${CONFIG.HOLDING_CHECK_INTERVAL / 1000 / 60} minutes`);
  
  // Run immediately
  performPeriodicHoldingCheck();
  
  // Then run periodically
  setInterval(performPeriodicHoldingCheck, CONFIG.HOLDING_CHECK_INTERVAL);
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
