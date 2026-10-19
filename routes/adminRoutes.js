const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const admin = require('../controllers/adminController');

const router = express.Router();
router.use(authenticate, requireRole('ADMIN'));
router.get('/users', admin.listPlayers);
router.get('/matches', admin.listMatches);
router.delete('/users/:id', admin.deletePlayer);
router.get('/difficulty', admin.listDifficulties);
router.post('/difficulty', admin.createDifficulty);
router.put('/difficulty/:id', admin.updateDifficulty);
router.delete('/difficulty/:id', admin.deleteDifficulty);

module.exports = router;
