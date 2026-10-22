const express = require('express');
const { authenticate } = require('../middleware/auth');
const { accountWrites } = require('../middleware/rateLimits');
const { getProfile, updateProfile, deleteProfile } = require('../controllers/userController');

const router = express.Router();
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, accountWrites, updateProfile);
router.delete('/profile', authenticate, accountWrites, deleteProfile);

module.exports = router;
