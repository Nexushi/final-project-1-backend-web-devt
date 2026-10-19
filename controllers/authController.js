const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const getJWTSecret = require('../config/auth');
const safeUser = require('../utils/safeUser');

function createToken(user, secret) {
  return jwt.sign({}, secret, {
    subject: user._id.toString(),
    algorithm: 'HS256',
    expiresIn: '1d',
  });
}

async function register(req, res, next) {
  try {
    // Validate configuration before creating an account.
    const secret = getJWTSecret();
    const { username, password } = req.credentials;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, passwordHash, role: 'PLAYER' });

    res.status(201).json({
      message: 'Player registered successfully',
      token: createToken(user, secret),
      user: safeUser(user),
    });
  } catch (err) {
    // The unique index also protects against simultaneous registrations.
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Username is already taken' });
    }
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const secret = getJWTSecret();
    const { username, password } = req.credentials;
    // Password hashes are excluded from normal queries; login needs one.
    const user = await User.findOne({ username }).select('+passwordHash');

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    res.json({
      message: 'Login successful',
      token: createToken(user, secret),
      user: safeUser(user),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login };
