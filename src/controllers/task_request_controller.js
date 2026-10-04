const taskRequestService = require('../services/task_request_service');

class TaskRequestController {
  async listRequests(req, res) {
    try {
      const type = req.query.type || 'received';
      let requests;
      if (type === 'sent') {
        requests = await taskRequestService.listSentRequests(req.user.employeeId);
      } else {
        requests = await taskRequestService.listReceivedRequests(req.user.employeeId);
      }
      res.json(requests);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async createRequest(req, res) {
    try {
      const { task_id, requested_employee_id } = req.body;
      const request = await taskRequestService.createRequest(
        task_id,
        req.user.employeeId,
        requested_employee_id
      );
      res.status(201).json(request);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async acceptRequest(req, res) {
    try {
      const request = await taskRequestService.acceptRequest(
        req.params.id,
        req.user.employeeId
      );
      res.json(request);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async rejectRequest(req, res) {
    try {
      const request = await taskRequestService.rejectRequest(
        req.params.id,
        req.user.employeeId
      );
      res.json(request);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async cancelRequest(req, res) {
    try {
      const request = await taskRequestService.cancelRequest(
        req.params.id,
        req.user.employeeId
      );
      res.json(request);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }
}

module.exports = new TaskRequestController();
