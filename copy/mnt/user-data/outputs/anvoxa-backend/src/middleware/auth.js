require('dotenv').config();
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;   // { sub, role, email, phone }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Only allow internal team members
function requireTeam(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'team') {
      return res.status(403).json({ error: 'Team access only' });
    }
    next();
  });
}

module.exports = { requireAuth, requireTeam };
