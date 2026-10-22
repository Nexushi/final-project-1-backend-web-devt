const express = require('express');
const { authenticate } = require('../middleware/auth');
const { accountWrites, matchCreation } = require('../middleware/rateLimits');
const { createMatch, listMatches, getMatch, updateMatch, deleteMatch } = require('../controllers/matchController');

const router = express.Router();
router.use(authenticate);
router.use(accountWrites);
router.post('/', matchCreation, createMatch);
router.get('/', listMatches);
router.get('/:id', getMatch);
router.patch('/:id', updateMatch);
router.delete('/:id', deleteMatch);

module.exports = router;
