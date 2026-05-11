const fs = require('fs');
const path = require('path');

class CollectionManager {
  constructor() {
    const configPath = path.join(__dirname, 'collections-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    this.collections = config.collections;
    this.collectionMap = {};
    this.collections.forEach(collection => {
      this.collectionMap[collection.id] = collection;
    });
  }

  getAllCollections() {
    return this.collections;
  }

  getCollectionById(id) {
    return this.collectionMap[id];
  }

  getCollectionsByChannel(channelId) {
    return this.collections.filter(c => c.channelId === channelId);
  }

  getAllChannelIds() {
    return [...new Set(this.collections.map(c => c.channelId))];
  }
}

module.exports = new CollectionManager();
