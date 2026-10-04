const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('../src/config/db');
const taskService = require('../src/services/task_service');
const taskRequestService = require('../src/services/task_request_service');
const problemService = require('../../problem-service/src/services/problem_service');
const problemDb = require('../../problem-service/src/config/db');

describe('Employee-Centered Task Management Business Rules', () => {
  const AHMED_ID = 1;
  const MOHAMMED_ID = 2;
  const KHALED_ID = 3;
  const TARIQ_ID = 4; // unauthorized for restricted task

  before(async () => {
    await db.seedDefaultEmployees();
    await problemDb.seedDefaultEmployees();

    // Hook inter-service notifications directly during integration test
    problemService.notifyTaskServiceBlock = async (taskId) => {
      await db.prisma.task.update({
        where: { id: parseInt(taskId, 10) },
        data: { status: 'BLOCKED' },
      });
    };
    problemService.notifyTaskServiceUnblock = async (taskId) => {
      await db.prisma.task.update({
        where: { id: parseInt(taskId, 10) },
        data: { status: 'IN_PROGRESS' },
      });
    };
  });

  // 1. Self Task
  it('1. Self task: Employee creates and owns a task directly', async () => {
    const task = await taskService.createTask({
      title: 'Review API code',
      description: 'Review the microservice authentication flow',
      assignmentMode: 'SELF',
      priority: 'HIGH',
    }, AHMED_ID);

    assert.strictEqual(task.creator_id, AHMED_ID);
    assert.strictEqual(task.current_owner_id, AHMED_ID);
    assert.strictEqual(task.status, 'ASSIGNED');
    assert.strictEqual(task.assignment_history.length, 1);
    assert.strictEqual(task.assignment_history[0].employee_id, AHMED_ID);
    assert.strictEqual(task.assignment_history[0].reason, 'INITIAL_SELF_ASSIGNMENT');
  });

  // 2. Direct Assignment
  it('2. Direct assignment: Employee assigns a task directly to another colleague', async () => {
    const task = await taskService.createTask({
      title: 'Prepare sales report',
      description: 'Prepare quarterly sales report for management',
      assignmentMode: 'DIRECT',
      directAssigneeId: MOHAMMED_ID,
      priority: 'MEDIUM',
    }, AHMED_ID);

    assert.strictEqual(task.creator_id, AHMED_ID);
    assert.strictEqual(task.current_owner_id, MOHAMMED_ID);
    assert.strictEqual(task.status, 'ASSIGNED');
    assert.strictEqual(task.assignment_history.length, 1);
    assert.strictEqual(task.assignment_history[0].employee_id, MOHAMMED_ID);
    assert.strictEqual(task.assignment_history[0].reason, 'INITIAL_DIRECT_ASSIGNMENT');
  });

  // 3 & 4. Claim and Restricted Claim
  it('3 & 4. Restricted claim: Authorized employee can claim, unauthorized cannot', async () => {
    // Ahmed creates claimable task restricted to Mohammed and Khaled
    const task = await taskService.createTask({
      title: 'Fix synchronization problem',
      description: 'Resolve race condition during multi-worker processing',
      assignmentMode: 'CLAIM',
      allowedClaimantIds: [MOHAMMED_ID, KHALED_ID],
      priority: 'URGENT',
    }, AHMED_ID);

    assert.strictEqual(task.status, 'AVAILABLE');
    assert.strictEqual(task.current_owner_id, null);
    assert.strictEqual(task.allowed_claimants.length, 2);

    // Tariq (unauthorized) attempts to claim -> MUST BE REJECTED 403
    await assert.rejects(
      async () => {
        await taskService.claimTask(task.id, TARIQ_ID);
      },
      (err) => {
        assert.strictEqual(err.status, 403);
        assert.match(err.message, /not eligible to claim/i);
        return true;
      }
    );

    // Mohammed (authorized) claims the task
    const claimedTask = await taskService.claimTask(task.id, MOHAMMED_ID);
    assert.strictEqual(claimedTask.status, 'ASSIGNED');
    assert.strictEqual(claimedTask.current_owner_id, MOHAMMED_ID);

    // Now Khaled tries to claim the same task -> MUST BE REJECTED as it is no longer available
    await assert.rejects(
      async () => {
        await taskService.claimTask(task.id, KHALED_ID);
      },
      (err) => {
        assert.match(err.message, /no longer available/i);
        return true;
      }
    );
  });

  // 5. Concurrent Claim Simulation
  it('5. Concurrent claim: Two employees claiming simultaneously results in exactly one winner', async () => {
    const task = await taskService.createTask({
      title: 'Database indexing task',
      assignmentMode: 'CLAIM',
      allowedClaimantIds: [MOHAMMED_ID, KHALED_ID],
    }, AHMED_ID);

    // Run claims concurrently
    const results = await Promise.allSettled([
      taskService.claimTask(task.id, MOHAMMED_ID),
      taskService.claimTask(task.id, KHALED_ID),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one employee must successfully claim');
    assert.strictEqual(rejected.length, 1, 'The other claimant must be rejected');
  });

  // 6, 7, 8. Task Requests
  it('6 & 7. Task request acceptance: requested employee accepts and receives task', async () => {
    const task = await taskService.createTask({
      title: 'Audit security logs',
      assignmentMode: 'REQUEST',
      requestedEmployeeId: KHALED_ID,
    }, AHMED_ID);

    const requests = await taskRequestService.listReceivedRequests(KHALED_ID);
    const targetReq = requests.find(r => r.task_id === task.id);
    assert.ok(targetReq, 'Request should be present in received requests');
    assert.strictEqual(targetReq.status, 'PENDING');

    // Someone else cannot accept
    await assert.rejects(
      async () => {
        await taskRequestService.acceptRequest(targetReq.id, MOHAMMED_ID);
      },
      (err) => {
        assert.strictEqual(err.status, 403);
        return true;
      }
    );

    // Khaled accepts
    const accepted = await taskRequestService.acceptRequest(targetReq.id, KHALED_ID);
    assert.strictEqual(accepted.status, 'ACCEPTED');

    const updatedTask = await taskService.getTaskById(task.id);
    assert.strictEqual(updatedTask.current_owner_id, KHALED_ID);
    assert.strictEqual(updatedTask.status, 'ASSIGNED');
  });

  it('8. Task request rejection: requested employee rejects; task is NOT deleted', async () => {
    const task = await taskService.createTask({
      title: 'Update documentation',
      assignmentMode: 'REQUEST',
      requestedEmployeeId: MOHAMMED_ID,
    }, AHMED_ID);

    const requests = await taskRequestService.listReceivedRequests(MOHAMMED_ID);
    const targetReq = requests.find(r => r.task_id === task.id);

    // Mohammed rejects
    const rejected = await taskRequestService.rejectRequest(targetReq.id, MOHAMMED_ID);
    assert.strictEqual(rejected.status, 'REJECTED');

    // Verify task still exists and history is preserved
    const stillExists = await taskService.getTaskById(task.id);
    assert.ok(stillExists);
    assert.strictEqual(stillExists.requests.length, 1);
    assert.strictEqual(stillExists.requests[0].status, 'REJECTED');
  });

  // 9, 10, 11. Problem Reporting & Resolution Lifecycle
  it('9 & 10. Problem: Reporting blocks task, resolving unblocks without transferring ownership', async () => {
    // 1. Mohammed has a task and starts it
    const task = await taskService.createTask({
      title: 'Deploy Kubernetes cluster',
      assignmentMode: 'DIRECT',
      directAssigneeId: MOHAMMED_ID,
    }, AHMED_ID);

    await taskService.startTask(task.id, MOHAMMED_ID);
    const inProgressTask = await taskService.getTaskById(task.id);
    assert.strictEqual(inProgressTask.status, 'IN_PROGRESS');

    // 2. Mohammed encounters a blocker and reports a problem
    const problem = await problemService.reportProblem(
      task.id,
      MOHAMMED_ID,
      'Network timeout connecting to container registry'
    );
    assert.strictEqual(problem.status, 'OPEN');

    // 3. Task becomes BLOCKED
    const blockedTask = await taskService.getTaskById(task.id);
    assert.strictEqual(blockedTask.status, 'BLOCKED');

    // 4. Khaled is assigned to resolve the problem
    await problemService.assignProblemResolver(problem.id, KHALED_ID, AHMED_ID);
    await problemService.startProblemResolution(problem.id, KHALED_ID);

    // 5. Khaled resolves the problem
    const resolved = await problemService.resolveProblem(
      problem.id,
      KHALED_ID,
      'Configured VPN route and firewall rules'
    );
    assert.strictEqual(resolved.status, 'RESOLVED');

    // 6. Task returns to IN_PROGRESS, AND Mohammed remains the owner!
    const unblockedTask = await taskService.getTaskById(task.id);
    assert.strictEqual(unblockedTask.status, 'IN_PROGRESS');
    assert.strictEqual(unblockedTask.current_owner_id, MOHAMMED_ID, 'Owner must remain Mohammed!');

    // 7. Mohammed can now complete the task
    const completed = await taskService.completeTask(task.id, MOHAMMED_ID);
    assert.strictEqual(completed.status, 'COMPLETED');
    assert.ok(completed.completed_at);
  });

  // 12. Task Reassignment with History
  it('12. Reassignment: Task ownership changes while assignment history remains intact', async () => {
    const task = await taskService.createTask({
      title: 'Implement OAuth provider',
      assignmentMode: 'SELF',
    }, AHMED_ID);

    // Reassign to Khaled
    await taskService.reassignTask(task.id, KHALED_ID, 'Workload balancing', AHMED_ID);

    const reassignedTask = await taskService.getTaskById(task.id);
    assert.strictEqual(reassignedTask.current_owner_id, KHALED_ID);
    assert.strictEqual(reassignedTask.assignment_history.length, 2);

    // First assignment was Ahmed and has ended_at set
    assert.strictEqual(reassignedTask.assignment_history[0].employee_id, AHMED_ID);
    assert.ok(reassignedTask.assignment_history[0].ended_at);

    // Second assignment is Khaled and is current (ended_at is null)
    assert.strictEqual(reassignedTask.assignment_history[1].employee_id, KHALED_ID);
    assert.strictEqual(reassignedTask.assignment_history[1].ended_at, null);
    assert.strictEqual(reassignedTask.assignment_history[1].reason, 'Workload balancing');
  });

  // 13. Invalid State Transitions
  it('13. Invalid transitions: Rejects invalid state transitions', async () => {
    const task = await taskService.createTask({
      title: 'Testing invalid state machine',
      assignmentMode: 'SELF',
    }, AHMED_ID);

    // Cannot complete an ASSIGNED task before starting it
    await assert.rejects(
      async () => {
        await taskService.completeTask(task.id, AHMED_ID);
      },
      (err) => {
        assert.match(err.message, /must be IN_PROGRESS/i);
        return true;
      }
    );
  });
});
