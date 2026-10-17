const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task_controller');
const { authenticateJwt } = require('../middleware/auth');
const prisma = require('../config/prisma');

// Inter-service endpoints (used by Problem Service without requiring user JWT)
router.post('/:id/block-internal', async (req, res) => {
  try {
    await prisma.task.update({
      where: { id: req.params.id },
      data: { status: 'BLOCKED' },
    });
    res.json({ message: 'Task blocked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/unblock-internal', async (req, res) => {
  try {
    await prisma.task.updateMany({
      where: {
        id: req.params.id,
        status: 'BLOCKED',
      },
      data: { status: 'IN_PROGRESS' },
    });
    res.json({ message: 'Task unblocked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All other task routes require JWT authentication
router.use(authenticateJwt);

router.get('/', (req, res) => taskController.listTasks(req, res));
router.post('/', (req, res) => taskController.createTask(req, res));

// Testing queue endpoint (must come before :id route)
router.get('/testing-queue', (req, res) => taskController.listTestingQueue(req, res));

router.get('/:id', (req, res) => taskController.getTask(req, res));
router.post('/:id/claim', (req, res) => taskController.claimTask(req, res));
router.post('/:id/start', (req, res) => taskController.startTask(req, res));
router.post('/:id/submit-for-review', (req, res) => taskController.submitForReview(req, res));
router.post('/:id/review', (req, res) => taskController.reviewTask(req, res));
router.post('/:id/start-test', (req, res) => taskController.startTaskTest(req, res));
router.post('/:id/complete-test', (req, res) => taskController.completeTaskTest(req, res));
router.post('/:id/complete', (req, res) => taskController.completeTask(req, res));
router.post('/:id/cancel', (req, res) => taskController.cancelTask(req, res));
router.post('/:id/reassign', (req, res) => taskController.reassignTask(req, res));

// Task Attachment endpoints
router.get('/:id/attachments', (req, res) => taskController.listAttachments(req, res));
router.post('/:id/attachments', (req, res) => taskController.addAttachment(req, res));

module.exports = router;
