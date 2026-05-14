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

  openSeaHeaders() {
    return {
      'X-API-KEY': process.env.opensea_api_key,
      Accept: 'application/json'
    };
  }

  /** Collect any bio strings OpenSea returns on the account object (current + plausible alternate field names). */
  extractBiosFromAccountPayload(data) {
    if (!data || typeof data !== 'object') return [];
    const texts = [];
    if (typeof data.bio === 'string' && data.bio.length) texts.push(data.bio);
    for (const key of ['wallet_bio', 'profile_bio', 'account_bio']) {
      if (typeof data[key] === 'string' && data[key].length) texts.push(data[key]);
    }
    return texts;
  }

  /**
   * OpenSea can surface different bios for the same person (e.g. main profile vs connected wallet profile).
   * We merge bios from GET /accounts/{wallet}, then resolve linked username/ENS and fetch those account pages too.
   */
  async fetchMergedOpenSeaBios(walletAddress) {
    const base = 'https://api.opensea.io/api/v2';
    const headers = this.openSeaHeaders();
    const seen = new Set();
    const parts = [];

    const fetchOneAccount = async identifier => {
      const key = String(identifier).toLowerCase();
      if (seen.has(key)) return;
      const { data } = await axios.get(
        `${base}/accounts/${encodeURIComponent(identifier)}`,
        { headers }
      );
      seen.add(key);
      parts.push(...this.extractBiosFromAccountPayload(data));
    };

    await fetchOneAccount(walletAddress);

    try {
      const { data: resolved } = await axios.get(
        `${base}/accounts/resolve/${encodeURIComponent(walletAddress)}`,
        { headers }
      );
      const { username, ens_name: ensName, address } = resolved || {};
      const linked = [username, ensName, address].filter(Boolean);
      for (const id of linked) {
        try {
          await fetchOneAccount(id);
        } catch (e) {
          if (e.response?.status === 401) throw e;
        }
      }
    } catch (e) {
      if (e.response?.status === 401) throw e;
    }

    return parts.join('\n');
  }

  async pollOpenSeaBio(interaction, walletAddress, token, attemptId, userId) {
    const startTime = Date.now();
    let verified = false;

    while (Date.now() - startTime < this.VERIFICATION_TIMEOUT) {
      try {
        const combinedBio = await this.fetchMergedOpenSeaBios(walletAddress);

        if (combinedBio.includes(token)) {
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
