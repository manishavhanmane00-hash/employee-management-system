const express = require('express');
const { protect } = require('../middleware/auth');
const { getRequests, submitRequest, reviewRequest, streamNotifications } = require('../controllers/requestController');

const router = express.Router();
router.use(protect);
router.get('/stream', streamNotifications);
router.get('/', getRequests);
router.post('/', submitRequest);
router.put('/:id/review', reviewRequest);

module.exports = router;
