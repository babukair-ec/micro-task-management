const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('../src/config/db');
const taskService = require('../src/services/task_service');
const taskRequestService = require('../src/services/task_request_service');
const problemService = require('../../problem-service/src/services/problem_service');
const problemDb = require('../../problem-service/src/config/db');

describe('Employee-Centered Task Management Business Rules', () => {
  const AHMED_ID = '11111111-1111-4111-8111-111111111111';
  const MOHAMMED_ID = '22222222-2222-4222-8222-222222222222';
  const KHALED_ID = '33333333-3333-4333-8333-333333333333';
  const TARIQ_ID = '44444444-4444-4444-8444-444444444444'; // unauthorized for restricted task

  before(async () => {
    await db.seedDefaultEmployees();
    await problemDb.seedDefaultEmployees();

    // Hook inter-service notifications directly during integration test
    problemService.notifyTaskServiceBlock = async (taskId) => {
      const strId = String(taskId);
      const isNum = !isNaN(strId) && !strId.includes('-');
      await db.prisma.task.update({
        where: isNum ? { id: parseInt(strId, 10) } : { outer_id: strId },
        data: { status: 'BLOCKED' },
      });
    };
    problemService.notifyTaskServiceUnblock = async (taskId) => {
      const strId = String(taskId);
      const isNum = !isNaN(strId) && !strId.includes('-');
      await db.prisma.task.update({
        where: isNum ? { id: parseInt(strId, 10) } : { outer_id: strId },
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
      task.outer_id || task.id,
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

  // 14. Task Attachments
  it('14. Task attachments: Adds and retrieves attachments with file metadata', async () => {
    const task = await taskService.createTask({
      title: 'Design document review',
      assignmentMode: 'SELF',
    }, AHMED_ID);

    const attachment = await taskService.addAttachment(task.id, {
      uploadedById: AHMED_ID,
      fileName: 'architecture_diagram.png',
      filePath: '/uploads/architecture_diagram.png',
      fileSizeBytes: 2048576,
      mimeType: 'image/png',
    });

    assert.ok(attachment.id);
    assert.strictEqual(attachment.file_name, 'architecture_diagram.png');
    assert.strictEqual(attachment.task_id, task.id);
    assert.strictEqual(attachment.uploaded_by_id, AHMED_ID);

    const taskWithAttachments = await taskService.getTaskById(task.id);
    assert.strictEqual(taskWithAttachments.attachments.length, 1);
    assert.strictEqual(taskWithAttachments.attachments[0].file_name, 'architecture_diagram.png');
  });

  // =========================================================================
  // NEW TASKORBIT REQUIREMENTS TESTS (15 to 28)
  // =========================================================================

  const TEST_PROJECT_ID = '99999999-9999-4999-8999-999999999999';
  const TEST_DEPT_ID = '88888888-8888-4888-8888-888888888888';

  // 15 & 16. Standalone vs Project Task Review Determination
  it('15. Standalone task goes to review at creator_id', async () => {
    // Mohammed creates a task for himself
    const task = await taskService.createTask({
      title: 'Fix standalone bug',
      assignmentMode: 'SELF',
    }, MOHAMMED_ID);

    await taskService.startTask(task.id, MOHAMMED_ID);
    await taskService.submitForReview(task.id, MOHAMMED_ID);

    const submittedTask = await taskService.getTaskById(task.id);
    assert.strictEqual(submittedTask.status, 'PENDING_REVIEW');

    const expectedReviewer = await taskService.getExpectedReviewerId(submittedTask);
    assert.strictEqual(expectedReviewer, MOHAMMED_ID, 'Expected reviewer must be creator (Mohammed)');
  });

  it('16. Project task goes to review at project manager (regardless of creator)', async () => {
    // Setup mock project where Ahmed is Manager
    taskService.setProjectCache(TEST_PROJECT_ID, {
      id: TEST_PROJECT_ID,
      name: 'Cloud Migration',
      type: 'PROJECT',
      manager_id: AHMED_ID,
    });

    // Mohammed creates a task linked to the project and assigns it to Khaled
    const task = await taskService.createTask({
      title: 'Configure VPC peering for project',
      assignmentMode: 'DIRECT',
      directAssigneeId: KHALED_ID,
      projectId: TEST_PROJECT_ID,
    }, MOHAMMED_ID);

    assert.strictEqual(task.project_id, TEST_PROJECT_ID);

    await taskService.startTask(task.id, KHALED_ID);
    await taskService.submitForReview(task.id, KHALED_ID);

    const submittedTask = await taskService.getTaskById(task.id);
    assert.strictEqual(submittedTask.status, 'PENDING_REVIEW');

    const expectedReviewer = await taskService.getExpectedReviewerId(submittedTask);
    assert.strictEqual(expectedReviewer, AHMED_ID, 'Expected reviewer must be Project Manager (Ahmed), not creator!');

    // Someone else (Mohammed) cannot review -> 403 Forbidden
    await assert.rejects(
      async () => {
        await taskService.reviewTask(task.id, MOHAMMED_ID, 'APPROVED', 'Looks good');
      },
      (err) => {
        assert.strictEqual(err.status, 403);
        assert.match(err.message, /designated reviewer/i);
        return true;
      }
    );
  });

  it('Reject linking a task to a Department instead of a Project', async () => {
    taskService.setProjectCache(TEST_DEPT_ID, {
      id: TEST_DEPT_ID,
      name: 'Core Department',
      type: 'DEPARTMENT',
      manager_id: AHMED_ID,
    });

    await assert.rejects(
      async () => {
        await taskService.createTask({
          title: 'Invalid task linked to department',
          assignmentMode: 'SELF',
          projectId: TEST_DEPT_ID,
        }, MOHAMMED_ID);
      },
      (err) => {
        assert.match(err.message, /must refer to a Project, not a Department/i);
        return true;
      }
    );
  });

  // 17. Review Rejection: returns to employee
  it('17. Review rejection returns task to employee with rejection reason and preserves owner', async () => {
    const task = await taskService.createTask({
      title: 'Implement OAuth refresh token',
      assignmentMode: 'DIRECT',
      directAssigneeId: MOHAMMED_ID,
    }, AHMED_ID);

    await taskService.startTask(task.id, MOHAMMED_ID);
    await taskService.submitForReview(task.id, MOHAMMED_ID);

    // Ahmed (creator) rejects the task with notes
    const rejectedTask = await taskService.reviewTask(
      task.id,
      AHMED_ID,
      'REJECTED',
      'Please add unit tests for token expiration'
    );

    assert.strictEqual(rejectedTask.status, 'IN_PROGRESS');
    assert.strictEqual(rejectedTask.current_owner_id, MOHAMMED_ID, 'Owner must remain Mohammed!');
    assert.strictEqual(rejectedTask.review_comment, 'Please add unit tests for token expiration');
    assert.strictEqual(rejectedTask.reviews.length, 1);
    assert.strictEqual(rejectedTask.reviews[0].decision, 'REJECTED');
  });

  // 18. Review Approval: moves to testing queue
  it('18. Review approval moves task to TESTING queue', async () => {
    const task = await taskService.createTask({
      title: 'Optimize SQL queries',
      assignmentMode: 'DIRECT',
      directAssigneeId: MOHAMMED_ID,
    }, AHMED_ID);

    await taskService.startTask(task.id, MOHAMMED_ID);
    await taskService.submitForReview(task.id, MOHAMMED_ID);

    // Ahmed approves
    const approvedTask = await taskService.reviewTask(task.id, AHMED_ID, 'APPROVED', 'Code approved');
    assert.strictEqual(approvedTask.status, 'TESTING');
    assert.strictEqual(approvedTask.reviews.length, 1);
    assert.strictEqual(approvedTask.reviews[0].decision, 'APPROVED');
  });

  // 19, 20, 21. Tester Permissions and Owner Preservation
  it('19, 20, 21. Tester can test, non-tester is rejected, and tester does NOT become owner', async () => {
    const task = await taskService.createTask({
      title: 'Checkout payment flow',
      assignmentMode: 'DIRECT',
      directAssigneeId: MOHAMMED_ID,
    }, AHMED_ID);

    await taskService.startTask(task.id, MOHAMMED_ID);
    await taskService.submitForReview(task.id, MOHAMMED_ID);
    await taskService.reviewTask(task.id, AHMED_ID, 'APPROVED', 'Ready for QA');

    // 20. Regular employee (Khaled, EMPLOYEE type) cannot access testing queue or test
    await assert.rejects(
      async () => {
        await taskService.startTaskTest(task.id, KHALED_ID);
      },
      (err) => {
        assert.strictEqual(err.status, 403);
        assert.match(err.message, /only.*testers/i);
        return true;
      }
    );

    // 19. Tariq (TESTER type) starts testing
    const testedTask = await taskService.startTaskTest(task.id, TARIQ_ID);
    assert.strictEqual(testedTask.status, 'TESTING');

    // 21. Tester does NOT become owner!
    assert.strictEqual(testedTask.current_owner_id, MOHAMMED_ID, 'Owner must remain Mohammed!');
    assert.strictEqual(testedTask.test_audits.length, 1);
    assert.strictEqual(testedTask.test_audits[0].tester_id, TARIQ_ID);
  });

  // 22. Test Failure: returns to employee
  it('22. Test failure returns task to employee (IN_PROGRESS) with test notes', async () => {
    const task = await taskService.createTask({
      title: 'User registration with email verification',
      assignmentMode: 'DIRECT',
      directAssigneeId: MOHAMMED_ID,
    }, AHMED_ID);

    await taskService.startTask(task.id, MOHAMMED_ID);
    await taskService.submitForReview(task.id, MOHAMMED_ID);
    await taskService.reviewTask(task.id, AHMED_ID, 'APPROVED');

    // Tariq fails the test
    const failedTask = await taskService.completeTaskTest(
      task.id,
      TARIQ_ID,
      'FAILED',
      'Verification email was not received in inbox'
    );

    assert.strictEqual(failedTask.status, 'IN_PROGRESS');
    assert.strictEqual(failedTask.current_owner_id, MOHAMMED_ID, 'Owner must remain Mohammed!');
    assert.strictEqual(failedTask.test_audits[0].result, 'FAILED');
    assert.strictEqual(failedTask.test_audits[0].notes, 'Verification email was not received in inbox');
  });

  // 23. Test Pass: closes task
  it('23. Test pass closes the task (CLOSED)', async () => {
    const task = await taskService.createTask({
      title: 'Password reset link generation',
      assignmentMode: 'DIRECT',
      directAssigneeId: MOHAMMED_ID,
    }, AHMED_ID);

    await taskService.startTask(task.id, MOHAMMED_ID);
    await taskService.submitForReview(task.id, MOHAMMED_ID);
    await taskService.reviewTask(task.id, AHMED_ID, 'APPROVED');

    // Tariq passes the test
    const passedTask = await taskService.completeTaskTest(
      task.id,
      TARIQ_ID,
      'PASSED',
      'All QA test assertions passed successfully'
    );

    assert.strictEqual(passedTask.status, 'CLOSED');
    assert.ok(passedTask.completed_at);
    assert.strictEqual(passedTask.test_audits[0].result, 'PASSED');
  });

  // 24, 25, 27. Problems: Task Problem, Project Problem, and Validation
  it('24 & 25. Can create Problem linked to Task or Project independently', async () => {
    // 24. Task Problem
    const taskProblem = await problemService.reportProblem({
      taskId: 'a5000000-0000-4000-8000-000000000001',
      reportedById: MOHAMMED_ID,
      description: 'API gateway timeout on heavy traffic',
    });
    assert.strictEqual(taskProblem.status, 'OPEN');
    assert.ok(taskProblem.task_id);
    assert.strictEqual(taskProblem.project_id, null);

    // 25. Project Problem
    const projectProblem = await problemService.reportProblem({
      projectId: TEST_PROJECT_ID,
      reportedById: KHALED_ID,
      description: 'Staging environment infrastructure down in AWS eu-west-1',
    });
    assert.strictEqual(projectProblem.status, 'OPEN');
    assert.strictEqual(projectProblem.task_id, null);
    assert.strictEqual(projectProblem.project_id, TEST_PROJECT_ID);

    // 27. Prevent Problem without Task or Project
    await assert.rejects(
      async () => {
        await problemService.reportProblem({
          reportedById: MOHAMMED_ID,
          description: 'Problem with no source',
        });
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.match(err.message, /must be associated with a Task or a Project/i);
        return true;
      }
    );
  });

  // 26 & 28. Resolution Task for Project Problem and Tracking
  it('26 & 28. Create Resolution Task for Project Problem and track link', async () => {
    const projectProblem = await problemService.reportProblem({
      projectId: TEST_PROJECT_ID,
      reportedById: KHALED_ID,
      description: 'SSL certificate expired on project subdomain',
    });

    // Provide mock task creator to problemService during test
    problemService.mockTaskCreator = async (taskData, empId) => {
      return await taskService.createTask(taskData, empId);
    };

    const { problem: updatedProblem, resolutionTask } = await problemService.createResolutionTask(
      projectProblem.id,
      KHALED_ID,
      {
        title: 'Renew and deploy SSL certificate',
        priority: 'URGENT',
        assignment_mode: 'SELF',
      }
    );

    // 28. Verify tracking
    assert.ok(updatedProblem.resolution_task_id);
    const expectedResId = resolutionTask.outer_id || String(resolutionTask.id);
    assert.strictEqual(updatedProblem.resolution_task_id, expectedResId);

    const createdTask = await taskService.getTaskById(resolutionTask.outer_id || resolutionTask.id);
    assert.strictEqual(createdTask.problem_id, projectProblem.outer_id || String(projectProblem.id));
    assert.strictEqual(createdTask.project_id, TEST_PROJECT_ID);
  });
});

