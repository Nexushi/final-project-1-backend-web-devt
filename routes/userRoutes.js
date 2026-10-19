const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getProfile, updateProfile, deleteProfile } = require('../controllers/userController');

const router = express.Router();
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.delete('/profile', authenticate, deleteProfile);

module.exports = router;
