/**
 * Database Manager Extension for Auth & RBAC
 * Wraps dbManager to provide user-specific functions.
 */

const dbManager = require('../database/dbManager');

const userManager = {
  /**
   * Create a new user with default role GUEST and status PENDING
   */
  createUser: async (username, hashedPrice) => {
    const sql = `INSERT INTO users (username, password, role, status) VALUES (?, ?, 'GUEST', 'PENDING')`;
    return dbManager.run(sql, [username, hashedPrice]);
  },

  /**
   * Find user by username
   */
  getUserByUsername: async (username) => {
    const rows = await dbManager.query(`SELECT * FROM users WHERE username = ?`, [username]);
    return rows[0] || null;
  },

  /**
   * Get all users with status PENDING
   */
  getAllPendingUsers: async () => {
    return dbManager.query(`SELECT id, username, role, status, created_at FROM users WHERE status = 'PENDING' ORDER BY created_at DESC`);
  },

  /**
   * Get all users in the system
   */
  getAllUsers: async () => {
    return dbManager.query(`SELECT id, username, role, status, created_at FROM users ORDER BY created_at DESC`);
  },

  /**
   * Approve a user: update status to APPROVED and assign a new role
   */
  approveUser: async (id, newRole = 'USER') => {
    const sql = `UPDATE users SET status = 'APPROVED', role = ? WHERE id = ?`;
    return dbManager.run(sql, [newRole, id]);
  },

  /**
   * Delete a user from the system
   */
  deleteUser: async (id) => {
    return dbManager.run(`DELETE FROM users WHERE id = ?`, [id]);
  }
};

module.exports = userManager;
