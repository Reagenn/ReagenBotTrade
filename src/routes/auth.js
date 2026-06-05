const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userManager = require('../core/database_manager');
const { JWT_SECRET } = require('../middleware/auth');

/**
 * POST /register
 */
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  try {
    const existing = await userManager.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await userManager.createUser(username, hashedPassword);
    res.status(201).json({ message: 'Registrasi berhasil, menunggu approval Admin' });
  } catch (err) {
    console.error('[AUTH] Register error:', err.message);
    res.status(500).json({ error: 'Gagal melakukan registrasi' });
  }
});

/**
 * POST /login
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  try {
    const user = await userManager.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    // Token payload
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      message: 'Login berhasil',
      token,
      user: {
        username: user.username,
        role: user.role,
        status: user.status
      }
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Gagal melakukan login' });
  }
});

module.exports = router;
