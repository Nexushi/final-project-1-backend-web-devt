const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const difficultyRoutes = require('./routes/difficultyRoutes');
const matchRoutes = require('./routes/matchRoutes');
const adminRoutes = require('./routes/adminRoutes');
const ApiError = require('./utils/ApiError');

const app = express();

app.disable('x-powered-by');
// This JSON API is consumed cross-origin; CORS still controls browser read access.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const allowedOrigins = ['http://localhost:5173'];
if (process.env.CORS_ORIGIN?.trim()) {
  allowedOrigins.push(process.env.CORS_ORIGIN.trim());
}
app.use(cors({ origin: allowedOrigins }));
// Set before parsing/authentication so sensitive-route errors are also not stored.
app.use(['/api/auth', '/api/users', '/api/matches', '/api/admin'], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '100kb' }));

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
