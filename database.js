const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'verification.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS verified_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_check_at DATETIME,
      current_holding_count INTEGER DEFAULT 0,
      UNIQUE(user_id, wallet_address, collection_id)
    );

    CREATE TABLE IF NOT EXISTS verification_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      token TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      success INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, guild_id, role_id, collection_id)
    );
  `);
}

// Add a verified wallet with collection info
function addVerifiedWallet(userId, walletAddress, collectionId) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO verified_wallets (user_id, wallet_address, collection_id)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(userId, walletAddress, collectionId);
  return result.changes > 0;
}

// Check if wallet was previously verified by user for a collection
function isWalletPreviouslyVerified(userId, walletAddress, collectionId) {
  const stmt = db.prepare(`
    SELECT id FROM verified_wallets
    WHERE user_id = ? AND wallet_address = ? AND collection_id = ?
  `);
  const result = stmt.get(userId, walletAddress, collectionId);
  return result !== undefined;
}

// Get all verified wallets for a user
function getUserVerifiedWallets(userId) {
  const stmt = db.prepare(`
    SELECT wallet_address, collection_id, verified_at, current_holding_count 
    FROM verified_wallets
    WHERE user_id = ?
    ORDER BY verified_at DESC
  `);
  return stmt.all(userId);
}

// Get all verified wallets for a user for a specific collection
function getUserVerifiedWalletsForCollection(userId, collectionId) {
  const stmt = db.prepare(`
    SELECT wallet_address, verified_at, current_holding_count 
    FROM verified_wallets
    WHERE user_id = ? AND collection_id = ?
    ORDER BY verified_at DESC
  `);
  return stmt.all(userId, collectionId);
}

// Delete a verified wallet
function deleteVerifiedWallet(userId, walletAddress, collectionId) {
  const stmt = db.prepare(`
    DELETE FROM verified_wallets
    WHERE user_id = ? AND wallet_address = ? AND collection_id = ?
  `);
  const result = stmt.run(userId, walletAddress, collectionId);
  return result.changes > 0;
}

// Update holding count for a wallet
function updateHoldingCount(userId, walletAddress, collectionId, count) {
  const stmt = db.prepare(`
    UPDATE verified_wallets
    SET current_holding_count = ?, last_check_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND wallet_address = ? AND collection_id = ?
  `);
  return stmt.run(count, userId, walletAddress, collectionId);
}

// Create a verification attempt record
function createVerificationAttempt(userId, walletAddress, token) {
  const stmt = db.prepare(`
    INSERT INTO verification_attempts (user_id, wallet_address, token)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(userId, walletAddress, token);
  return result.lastInsertRowid;
}

// Mark verification attempt as successful
function completeVerificationAttempt(attemptId) {
  const stmt = db.prepare(`
    UPDATE verification_attempts
    SET completed_at = CURRENT_TIMESTAMP, success = 1
    WHERE id = ?
  `);
  return stmt.run(attemptId);
}

// Get verification attempt by ID
function getVerificationAttempt(attemptId) {
  const stmt = db.prepare(`
    SELECT * FROM verification_attempts WHERE id = ?
  `);
  return stmt.get(attemptId);
}

// Add user role assignment
function addUserRole(userId, guildId, roleId, collectionId) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO user_roles (user_id, guild_id, role_id, collection_id)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(userId, guildId, roleId, collectionId);
}

// Remove user role assignment
function removeUserRole(userId, guildId, roleId, collectionId) {
  const stmt = db.prepare(`
    DELETE FROM user_roles
    WHERE user_id = ? AND guild_id = ? AND role_id = ? AND collection_id = ?
  `);
  const result = stmt.run(userId, guildId, roleId, collectionId);
  return result.changes > 0;
}

// Get all users with roles in a guild
function getAllUsersWithRoles(guildId) {
  const stmt = db.prepare(`
    SELECT DISTINCT user_id, guild_id FROM user_roles WHERE guild_id = ?
  `);
  return stmt.all(guildId);
}

// Get user's roles for a collection
function getUserRolesForCollection(userId, guildId, collectionId) {
  const stmt = db.prepare(`
    SELECT role_id FROM user_roles
    WHERE user_id = ? AND guild_id = ? AND collection_id = ?
  `);
  return stmt.all(userId, guildId, collectionId);
}

// Get all collection IDs a user is verified for
function getUserCollections(userId) {
  const stmt = db.prepare(`
    SELECT DISTINCT collection_id FROM verified_wallets WHERE user_id = ?
  `);
  return stmt.all(userId);
}

// Get all verified wallets for a user across all collections
function getAllVerifiedWalletsByUser(userId) {
  const stmt = db.prepare(`
    SELECT wallet_address, collection_id, current_holding_count FROM verified_wallets
    WHERE user_id = ?
  `);
  return stmt.all(userId);
}

// Close database connection
function closeDatabase() {
  db.close();
}

module.exports = {
  db,
  initializeDatabase,
  addVerifiedWallet,
  isWalletPreviouslyVerified,
  getUserVerifiedWallets,
  getUserVerifiedWalletsForCollection,
  deleteVerifiedWallet,
  updateHoldingCount,
  createVerificationAttempt,
  completeVerificationAttempt,
  getVerificationAttempt,
  addUserRole,
  removeUserRole,
  getAllUsersWithRoles,
  getUserRolesForCollection,
  getUserCollections,
  getAllVerifiedWalletsByUser,
  closeDatabase
};
