const crypto = require('crypto');
const axios = require('axios');
const database = require('./database');
const CollectionManager = require('./CollectionManager');
const NFTChecker = require('./NFTChecker');
const RoleManager = require('./RoleManager');
const UIManager = require('./UIManager');

class VerificationFlow {
  constructor(apiKey) {
    this.nftChecker = new NFTChecker(apiKey);
    this.VERIFICATION_TIMEOUT = 5 * 60 * 1000;
    this.POLL_INTERVAL = 10 * 1000;
  }

  generateVerificationToken() {
    const randomHex = crypto.randomBytes(6).toString('hex');
    return `MEGALODON-${randomHex}`;
  }

  async pollOpenSeaBio(interaction, walletAddress, token, attemptId, userId) {
    const startTime = Date.now();
    let verified = false;

    while (Date.now() - startTime < this.VERIFICATION_TIMEOUT) {
      try {
        const response = await axios.get(
          `https://api.opensea.io/api/v2/accounts/${walletAddress}`,
          {
            headers: {
              'X-API-KEY': process.env.opensea_api_key,
              'Accept': 'application/json'
            }
          }
        );

        const bio = response.data.bio || '';

        if (bio.includes(token)) {
          verified = true;
          database.completeVerificationAttempt(attemptId);
          
          // Track wallet for every configured collection (0 holdings if none), so it stays in Manage Wallets
          const nftResults = await this.nftChecker.checkWalletForAllCollections(walletAddress);

          for (const collection of CollectionManager.getAllCollections()) {
            const nfts = nftResults[collection.id] || [];
            database.addVerifiedWallet(userId, walletAddress, collection.id);
            database.updateHoldingCount(userId, walletAddress, collection.id, nfts.length);
          }

          const msg = await interaction.followUp({
            content: '✅ **Ownership Verified!** Checking your NFT holdings...',
            flags: 64,
            ephemeral: true
          });

          await this.completeVerification(interaction, walletAddress, userId, nftResults);
          return;
        }
      } catch (error) {
        if (error.response?.status === 404) {
          const msg = await interaction.followUp({
            content: '❌ Wallet not found on OpenSea. Please verify the address is correct.',
            flags: 64,
            ephemeral: true
          });
          this.scheduleMessageDeletion(msg);
          return;
        } else if (error.response?.status === 401) {
          const msg = await interaction.followUp({
            content: '❌ API authentication error. Please contact support.',
            flags: 64,
            ephemeral: true
          });
          this.scheduleMessageDeletion(msg);
          return;
        }
        console.warn('⚠️ OpenSea API error:', error.message);
      }

      await this.sleep(this.POLL_INTERVAL);
    }

    if (!verified) {
      const msg = await interaction.followUp({
        content: '❌ **Verification Timeout** - We didn\'t detect your bio update within 5 minutes. Please try again.',
        flags: 64,
        ephemeral: true
      });
      this.scheduleMessageDeletion(msg);
    }
  }

  async completeVerification(interaction, walletAddress, userId, nftResults) {
    try {
      const guild = interaction.guild;
      const member = await guild.members.fetch(userId);

      const hasAnyNfts = Object.values(nftResults).some(arr => Array.isArray(arr) && arr.length > 0);

      if (!hasAnyNfts) {
        const msg = await interaction.followUp({
          content:
            '✅ **Wallet verified and saved.** You don\'t hold any NFTs from our collections in this wallet yet. ' +
            'When you do, use **Verify Wallet** with the same address to refresh roles, or wait for the automatic holdings check.',
          flags: 64,
          ephemeral: true
        });
        this.scheduleMessageDeletion(msg);
        return;
      }

      const rolesAssigned = await RoleManager.assignRoleIfEligible(
        member, userId, guild, guild.id, nftResults
      );

      const resultsText = UIManager.formatVerificationResults(nftResults);

      if (rolesAssigned === 0) {
        const msg = await interaction.followUp({
          content:
            `✅ **Verified.** Your wallet is saved; you already have the applicable role(s) or no new roles were needed.\n\n**Your NFTs:**\n${resultsText}`,
          flags: 64,
          ephemeral: true
        });
        this.scheduleMessageDeletion(msg);
        return;
      }

      const msg = await interaction.followUp({
        content: `🎉 **Success!** ${rolesAssigned} role(s) assigned!\n\n**Your NFTs:**\n${resultsText}`,
        flags: 64,
        ephemeral: true
      });
      this.scheduleMessageDeletion(msg);

    } catch (error) {
      console.error('Error completing verification:', error);
      const msg = await interaction.followUp({
        content: '❌ Error processing your verification. Please try again.',
        flags: 64,
        ephemeral: true
      }).catch(() => {});
      if (msg) this.scheduleMessageDeletion(msg);
    }
  }

  scheduleMessageDeletion(message, delay = 4000) {
    setTimeout(() => {
      message.delete().catch(() => {});
    }, delay);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = VerificationFlow;
