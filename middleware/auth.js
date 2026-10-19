const jwt = require('jsonwebtoken');
const User = require('../models/User');
const getJWTSecret = require('../config/auth');

async function authenticate(req, res, next) {
  try {
    const secret = getJWTSecret();
    const authorization = req.get('Authorization');
    const match = authorization && /^Bearer\s+(\S+)$/i.exec(authorization);

    if (!match) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    let payload;
    try {
      payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    if (typeof payload.sub !== 'string' || !/^[a-f0-9]{24}$/i.test(payload.sub)) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    // Role and identity come from MongoDB, never browser input or token roles.
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
