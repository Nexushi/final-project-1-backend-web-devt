const express = require('express');
const { register, login } = require('../controllers/authController');
const validateCredentials = require('../middleware/validateCredentials');

const router = express.Router();
router.post('/register', validateCredentials, register);
router.post('/login', validateCredentials, login);

module.exports = router;
