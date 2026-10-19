const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const difficultyRoutes = require('./routes/difficultyRoutes');
const matchRoutes = require('./routes/matchRoutes');
const adminRoutes = require('./routes/adminRoutes');
const ApiError = require('./utils/ApiError');

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Pickle Ball Pixel Game API is running',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/difficulty', difficultyRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Express error middleware must have all four arguments and come last.
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON request body' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large' });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({ message: err.message });
  }

  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  const message = status === 500 ? 'Internal server error' : 'Invalid request';
  res.status(status).json({ message });
});

module.exports = app;
