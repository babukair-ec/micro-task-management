const prisma = require('../config/prisma');

function getTaskWhereClause(taskId) {
  if (typeof taskId === 'number') {
    return { id: taskId };
  }
  const strId = String(taskId);
  if (!isNaN(strId) && !strId.includes('-')) {
    return { id: parseInt(strId, 10) };
  }
  return { outer_id: strId };
}

function getRequestWhereClause(requestId) {
  if (typeof requestId === 'number') {
    return { id: requestId };
  }
  const strId = String(requestId);
  if (!isNaN(strId) && !strId.includes('-')) {
    return { id: parseInt(strId, 10) };
  }
  return { outer_id: strId };
}

class TaskRequestService {
  /**
   * Create a new task request using Prisma
   */
  async createRequest(taskId, requesterId, requestedEmployeeId) {
    const strRequesterId = String(requesterId);
    const strRequestedId = String(requestedEmployeeId);

    if (!taskId || !strRequestedId) {
      throw new Error('Task ID and requested employee ID are required');
    }

    if (strRequesterId === strRequestedId) {
      throw new Error('You cannot send a task request to yourself');
    }

    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) {
      throw new Error('Task not found');
    }

    return await prisma.taskRequest.create({
      data: {
        task_id: task.id,
        requester_id: strRequesterId,
        requested_employee_id: strRequestedId,
        status: 'PENDING',
      }
    });
  }

  /**
   * Accept task request using Prisma transaction
   */
  async acceptRequest(requestId, requestedEmployeeId) {
    const strEmpId = String(requestedEmployeeId);

    return await prisma.$transaction(async (tx) => {
      const request = await tx.taskRequest.findFirst({
        where: getRequestWhereClause(requestId)
      });

      if (!request) {
        throw new Error('Task request not found');
      }

      if (request.requested_employee_id !== strEmpId) {
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
          current_owner_id: strEmpId,
          status: 'ASSIGNED',
        }
      });

      // Record assignment history
      await tx.taskAssignmentHistory.create({
        data: {
          task_id: request.task_id,
          employee_id: strEmpId,
          reason: 'REQUEST_ACCEPTED',
        }
      });

      // Update request status to ACCEPTED
      return await tx.taskRequest.update({
        where: { id: request.id },
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
    const strEmpId = String(requestedEmployeeId);

    const request = await prisma.taskRequest.findFirst({
      where: getRequestWhereClause(requestId)
    });

    if (!request) throw new Error('Task request not found');

    if (request.requested_employee_id !== strEmpId) {
      const err = new Error('Only the requested employee can reject this request');
      err.status = 403;
      throw err;
    }

    if (request.status !== 'PENDING') {
      throw new Error(`Cannot reject request in status: ${request.status}`);
    }

    return await prisma.taskRequest.update({
      where: { id: request.id },
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
    const strRequesterId = String(requesterId);

    const request = await prisma.taskRequest.findFirst({
      where: getRequestWhereClause(requestId)
    });

    if (!request) throw new Error('Task request not found');

    if (request.requester_id !== strRequesterId) {
      const err = new Error('Only the requester can cancel this request');
      err.status = 403;
      throw err;
    }

    if (request.status !== 'PENDING') {
      throw new Error(`Cannot cancel request in status: ${request.status}`);
    }

    return await prisma.taskRequest.update({
      where: { id: request.id },
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
    const strEmpId = String(employeeId);
    const requests = await prisma.taskRequest.findMany({
      where: { requested_employee_id: strEmpId },
      orderBy: { created_at: 'desc' },
      include: { task: true }
    });

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map();
    employees.forEach(e => {
      empMap.set(String(e.id), e);
      if (e.outer_id) empMap.set(String(e.outer_id), e);
    });

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
    const strEmpId = String(employeeId);
    const requests = await prisma.taskRequest.findMany({
      where: { requester_id: strEmpId },
      orderBy: { created_at: 'desc' },
      include: { task: true }
    });

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map();
    employees.forEach(e => {
      empMap.set(String(e.id), e);
      if (e.outer_id) empMap.set(String(e.outer_id), e);
    });

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
