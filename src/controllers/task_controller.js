const taskService = require('../services/task_service');

class TaskController {
  async listTasks(req, res) {
    try {
      const { status, owner_id, creator_id, available_for_me, project_id, testing_queue, search } = req.query;
      const tasks = await taskService.listTasks({
        status,
        ownerId: owner_id,
        creatorId: creator_id,
        availableForEmployeeId: available_for_me === 'true' ? req.user.employeeId : null,
        projectId: project_id,
        testingQueue: testing_queue === 'true',
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
        project_id,
        problem_id,
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
        projectId: project_id,
        problemId: problem_id,
      }, req.user.employeeId);

      res.status(201).json(task);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
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

  async submitForReview(req, res) {
    try {
      const task = await taskService.submitForReview(req.params.id, req.user.employeeId);
      res.json(task);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async reviewTask(req, res) {
    try {
      const { decision, comment } = req.body;
      const task = await taskService.reviewTask(
        req.params.id,
        req.user.employeeId,
        decision,
        comment
      );
      res.json(task);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async listTestingQueue(req, res) {
    try {
      const tasks = await taskService.listTestingQueue(req.user.employeeId);
      res.json(tasks);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message });
    }
  }

  async startTaskTest(req, res) {
    try {
      const task = await taskService.startTaskTest(req.params.id, req.user.employeeId);
      res.json(task);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async completeTaskTest(req, res) {
    try {
      const { result, notes } = req.body;
      const task = await taskService.completeTaskTest(
        req.params.id,
        req.user.employeeId,
        result,
        notes
      );
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

  async listAttachments(req, res) {
    try {
      const attachments = await taskService.listAttachments(req.params.id);
      res.json(attachments);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async addAttachment(req, res) {
    try {
      const { file_name, file_path, file_size_bytes, mime_type } = req.body;
      if (!file_name || !file_path) {
        return res.status(400).json({ error: 'file_name and file_path are required' });
      }
      const attachment = await taskService.addAttachment(req.params.id, {
        uploadedById: req.user.employeeId,
        fileName: file_name,
        filePath: file_path,
        fileSizeBytes: file_size_bytes || 0,
        mimeType: mime_type || 'application/octet-stream',
      });
      res.status(201).json(attachment);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
}

module.exports = new TaskController();
