const express = require('express');
const { register, login } = require('../controllers/authController');
const validateCredentials = require('../middleware/validateCredentials');
const { loginBurst, loginFailures, registration } = require('../middleware/rateLimits');

const router = express.Router();
router.post('/register', registration, validateCredentials, register);
router.post('/login', loginBurst, loginFailures, validateCredentials, login);

module.exports = router;
