const express = require('express');
const { listDifficulties } = require('../controllers/difficultyController');

const router = express.Router();
router.get('/', listDifficulties);

module.exports = router;
