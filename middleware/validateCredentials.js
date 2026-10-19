function validateCredentials(req, res, next) {
  const body = req.body;

  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return res.status(400).json({ message: 'A username and password are required' });
  }

  // Accept only credentials, never role, passwordHash, or user IDs.
  if (Object.keys(body).some(key => !['username', 'password'].includes(key))) {
    return res.status(400).json({ message: 'Only username and password are allowed' });
  }

  if (typeof body.username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(body.username.trim())) {
    return res.status(400).json({ message: 'Username must be 3-24 letters, numbers, or underscores' });
  }

  // bcrypt only uses the first 72 bytes, so reject longer passwords.
  if (typeof body.password !== 'string' || body.password.length < 8 ||
      !body.password.trim() || Buffer.byteLength(body.password, 'utf8') > 72) {
    return res.status(400).json({ message: 'Password must be at least 8 characters and at most 72 UTF-8 bytes' });
  }

  req.credentials = {
    username: body.username.trim().toLowerCase(),
    password: body.password,
  };
  next();
}

module.exports = validateCredentials;
