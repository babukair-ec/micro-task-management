const taskService = require('../services/task_service');

class TaskController {
  async listTasks(req, res) {
    try {
      const { status, owner_id, creator_id, available_for_me, search } = req.query;
      const tasks = await taskService.listTasks({
        status,
        ownerId: owner_id,
        creatorId: creator_id,
        availableForEmployeeId: available_for_me === 'true' ? req.user.employeeId : null,
        search,
      });
      res.json(tasks);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async getTask(req, res) {
    try {
      const task = await taskService.getTaskById(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async createTask(req, res) {
    try {
      const {
        title,
        description,
        priority,
        assignment_mode,
        due_date,
        direct_assignee_id,
        allowed_claimant_ids,
        requested_employee_id,
      } = req.body;

      const task = await taskService.createTask({
        title,
        description,
        priority,
        assignmentMode: assignment_mode,
        dueDate: due_date,
        directAssigneeId: direct_assignee_id,
        allowedClaimantIds: allowed_claimant_ids,
        requestedEmployeeId: requested_employee_id,
      }, req.user.employeeId);

      res.status(201).json(task);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async claimTask(req, res) {
    try {
      const task = await taskService.claimTask(req.params.id, req.user.employeeId);
      res.json(task);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async startTask(req, res) {
    try {
      const task = await taskService.startTask(req.params.id, req.user.employeeId);
      res.json(task);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async completeTask(req, res) {
    try {
      const task = await taskService.completeTask(req.params.id, req.user.employeeId);
      res.json(task);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async cancelTask(req, res) {
    try {
      const task = await taskService.cancelTask(req.params.id, req.user.employeeId);
      res.json(task);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async reassignTask(req, res) {
    try {
      const { new_owner_id, reason } = req.body;
      if (!new_owner_id) {
        return res.status(400).json({ error: 'new_owner_id is required' });
      }
      const task = await taskService.reassignTask(
        req.params.id,
        new_owner_id,
        reason,
        req.user.employeeId
      );
      res.json(task);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }
}

module.exports = new TaskController();
