function safeMatch(match) {
  return {
    id: match._id.toString(),
    userId: match.userId.toString(),
    difficultyId: match.difficultyId.toString(),
    difficultySnapshot: {
      levelName: match.difficultySnapshot.levelName,
      aiSpeed: match.difficultySnapshot.aiSpeed,
      ballSpeed: match.difficultySnapshot.ballSpeed,
    },
    playerScore: match.playerScore,
    aiScore: match.aiScore,
    status: match.status,
    version: match.__v,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  };
}

module.exports = safeMatch;
