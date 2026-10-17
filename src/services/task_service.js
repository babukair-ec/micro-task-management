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

class TaskService {
  constructor() {
    this._projectCache = {};
  }

  setProjectCache(projectId, data) {
    this._projectCache[String(projectId)] = data;
  }

  async getProjectDetails(projectId) {
    const strId = String(projectId);
    if (this._projectCache[strId]) {
      return this._projectCache[strId];
    }
    const empUrl = process.env.EMPLOYEE_SERVICE_URL || 'http://localhost:8002';
    try {
      const res = await fetch(`${empUrl}/api/employees/departments-projects/${strId}/`);
      if (res.ok) {
        const data = await res.json();
        this._projectCache[strId] = data;
        return data;
      }
    } catch (e) {
      // fallback
    }
    return null;
  }

  async isTester(employeeId) {
    if (!employeeId) return false;
    const strId = String(employeeId);
    const isNum = !isNaN(strId) && !strId.includes('-');
    const emp = await prisma.employeeCache.findFirst({
      where: isNum ? { OR: [{ id: parseInt(strId, 10) }, { outer_id: strId }] } : { outer_id: strId }
    });
    return emp && emp.employee_type === 'TESTER';
  }

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
    projectId = null,
    problemId = null,
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

    // Validate Project if provided
    let verifiedProjectId = null;
    if (projectId) {
      const projectData = await this.getProjectDetails(projectId);
      if (projectData && projectData.type === 'DEPARTMENT') {
        const err = new Error('Task project_id must refer to a Project, not a Department');
        err.status = 400;
        throw err;
      }
      verifiedProjectId = String(projectId);
    }

    let initialStatus = 'DRAFT';
    let currentOwnerId = null;

    if (assignmentMode === 'SELF') {
      initialStatus = 'ASSIGNED';
      currentOwnerId = String(creatorEmployeeId);
    } else if (assignmentMode === 'DIRECT') {
      if (!directAssigneeId) {
        throw new Error('Direct assignment requires a specified assignee');
      }
      initialStatus = 'ASSIGNED';
      currentOwnerId = String(directAssigneeId);
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
          creator_id: String(creatorEmployeeId),
          current_owner_id: currentOwnerId,
          project_id: verifiedProjectId,
          problem_id: problemId ? String(problemId) : null,
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
          employee_id: String(empId),
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
            requester_id: String(creatorEmployeeId),
            requested_employee_id: String(requestedEmployeeId),
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
    const strTaskId = String(taskId);
    const strEmpId = String(employeeId);
    const isNum = !isNaN(strTaskId) && !strTaskId.includes('-');

    return await prisma.$transaction(async (tx) => {
      // Execute row lock on task using appropriate type
      const rows = isNum
        ? await tx.$queryRaw`SELECT * FROM "tasks" WHERE id = ${parseInt(strTaskId, 10)} FOR UPDATE;`
        : await tx.$queryRaw`SELECT * FROM "tasks" WHERE outer_id = ${strTaskId}::uuid FOR UPDATE;`;

      if (!rows || rows.length === 0) {
        throw new Error('Task not found');
      }

      const task = rows[0];

      if (task.status !== 'AVAILABLE' || task.current_owner_id !== null) {
        throw new Error('Task is no longer available for claiming');
      }

      // Check restricted eligibility if list exists
      const eligibilities = await tx.taskClaimEligibility.findMany({
        where: { task_id: task.id }
      });

      if (eligibilities.length > 0) {
        const allowedIds = eligibilities.map(e => e.employee_id);
        if (!allowedIds.includes(strEmpId)) {
          const err = new Error('You are not eligible to claim this task');
          err.status = 403;
          throw err;
        }
      }

      // Assign task
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: 'ASSIGNED',
          current_owner_id: strEmpId,
        }
      });

      // Record assignment history
      await tx.taskAssignmentHistory.create({
        data: {
          task_id: task.id,
          employee_id: strEmpId,
          reason: 'CLAIMED',
        }
      });

