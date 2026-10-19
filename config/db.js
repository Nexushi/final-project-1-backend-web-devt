const mongoose = require('mongoose');

async function connectDB() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_URI.trim()) {
    throw new Error('MONGODB_URI is required. Add it to the backend .env file.');
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: 'pickleball_game',
      serverSelectionTimeoutMS: 10000,
    });
  } catch (err) {
    // Driver errors may contain connection details. Return only safe guidance.
    if (err.code === 18 || err.codeName === 'AuthenticationFailed') {
      throw new Error('MongoDB authentication failed. Check the Atlas database user and password privately.');
    }

    throw new Error('MongoDB connection failed. Check MONGODB_URI, Atlas network access, database permissions, and internet connectivity.');
  }

  console.log('MongoDB connected successfully (pickleball_game).');
  return mongoose.connection;
}

module.exports = connectDB;
