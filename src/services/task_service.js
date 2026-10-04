const prisma = require('../config/prisma');

class TaskService {
  /**
   * Create a new task following specified assignment mode using Prisma
   */
  async createTask({
    title,
    description,
    priority = 'MEDIUM',
    assignmentMode = 'SELF',
    dueDate = null,
    directAssigneeId = null,
    allowedClaimantIds = [],
    requestedEmployeeId = null,
  }, creatorEmployeeId) {
    if (!title || !title.trim()) {
      throw new Error('Task title is required');
    }

    const validModes = ['SELF', 'DIRECT', 'CLAIM', 'REQUEST'];
    if (!validModes.includes(assignmentMode)) {
      throw new Error(`Invalid assignment mode: ${assignmentMode}`);
    }

    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
    if (!validPriorities.includes(priority)) {
      priority = 'MEDIUM';
    }

    let initialStatus = 'DRAFT';
    let currentOwnerId = null;

    if (assignmentMode === 'SELF') {
      initialStatus = 'ASSIGNED';
      currentOwnerId = creatorEmployeeId;
    } else if (assignmentMode === 'DIRECT') {
      if (!directAssigneeId) {
        throw new Error('Direct assignment requires a specified assignee');
      }
      initialStatus = 'ASSIGNED';
      currentOwnerId = directAssigneeId;
    } else if (assignmentMode === 'CLAIM') {
      initialStatus = 'AVAILABLE';
      currentOwnerId = null;
    } else if (assignmentMode === 'REQUEST') {
      if (!requestedEmployeeId) {
        throw new Error('Task request requires a target employee');
      }
      initialStatus = 'AVAILABLE';
      currentOwnerId = null;
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Create Task
      const task = await tx.task.create({
        data: {
          title: title.trim(),
          description: description || '',
          creator_id: creatorEmployeeId,
          current_owner_id: currentOwnerId,
          status: initialStatus,
          priority: priority,
          assignment_mode: assignmentMode,
          due_date: dueDate ? new Date(dueDate) : null,
        }
      });

      // 2. Initial assignment history
      if (currentOwnerId) {
        const reason = assignmentMode === 'SELF' ? 'INITIAL_SELF_ASSIGNMENT' : 'INITIAL_DIRECT_ASSIGNMENT';
        await tx.taskAssignmentHistory.create({
          data: {
            task_id: task.id,
            employee_id: currentOwnerId,
            reason: reason,
          }
        });
      }

      // 3. Claim eligibility whitelisting
      if (assignmentMode === 'CLAIM' && Array.isArray(allowedClaimantIds) && allowedClaimantIds.length > 0) {
        const eligData = allowedClaimantIds.map(empId => ({
          task_id: task.id,
          employee_id: parseInt(empId, 10),
        }));
        await tx.taskClaimEligibility.createMany({
          data: eligData,
          skipDuplicates: true,
        });
      }

      // 4. Task request creation
      if (assignmentMode === 'REQUEST' && requestedEmployeeId) {
        await tx.taskRequest.create({
          data: {
            task_id: task.id,
            requester_id: creatorEmployeeId,
            requested_employee_id: requestedEmployeeId,
            status: 'PENDING',
          }
        });
      }

      return task;
    }).then(task => this.getTaskById(task.id));
  }

  /**
   * Atomic task claiming with Prisma transaction and row-level locking
   */
  async claimTask(taskId, employeeId) {
    const numericTaskId = parseInt(taskId, 10);
    const numericEmpId = parseInt(employeeId, 10);

    return await prisma.$transaction(async (tx) => {
      // Execute row lock on task
      const rows = await tx.$queryRaw`
        SELECT * FROM "tasks" WHERE id = ${numericTaskId} FOR UPDATE;
      `;

      if (!rows || rows.length === 0) {
        throw new Error('Task not found');
      }

      const task = rows[0];

      if (task.status !== 'AVAILABLE' || task.current_owner_id !== null) {
        throw new Error('Task is no longer available for claiming');
      }

      // Check restricted eligibility if list exists
      const eligibilities = await tx.taskClaimEligibility.findMany({
        where: { task_id: numericTaskId }
      });

      if (eligibilities.length > 0) {
        const allowedIds = eligibilities.map(e => e.employee_id);
        if (!allowedIds.includes(numericEmpId)) {
          const err = new Error('You are not eligible to claim this task');
          err.status = 403;
          throw err;
        }
      }

      // Assign task
      await tx.task.update({
        where: { id: numericTaskId },
        data: {
          status: 'ASSIGNED',
          current_owner_id: numericEmpId,
        }
      });

      // Record assignment history
      await tx.taskAssignmentHistory.create({
        data: {
          task_id: numericTaskId,
          employee_id: numericEmpId,
          reason: 'CLAIMED',
        }
      });

      return numericTaskId;
    }).then(id => this.getTaskById(id));
  }

  /**
   * Start task: ASSIGNED -> IN_PROGRESS
   */
  async startTask(taskId, employeeId) {
    const task = await prisma.task.findUnique({ where: { id: parseInt(taskId, 10) } });
    if (!task) throw new Error('Task not found');

    if (task.current_owner_id !== parseInt(employeeId, 10)) {
      const err = new Error('Only the current task owner can start this task');
      err.status = 403;
      throw err;
    }

    if (task.status !== 'ASSIGNED') {
      throw new Error(`Cannot start task in status: ${task.status}. Must be ASSIGNED.`);
    }

    await prisma.task.update({
      where: { id: parseInt(taskId, 10) },
      data: {
        status: 'IN_PROGRESS',
        started_at: task.started_at || new Date(),
      }
    });

    return await this.getTaskById(taskId);
  }

  /**
   * Complete task: IN_PROGRESS -> COMPLETED
   */
  async completeTask(taskId, employeeId) {
    const task = await prisma.task.findUnique({ where: { id: parseInt(taskId, 10) } });
    if (!task) throw new Error('Task not found');

    if (task.current_owner_id !== parseInt(employeeId, 10)) {
      const err = new Error('Only the current task owner can complete this task');
      err.status = 403;
      throw err;
    }

    if (task.status !== 'IN_PROGRESS') {
      throw new Error(`Cannot complete task in status: ${task.status}. Task must be IN_PROGRESS.`);
    }

    return await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: parseInt(taskId, 10) },
        data: {
          status: 'COMPLETED',
          completed_at: new Date(),
        }
      });

      // Close open assignment history
      await tx.taskAssignmentHistory.updateMany({
        where: {
          task_id: parseInt(taskId, 10),
          ended_at: null,
        },
        data: {
          ended_at: new Date(),
        }
      });
    }).then(() => this.getTaskById(taskId));
  }

  /**
   * Cancel task
   */
  async cancelTask(taskId, employeeId) {
    const numericTaskId = parseInt(taskId, 10);
    const task = await prisma.task.findUnique({ where: { id: numericTaskId } });
    if (!task) throw new Error('Task not found');

    if (task.creator_id !== parseInt(employeeId, 10) && task.current_owner_id !== parseInt(employeeId, 10)) {
      const err = new Error('Only the creator or current owner can cancel this task');
      err.status = 403;
      throw err;
    }

    if (['COMPLETED', 'CANCELLED'].includes(task.status)) {
      throw new Error(`Cannot cancel task in status: ${task.status}`);
    }

    return await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: numericTaskId },
        data: { status: 'CANCELLED' }
      });

      await tx.taskAssignmentHistory.updateMany({
        where: { task_id: numericTaskId, ended_at: null },
        data: { ended_at: new Date() }
      });
    }).then(() => this.getTaskById(taskId));
  }

  /**
   * Reassign task
   */
  async reassignTask(taskId, newOwnerId, reason, currentEmployeeId) {
    const numericTaskId = parseInt(taskId, 10);
    const numericNewOwnerId = parseInt(newOwnerId, 10);
    const task = await prisma.task.findUnique({ where: { id: numericTaskId } });
    if (!task) throw new Error('Task not found');

    if (task.creator_id !== parseInt(currentEmployeeId, 10) && task.current_owner_id !== parseInt(currentEmployeeId, 10)) {
      const err = new Error('Only the creator or current owner can reassign this task');
      err.status = 403;
      throw err;
    }

    if (['COMPLETED', 'CANCELLED'].includes(task.status)) {
      throw new Error(`Cannot reassign task in status: ${task.status}`);
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Close current assignment history
      await tx.taskAssignmentHistory.updateMany({
        where: { task_id: numericTaskId, ended_at: null },
        data: { ended_at: new Date() }
      });

      // 2. Update task
      const newStatus = ['AVAILABLE', 'DRAFT'].includes(task.status) ? 'ASSIGNED' : task.status;
      await tx.task.update({
        where: { id: numericTaskId },
        data: {
          current_owner_id: numericNewOwnerId,
          status: newStatus,
        }
      });

      // 3. New assignment history entry
      await tx.taskAssignmentHistory.create({
        data: {
          task_id: numericTaskId,
          employee_id: numericNewOwnerId,
          reason: reason || 'REASSIGNMENT',
        }
      });
    }).then(() => this.getTaskById(taskId));
  }

  /**
   * Get task with all related entities
   */
  async getTaskById(taskId) {
    const numericTaskId = parseInt(taskId, 10);
    const task = await prisma.task.findUnique({
      where: { id: numericTaskId },
      include: {
        eligibilities: true,
        assignment_histories: {
          orderBy: { assigned_at: 'asc' }
        },
        requests: {
          orderBy: { created_at: 'desc' }
        }
      }
    });

    if (!task) return null;

    // Fetch employee cache names
    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map(employees.map(e => [e.id, e]));

    const creator = empMap.get(task.creator_id);
    const owner = empMap.get(task.current_owner_id);

    task.creator_username = creator?.username || '';
    task.creator_name = creator?.full_name || creator?.username || '';
    task.owner_username = owner?.username || '';
    task.owner_name = owner?.full_name || owner?.username || '';

    task.allowed_claimants = task.eligibilities.map(el => {
      const emp = empMap.get(el.employee_id);
      return {
        employee_id: el.employee_id,
        username: emp?.username || '',
        full_name: emp?.full_name || emp?.username || '',
      };
    });

    task.assignment_history = task.assignment_histories.map(h => {
      const emp = empMap.get(h.employee_id);
      return {
        ...h,
        username: emp?.username || '',
        full_name: emp?.full_name || emp?.username || '',
      };
    });

    task.requests = task.requests.map(r => {
      const requester = empMap.get(r.requester_id);
      const requested = empMap.get(r.requested_employee_id);
      return {
        ...r,
        requester_username: requester?.username || '',
        requester_name: requester?.full_name || requester?.username || '',
        requested_username: requested?.username || '',
        requested_name: requested?.full_name || requested?.username || '',
      };
    });

    return task;
  }

  /**
   * List tasks with filters
   */
  async listTasks({ status, ownerId, creatorId, availableForEmployeeId, search }) {
    const where = {};

    if (status) where.status = status;
    if (ownerId) where.current_owner_id = parseInt(ownerId, 10);
    if (creatorId) where.creator_id = parseInt(creatorId, 10);

    if (availableForEmployeeId) {
      const empId = parseInt(availableForEmployeeId, 10);
      where.status = 'AVAILABLE';
      where.current_owner_id = null;
      where.OR = [
        { eligibilities: { none: {} } },
        { eligibilities: { some: { employee_id: empId } } }
      ];
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        eligibilities: true,
      }
    });

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map(employees.map(e => [e.id, e]));

    return tasks.map(t => {
      const creator = empMap.get(t.creator_id);
      const owner = empMap.get(t.current_owner_id);
      return {
        ...t,
        creator_username: creator?.username || '',
        creator_name: creator?.full_name || creator?.username || '',
        owner_username: owner?.username || '',
        owner_name: owner?.full_name || owner?.username || '',
      };
    });
  }
}

module.exports = new TaskService();