      return task.id;
    }).then(id => this.getTaskById(id));
  }

  /**
   * Start task: ASSIGNED -> IN_PROGRESS
   */
  async startTask(taskId, employeeId) {
    const strEmpId = String(employeeId);
    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    if (task.current_owner_id !== strEmpId) {
      const err = new Error('Only the current task owner can start this task');
      err.status = 403;
      throw err;
    }

    if (task.status !== 'ASSIGNED') {
      throw new Error(`Cannot start task in status: ${task.status}. Must be ASSIGNED.`);
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'IN_PROGRESS',
        started_at: task.started_at || new Date(),
      }
    });

    return await this.getTaskById(task.id);
  }

  /**
   * Submit task for review: IN_PROGRESS -> PENDING_REVIEW
   */
  async submitForReview(taskId, employeeId) {
    const strEmpId = String(employeeId);
    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    if (task.current_owner_id !== strEmpId) {
      const err = new Error('Only the current task owner can submit this task for review');
      err.status = 403;
      throw err;
    }

    if (task.status !== 'IN_PROGRESS') {
      throw new Error(`Cannot submit task in status: ${task.status}. Task must be IN_PROGRESS.`);
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'PENDING_REVIEW',
      }
    });

    return await this.getTaskById(task.id);
  }

  /**
   * Determine expected reviewer for a task:
   * - Standalone task (project_id == null) -> creator_id
   * - Project task (project_id != null) -> project.manager_id
   */
  async getExpectedReviewerId(task) {
    if (!task.project_id) {
      return task.creator_id;
    }
    const project = await this.getProjectDetails(task.project_id);
    if (project && (project.manager || project.manager_id)) {
      return project.manager || project.manager_id;
    }
    return task.creator_id;
  }

  /**
   * Review task: decision is either 'APPROVED' or 'REJECTED'
   */
  async reviewTask(taskId, reviewerId, decision, comment = '') {
    const strReviewerId = String(reviewerId);

    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    if (task.status !== 'PENDING_REVIEW') {
      throw new Error(`Cannot review task in status: ${task.status}. Must be PENDING_REVIEW.`);
    }

    const expectedReviewer = await this.getExpectedReviewerId(task);
    if (strReviewerId !== String(expectedReviewer)) {
      const err = new Error('Only the designated reviewer (Project Manager for project tasks, or Creator for standalone tasks) can review this task');
      err.status = 403;
      throw err;
    }

    const upperDecision = (decision || '').toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(upperDecision)) {
      throw new Error('Review decision must be either APPROVED or REJECTED');
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Record review history audit
      await tx.taskReviewHistory.create({
        data: {
          task_id: task.id,
          reviewer_id: strReviewerId,
          decision: upperDecision,
          comment: comment || '',
        }
      });

      // 2. Transition status
      if (upperDecision === 'REJECTED') {
        // Returned to original owner to work on it again
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: 'IN_PROGRESS',
            reviewer_id: strReviewerId,
            reviewed_at: new Date(),
            review_comment: comment || '',
          }
        });
      } else {
        // APPROVED -> enters TESTING queue
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: 'TESTING',
            reviewer_id: strReviewerId,
            reviewed_at: new Date(),
            review_comment: comment || '',
          }
        });
      }
    }).then(() => this.getTaskById(task.id));
  }

  /**
   * List Testing Queue (tasks with status TESTING).
   * Strictly requires employee to be a TESTER.
   */
  async listTestingQueue(employeeId) {
    if (employeeId) {
      const tester = await this.isTester(employeeId);
      if (!tester) {
        const err = new Error('Access denied: only QA Testers can access the testing queue');
        err.status = 403;
        throw err;
      }
    }

    return await this.listTasks({ status: 'TESTING' });
  }

  /**
   * Start testing a task: records testing audit without changing task owner
   */
  async startTaskTest(taskId, testerId) {
    const strTesterId = String(testerId);

    const tester = await this.isTester(strTesterId);
    if (!tester) {
      const err = new Error('Only QA Testers can test tasks');
      err.status = 403;
      throw err;
    }

    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    if (task.status !== 'TESTING') {
      throw new Error(`Cannot start test on task with status: ${task.status}. Must be TESTING.`);
    }

    await prisma.taskTestingAudit.create({
      data: {
        task_id: task.id,
        tester_id: strTesterId,
        result: 'IN_PROGRESS',
        started_at: new Date(),
      }
    });

    return await this.getTaskById(task.id);
  }

  /**
   * Complete task test:
   * - result == 'FAILED' -> status: IN_PROGRESS (returned to original owner)
   * - result == 'PASSED' -> status: CLOSED (completed)
   */
  async completeTaskTest(taskId, testerId, result, notes = '') {
    const strTesterId = String(testerId);

    const tester = await this.isTester(strTesterId);
    if (!tester) {
      const err = new Error('Only QA Testers can test tasks');
      err.status = 403;
      throw err;
    }

    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    if (task.status !== 'TESTING') {
      throw new Error(`Cannot complete test on task with status: ${task.status}. Must be in TESTING.`);
    }

    const upperResult = (result || '').toUpperCase();
    if (!['PASSED', 'FAILED'].includes(upperResult)) {
      throw new Error('Test result must be either PASSED or FAILED');
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Record test audit
      await tx.taskTestingAudit.create({
        data: {
          task_id: task.id,
          tester_id: strTesterId,
          result: upperResult,
          notes: notes || '',
          completed_at: new Date(),
        }
      });

      // 2. Status transition
      if (upperResult === 'FAILED') {
        // Returned to original owner to fix
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: 'IN_PROGRESS',
          }
        });
      } else {
        // PASSED -> CLOSED
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: 'CLOSED',
            completed_at: new Date(),
          }
        });

        // Close assignment history
        await tx.taskAssignmentHistory.updateMany({
          where: {
            task_id: task.id,
            ended_at: null,
          },
          data: {
            ended_at: new Date(),
          }
        });
      }
    }).then(() => this.getTaskById(task.id));
  }

  /**
   * Complete task: IN_PROGRESS -> COMPLETED (Legacy direct close retained for compatibility)
   */
  async completeTask(taskId, employeeId) {
    const strEmpId = String(employeeId);
    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    if (task.current_owner_id !== strEmpId) {
      const err = new Error('Only the current task owner can complete this task');
      err.status = 403;
      throw err;
    }

    if (task.status !== 'IN_PROGRESS') {
      throw new Error(`Cannot complete task in status: ${task.status}. Task must be IN_PROGRESS.`);
    }

    return await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: 'COMPLETED',
          completed_at: new Date(),
        }
      });

      // Close open assignment history
      await tx.taskAssignmentHistory.updateMany({
        where: {
          task_id: task.id,
          ended_at: null,
        },
        data: {
          ended_at: new Date(),
        }
      });
    }).then(() => this.getTaskById(task.id));
  }

  /**
   * Cancel task
   */
  async cancelTask(taskId, employeeId) {
    const strEmpId = String(employeeId);
    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    if (task.creator_id !== strEmpId && task.current_owner_id !== strEmpId) {
      const err = new Error('Only the creator or current owner can cancel this task');
      err.status = 403;
      throw err;
    }

    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(task.status)) {
      throw new Error(`Cannot cancel task in status: ${task.status}`);
    }

    return await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: { status: 'CANCELLED' }
      });

      await tx.taskAssignmentHistory.updateMany({
        where: { task_id: task.id, ended_at: null },
        data: { ended_at: new Date() }
      });
    }).then(() => this.getTaskById(task.id));
  }

  /**
   * Reassign task
   */
  async reassignTask(taskId, newOwnerId, reason, currentEmployeeId) {
    const strNewOwnerId = String(newOwnerId);
    const strCurrentEmpId = String(currentEmployeeId);

    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    if (task.creator_id !== strCurrentEmpId && task.current_owner_id !== strCurrentEmpId) {
      const err = new Error('Only the creator or current owner can reassign this task');
      err.status = 403;
      throw err;
    }

    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(task.status)) {
      throw new Error(`Cannot reassign task in status: ${task.status}`);
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Close current assignment history
      await tx.taskAssignmentHistory.updateMany({
        where: { task_id: task.id, ended_at: null },
        data: { ended_at: new Date() }
      });

      // 2. Update task
      const newStatus = ['AVAILABLE', 'DRAFT'].includes(task.status) ? 'ASSIGNED' : task.status;
      await tx.task.update({
        where: { id: task.id },
        data: {
          current_owner_id: strNewOwnerId,
          status: newStatus,
        }
      });

      // 3. New assignment history entry
      await tx.taskAssignmentHistory.create({
        data: {
          task_id: task.id,
          employee_id: strNewOwnerId,
          reason: reason || 'REASSIGNMENT',
        }
      });
    }).then(() => this.getTaskById(task.id));
  }

  /**
   * Add attachment to task
   */
  async addAttachment(taskId, { uploadedById, fileName, filePath, fileSizeBytes, mimeType }) {
    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    return await prisma.taskAttachment.create({
      data: {
        task_id: task.id,
        uploaded_by_id: String(uploadedById),
        file_name: fileName,
        file_path: filePath,
        file_size_bytes: BigInt(fileSizeBytes || 0),
        mime_type: mimeType || 'application/octet-stream',
      }
    });
  }

  /**
   * List attachments for a task
   */
  async listAttachments(taskId) {
    const task = await prisma.task.findFirst({ where: getTaskWhereClause(taskId) });
    if (!task) throw new Error('Task not found');

    const attachments = await prisma.taskAttachment.findMany({
      where: { task_id: task.id },
      orderBy: { created_at: 'desc' }
    });

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map();
    employees.forEach(e => {
      empMap.set(String(e.id), e);
      if (e.outer_id) empMap.set(String(e.outer_id), e);
    });

    return attachments.map(att => {
      const uploader = empMap.get(att.uploaded_by_id);
      return {
        ...att,
        file_size_bytes: att.file_size_bytes.toString(),
        uploaded_by_username: uploader?.username || '',
        uploaded_by_name: uploader?.full_name || uploader?.username || '',
      };
    });
  }

  /**
   * Get task with all related entities
   */
  async getTaskById(taskId) {
    if (!taskId) return null;
    const task = await prisma.task.findFirst({
      where: getTaskWhereClause(taskId),
      include: {
        eligibilities: true,
        assignment_histories: {
          orderBy: { assigned_at: 'asc' }
        },
        requests: {
          orderBy: { created_at: 'desc' }
        },
        attachments: {
          orderBy: { created_at: 'desc' }
        },
        reviews: {
          orderBy: { created_at: 'desc' }
        },
        test_audits: {
          orderBy: { started_at: 'desc' }
        }
      }
    });

    if (!task) return null;

    // Fetch employee cache names
    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map();
    employees.forEach(e => {
      empMap.set(String(e.id), e);
      if (e.outer_id) empMap.set(String(e.outer_id), e);
    });

    const creator = empMap.get(String(task.creator_id));
    const owner = empMap.get(String(task.current_owner_id));
    const reviewer = empMap.get(String(task.reviewer_id));

    task.creator_username = creator?.username || '';
    task.creator_name = creator?.full_name || creator?.username || '';
    task.owner_username = owner?.username || '';
    task.owner_name = owner?.full_name || owner?.username || '';
    task.reviewer_username = reviewer?.username || '';
    task.reviewer_name = reviewer?.full_name || reviewer?.username || '';

    // Fetch project details if linked
    if (task.project_id) {
      const project = await this.getProjectDetails(task.project_id);
      if (project) {
        task.project_name = project.name || '';
        task.project_code = project.code || '';
        task.project_manager_id = project.manager || project.manager_id || '';
      }
    }

    task.allowed_claimants = task.eligibilities.map(el => {
      const emp = empMap.get(String(el.employee_id));
      return {
        id: el.id,
        outer_id: el.outer_id,
        employee_id: el.employee_id,
        username: emp?.username || '',
        full_name: emp?.full_name || emp?.username || '',
      };
    });

    task.assignment_history = task.assignment_histories.map(h => {
      const emp = empMap.get(String(h.employee_id));
      return {
        ...h,
        username: emp?.username || '',
        full_name: emp?.full_name || emp?.username || '',
      };
    });

    task.requests = task.requests.map(r => {
      const requester = empMap.get(String(r.requester_id));
      const requested = empMap.get(String(r.requested_employee_id));
      return {
        ...r,
        requester_username: requester?.username || '',
        requester_name: requester?.full_name || requester?.username || '',
        requested_username: requested?.username || '',
        requested_name: requested?.full_name || requested?.username || '',
      };
    });

    task.attachments = (task.attachments || []).map(att => {
      const uploader = empMap.get(String(att.uploaded_by_id));
      return {
        ...att,
        file_size_bytes: att.file_size_bytes ? att.file_size_bytes.toString() : '0',
        uploaded_by_username: uploader?.username || '',
        uploaded_by_name: uploader?.full_name || uploader?.username || '',
      };
    });

    task.reviews = (task.reviews || []).map(rev => {
      const revEmp = empMap.get(String(rev.reviewer_id));
      return {
        ...rev,
        reviewer_username: revEmp?.username || '',
        reviewer_name: revEmp?.full_name || revEmp?.username || '',
      };
    });

    task.test_audits = (task.test_audits || []).map(tst => {
      const tstEmp = empMap.get(String(tst.tester_id));
      return {
        ...tst,
        tester_username: tstEmp?.username || '',
        tester_name: tstEmp?.full_name || tstEmp?.username || '',
      };
    });

    return task;
  }

  /**
   * List tasks with filters
   */
  async listTasks({ status, ownerId, creatorId, availableForEmployeeId, projectId, search }) {
    const where = {};

    if (status) where.status = status;
    if (ownerId) where.current_owner_id = String(ownerId);
    if (creatorId) where.creator_id = String(creatorId);
    if (projectId) where.project_id = String(projectId);

    if (availableForEmployeeId) {
      const empId = String(availableForEmployeeId);
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
    const empMap = new Map();
    employees.forEach(e => {
      empMap.set(String(e.id), e);
      if (e.outer_id) empMap.set(String(e.outer_id), e);
    });

    return tasks.map(t => {
      const creator = empMap.get(String(t.creator_id));
      const owner = empMap.get(String(t.current_owner_id));
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
