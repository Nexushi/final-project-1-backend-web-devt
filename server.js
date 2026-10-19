require('dotenv').config({ quiet: true });

const app = require('./app');
const connectDB = require('./config/db');
const getJWTSecret = require('./config/auth');
const User = require('./models/User');
const DifficultySetting = require('./models/DifficultySetting');
const Match = require('./models/Match');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    getJWTSecret();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  try {
    // The API must not accept requests until its required database is ready.
    await connectDB();
  } catch (err) {
    // connectDB returns safe messages without credentials or driver details.
    console.error(err.message);
    process.exit(1);
  }

  try {
    // Wait for the username unique index before accepting registrations.
    await User.init();
    await DifficultySetting.init();
    await Match.init();
  } catch {
    console.error('Model/index setup failed. Check database permissions and unique names.');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`Pickle Ball Pixel Game API is running on port ${PORT}`);
  });

  server.on('error', (err) => {
    console.error(`Server failed to start (${err.code || 'UNKNOWN_ERROR'}). Check PORT and whether it is already in use.`);
    process.exit(1);
  });
}

startServer();
