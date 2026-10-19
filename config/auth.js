function getJWTSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || !secret.trim()) {
    throw new Error('JWT_SECRET is required. Add it to the backend .env file.');
  }

  return secret;
}

module.exports = getJWTSecret;
