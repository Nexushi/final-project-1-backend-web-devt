// Use an explicit list so passwordHash never appears in API responses.
function safeUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    role: user.role,
    preferredDifficultyId: user.preferredDifficultyId?.toString() || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

module.exports = safeUser;
