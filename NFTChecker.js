const axios = require('axios');
const CollectionManager = require('./CollectionManager');

class NFTChecker {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  /** OpenSea v2 may return `collection` as a slug string or an object — normalize for filtering. */
  nftMatchesCollection(nft, collectionId) {
    const c = nft.collection;
    if (c == null) return false;
    if (typeof c === 'string') return c === collectionId;
    if (typeof c === 'object') {
      const slug = c.slug || c.collection_slug || c.id;
      return slug === collectionId;
    }
    return false;
  }

  async fetchNFTsFromCollection(walletAddress, collectionId) {
    try {
      const collection = CollectionManager.getCollectionById(collectionId);
      const chain = collection.chain || 'ethereum';
      
      console.log(`🔍 Querying OpenSea for NFTs: wallet=${walletAddress}, chain=${chain}, collection=${collection.id}`);
      
      const response = await axios.get(
        `https://api.opensea.io/api/v2/chain/${chain}/account/${walletAddress}/nfts`,
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'Accept': 'application/json'
          }
        }
      );

      let nfts = response.data.nfts || [];
      nfts = nfts.filter(nft => this.nftMatchesCollection(nft, collection.id));
      
      console.log(`✅ Found ${nfts.length} NFTs from ${collection.id} collection for wallet on ${chain}`);
      
      return nfts.map(nft => nft.name || `#${nft.identifier}`);
    } catch (error) {
      console.error('❌ Error fetching NFTs:', error.response?.status, error.message);
      throw error;
    }
  }

  async fetchNFTCountFromCollection(walletAddress, collectionId) {
    try {
      const collection = CollectionManager.getCollectionById(collectionId);
      const chain = collection.chain || 'ethereum';
      
      const response = await axios.get(
        `https://api.opensea.io/api/v2/chain/${chain}/account/${walletAddress}/nfts`,
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'Accept': 'application/json'
          }
        }
      );

      let nfts = response.data.nfts || [];
      nfts = nfts.filter(nft => this.nftMatchesCollection(nft, collection.id));
      return nfts.length;
    } catch (error) {
      if (error.response?.status === 404) return 0;
      throw error;
    }
  }

  async checkWalletForAllCollections(walletAddress) {
    const results = {};
    const allCollections = CollectionManager.getAllCollections();

    for (const collection of allCollections) {
      try {
        const nfts = await this.fetchNFTsFromCollection(walletAddress, collection.id);
        results[collection.id] = nfts;
      } catch (error) {
        console.warn(`Failed to check ${collection.id}:`, error.message);
        results[collection.id] = [];
      }
    }
    return results;
  }
}

module.exports = NFTChecker;
