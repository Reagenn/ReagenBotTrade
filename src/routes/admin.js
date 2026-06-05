const express = require('express');
const router = express.Router();
const userManager = require('../core/database_manager');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * Health check for the admin router
 * URL: /api/admin/users/health
 */
router.get('/health', (req, res) => {
  res.json({ ok: true, msg: "Admin Users Router is active" });
});

/**
 * GET all pending users
 * URL: /api/admin/users/pending
 */
router.get('/pending', verifyToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const users = await userManager.getAllPendingUsers();
    res.json(users || []);
  } catch (err) {
    console.error('[ADMIN] Get pending users error:', err.message);
    res.status(500).json({ error: 'Gagal mengambil daftar user pending' });
  }
});

/**
 * GET all users in database
 * URL: /api/admin/users/all
 */
router.get('/all', verifyToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const users = await userManager.getAllUsers();
    res.json(users || []);
  } catch (err) {
    console.error('[ADMIN] Get all users error:', err.message);
    res.status(500).json({ error: 'Gagal mengambil daftar seluruh user' });
  }
});

/**
 * POST approve user
 * URL: /api/admin/users/approve/:id
 */
router.post('/approve/:id', verifyToken, requireRole(['ADMIN']), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  try {
    await userManager.approveUser(id, role || 'USER');
    res.json({ message: `User ID ${id} berhasil di-approve` });
  } catch (err) {
    console.error('[ADMIN] Approve user error:', err.message);
    res.status(500).json({ error: 'Gagal melakukan approval user' });
  }
});

/**
 * DELETE user
 * URL: /api/admin/users/:id
 */
router.delete('/:id', verifyToken, requireRole(['ADMIN']), async (req, res) => {
  const { id } = req.params;
  try {
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Anda tidak bisa menghapus akun sendiri' });
    }
    await userManager.deleteUser(id);
    res.json({ message: `User ID ${id} berhasil dihapus` });
  } catch (err) {
    console.error('[ADMIN] Delete user error:', err.message);
    res.status(500).json({ error: 'Gagal menghapus user' });
  }
});

module.exports = router;
