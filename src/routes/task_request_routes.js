const express = require('express');
const router = express.Router();
const taskRequestController = require('../controllers/task_request_controller');
const { authenticateJwt } = require('../middleware/auth');

router.use(authenticateJwt);

router.get('/', (req, res) => taskRequestController.listRequests(req, res));
router.post('/', (req, res) => taskRequestController.createRequest(req, res));
router.post('/:id/accept', (req, res) => taskRequestController.acceptRequest(req, res));
router.post('/:id/reject', (req, res) => taskRequestController.rejectRequest(req, res));
router.post('/:id/cancel', (req, res) => taskRequestController.cancelRequest(req, res));

module.exports = router;
