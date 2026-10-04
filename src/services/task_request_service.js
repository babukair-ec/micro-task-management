const prisma = require('../config/prisma');

class TaskRequestService {
  /**
   * Create a new task request using Prisma
   */
  async createRequest(taskId, requesterId, requestedEmployeeId) {
    const numericTaskId = parseInt(taskId, 10);
    const numericRequesterId = parseInt(requesterId, 10);
    const numericRequestedId = parseInt(requestedEmployeeId, 10);

    if (!numericTaskId || !numericRequestedId) {
      throw new Error('Task ID and requested employee ID are required');
    }

    if (numericRequesterId === numericRequestedId) {
      throw new Error('You cannot send a task request to yourself');
    }

    return await prisma.taskRequest.create({
      data: {
        task_id: numericTaskId,
        requester_id: numericRequesterId,
        requested_employee_id: numericRequestedId,
        status: 'PENDING',
      }
    });
  }

  /**
   * Accept task request using Prisma transaction
   */
  async acceptRequest(requestId, requestedEmployeeId) {
    const numericReqId = parseInt(requestId, 10);
    const numericEmpId = parseInt(requestedEmployeeId, 10);

    return await prisma.$transaction(async (tx) => {
      const request = await tx.taskRequest.findUnique({
        where: { id: numericReqId }
      });

      if (!request) {
        throw new Error('Task request not found');
      }

      if (request.requested_employee_id !== numericEmpId) {
        const err = new Error('Only the requested employee can accept this request');
        err.status = 403;
        throw err;
      }

      if (request.status !== 'PENDING') {
        throw new Error(`Cannot accept request in status: ${request.status}`);
      }

      // Close previous assignment history on task
      await tx.taskAssignmentHistory.updateMany({
        where: { task_id: request.task_id, ended_at: null },
        data: { ended_at: new Date() }
      });

      // Assign task to requested employee
      await tx.task.update({
        where: { id: request.task_id },
        data: {
          current_owner_id: numericEmpId,
          status: 'ASSIGNED',
        }
      });

      // Record assignment history
      await tx.taskAssignmentHistory.create({
        data: {
          task_id: request.task_id,
          employee_id: numericEmpId,
          reason: 'REQUEST_ACCEPTED',
        }
      });

      // Update request status to ACCEPTED
      return await tx.taskRequest.update({
        where: { id: numericReqId },
        data: {
          status: 'ACCEPTED',
          responded_at: new Date(),
        }
      });
    });
  }

  /**
   * Reject task request: does not delete task
   */
  async rejectRequest(requestId, requestedEmployeeId) {
    const numericReqId = parseInt(requestId, 10);
    const numericEmpId = parseInt(requestedEmployeeId, 10);

    const request = await prisma.taskRequest.findUnique({
      where: { id: numericReqId }
    });

    if (!request) throw new Error('Task request not found');

    if (request.requested_employee_id !== numericEmpId) {
      const err = new Error('Only the requested employee can reject this request');
      err.status = 403;
      throw err;
    }

    if (request.status !== 'PENDING') {
      throw new Error(`Cannot reject request in status: ${request.status}`);
    }

    return await prisma.taskRequest.update({
      where: { id: numericReqId },
      data: {
        status: 'REJECTED',
        responded_at: new Date(),
      }
    });
  }

  /**
   * Cancel task request by requester
   */
  async cancelRequest(requestId, requesterId) {
    const numericReqId = parseInt(requestId, 10);
    const numericRequesterId = parseInt(requesterId, 10);

    const request = await prisma.taskRequest.findUnique({
      where: { id: numericReqId }
    });

    if (!request) throw new Error('Task request not found');

    if (request.requester_id !== numericRequesterId) {
      const err = new Error('Only the requester can cancel this request');
      err.status = 403;
      throw err;
    }

    if (request.status !== 'PENDING') {
      throw new Error(`Cannot cancel request in status: ${request.status}`);
    }

    return await prisma.taskRequest.update({
      where: { id: numericReqId },
      data: {
        status: 'CANCELLED',
        responded_at: new Date(),
      }
    });
  }

  /**
   * List requests received by employee
   */
  async listReceivedRequests(employeeId) {
    const requests = await prisma.taskRequest.findMany({
      where: { requested_employee_id: parseInt(employeeId, 10) },
      orderBy: { created_at: 'desc' },
      include: { task: true }
    });

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map(employees.map(e => [e.id, e]));

    return requests.map(r => {
      const requester = empMap.get(r.requester_id);
      return {
        ...r,
        task_title: r.task?.title || '',
        task_status: r.task?.status || '',
        requester_username: requester?.username || '',
        requester_name: requester?.full_name || requester?.username || '',
      };
    });
  }

  /**
   * List requests sent by employee
   */
  async listSentRequests(employeeId) {
    const requests = await prisma.taskRequest.findMany({
      where: { requester_id: parseInt(employeeId, 10) },
      orderBy: { created_at: 'desc' },
      include: { task: true }
    });

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map(employees.map(e => [e.id, e]));

    return requests.map(r => {
      const requested = empMap.get(r.requested_employee_id);
      return {
        ...r,
        task_title: r.task?.title || '',
        task_status: r.task?.status || '',
        requested_username: requested?.username || '',
        requested_name: requested?.full_name || requested?.username || '',
      };
    });
  }
}

module.exports = new TaskRequestService();
