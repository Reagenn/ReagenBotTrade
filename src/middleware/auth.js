const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-123';

/**
 * Middleware: Verify JWT Token
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Akses ditolak, token tidak ditemukan' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Token tidak valid atau sudah kedaluwarsa' });
  }
};

/**
 * Middleware: Require specific roles
 * @param {string[]} roles Array of allowed roles, e.g., ['ADMIN', 'USER']
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Hanya role ${roles.join('/')} yang diizinkan` });
    }
    next();
  };
};

/**
 * Middleware: Require status APPROVED
 */
const requireApproved = (req, res, next) => {
  if (!req.user || req.user.status !== 'APPROVED') {
    return res.status(403).json({ error: 'Akun Anda belum di-approve oleh Admin' });
  }
  next();
};

module.exports = {
  verifyToken,
  requireRole,
  requireApproved,
  JWT_SECRET
};
