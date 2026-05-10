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
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, wallet_address)
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
  `);
}

// Add a verified wallet
function addVerifiedWallet(userId, walletAddress) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO verified_wallets (user_id, wallet_address)
    VALUES (?, ?)
  `);
  const result = stmt.run(userId, walletAddress);
  return result.changes > 0;
}

// Check if wallet was previously verified by user
function isWalletPreviouslyVerified(userId, walletAddress) {
  const stmt = db.prepare(`
    SELECT id FROM verified_wallets
    WHERE user_id = ? AND wallet_address = ?
  `);
  const result = stmt.get(userId, walletAddress);
  return result !== undefined;
}

// Get all verified wallets for a user
function getUserVerifiedWallets(userId) {
  const stmt = db.prepare(`
    SELECT wallet_address, verified_at FROM verified_wallets
    WHERE user_id = ?
    ORDER BY verified_at DESC
  `);
  return stmt.all(userId);
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
  createVerificationAttempt,
  completeVerificationAttempt,
  getVerificationAttempt,
  closeDatabase
};
