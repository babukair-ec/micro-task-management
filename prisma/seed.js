const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const EMPLOYEES = [
  { id: '11111111-1111-4111-8111-111111111111', username: 'ahmed', full_name: 'Ahmed Al-Mansoor', email: 'ahmed@company.com', job_title: 'Lead Architect & Engineering Director', employee_type: 'EMPLOYEE' },
  { id: '22222222-2222-4222-8222-222222222222', username: 'mohammed', full_name: 'Mohammed Al-Sayed', email: 'mohammed@company.com', job_title: 'Senior Full Stack Developer', employee_type: 'EMPLOYEE' },
  { id: '33333333-3333-4333-8333-333333333333', username: 'khaled', full_name: 'Khaled Al-Rashid', email: 'khaled@company.com', job_title: 'DevOps & Infrastructure Lead', employee_type: 'EMPLOYEE' },
  { id: '44444444-4444-4444-8444-444444444444', username: 'tariq', full_name: 'Tariq Al-Harbi', email: 'tariq@company.com', job_title: 'QA Automation Specialist', employee_type: 'TESTER' },
  { id: '55555555-5555-4555-8555-555555555555', username: 'sarah', full_name: 'Sarah Al-Otaibi', email: 'sarah@company.com', job_title: 'Product Manager & UX Lead', employee_type: 'EMPLOYEE' },
  { id: '66666666-6666-4666-8666-666666666666', username: 'fahad', full_name: 'Fahad Al-Ghamdi', email: 'fahad@company.com', job_title: 'Junior Frontend Developer', employee_type: 'EMPLOYEE' },
];

// Fixed UUIDs for Tasks so Problem Service can reliably link problems to blocked/completed tasks
const TASK_IDS = {
  // Draft
  DRAFT_1: 'a1000000-0000-4000-8000-000000000001',
  DRAFT_2: 'a1000000-0000-4000-8000-000000000002',
  // Available
  AVAIL_1: 'a2000000-0000-4000-8000-000000000001',
  AVAIL_2: 'a2000000-0000-4000-8000-000000000002',
  AVAIL_3: 'a2000000-0000-4000-8000-000000000003',
  // Assigned
  ASSIGN_1: 'a3000000-0000-4000-8000-000000000001',
  ASSIGN_2: 'a3000000-0000-4000-8000-000000000002',
  ASSIGN_3: 'a3000000-0000-4000-8000-000000000003',
  // In Progress
  INPROG_1: 'a4000000-0000-4000-8000-000000000001',
  INPROG_2: 'a4000000-0000-4000-8000-000000000002',
  INPROG_3: 'a4000000-0000-4000-8000-000000000003',
  // Blocked (Linked to Problems)
  BLOCK_1: 'a5000000-0000-4000-8000-000000000001',
  BLOCK_2: 'a5000000-0000-4000-8000-000000000002',
  BLOCK_3: 'a5000000-0000-4000-8000-000000000003',
  // Completed (Some previously had resolved problems)
  COMPL_1: 'a6000000-0000-4000-8000-000000000001',
  COMPL_2: 'a6000000-0000-4000-8000-000000000002',
  COMPL_3: 'a6000000-0000-4000-8000-000000000003',
  COMPL_4: 'a6000000-0000-4000-8000-000000000004',
  // Cancelled
  CANCEL_1: 'a7000000-0000-4000-8000-000000000001',
  CANCEL_2: 'a7000000-0000-4000-8000-000000000002',
};

async function seed() {
  console.log('\n=======================================================');
  console.log(' [3/4] Seeding Task Service (Tasks, Requests, Claims)...');
  console.log('=======================================================');

  // 1. Sync Employee Cache
  console.log(' -> Syncing EmployeeCache...');
  for (const emp of EMPLOYEES) {
    const { id, ...rest } = emp;
    await prisma.employeeCache.upsert({
      where: { outer_id: id },
      create: { outer_id: id, ...rest },
      update: rest,
    });
  }

  // 2. Tasks with all kinds of status
  console.log(' -> Seeding Tasks across all statuses...');
  const tasksData = [
    // --- DRAFT ---
    {
      outer_id: TASK_IDS.DRAFT_1,
      title: 'Draft GraphQL Gateway Architecture Schema',
      description: 'Prepare initial schema definition and federated subgraph boundaries for v3 API.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: null,
      status: 'DRAFT',
      priority: 'MEDIUM',
      assignment_mode: 'DIRECT',
      due_date: new Date(Date.now() + 14 * 86400000),
    },
    {
      outer_id: TASK_IDS.DRAFT_2,
      title: 'Benchmark Vector Search & Retrieval Latency',
      description: 'Draft performance criteria for pgvector vs dedicated vector index cluster.',
      creator_id: EMPLOYEES[2].id, // Khaled
      current_owner_id: null,
      status: 'DRAFT',
      priority: 'LOW',
      assignment_mode: 'SELF',
      due_date: new Date(Date.now() + 20 * 86400000),
    },

    // --- AVAILABLE (Claimable by eligible team members) ---
    {
      outer_id: TASK_IDS.AVAIL_1,
      title: 'Implement Distributed JWT Token Blacklisting Service',
      description: 'Create Redis-backed distributed token revocation registry to immediately handle logout across all microservices.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: null,
      status: 'AVAILABLE',
      priority: 'HIGH',
      assignment_mode: 'SELF',
      due_date: new Date(Date.now() + 5 * 86400000),
    },
    {
      outer_id: TASK_IDS.AVAIL_2,
      title: 'Refactor Responsive Layout for RTL Arabic Typography',
      description: 'Review right-to-left flexbox directions and Cairo font typography hierarchy on mobile screens.',
      creator_id: EMPLOYEES[4].id, // Sarah
      current_owner_id: null,
      status: 'AVAILABLE',
      priority: 'MEDIUM',
      assignment_mode: 'SELF',
      due_date: new Date(Date.now() + 7 * 86400000),
    },
    {
      outer_id: TASK_IDS.AVAIL_3,
      title: 'Configure Centralized Winston Structured JSON Log Streams',
      description: 'Standardize correlating request IDs and distributed trace headers across all 4 microservice log outputs.',
      creator_id: EMPLOYEES[2].id, // Khaled
      current_owner_id: null,
      status: 'AVAILABLE',
      priority: 'LOW',
      assignment_mode: 'SELF',
      due_date: new Date(Date.now() + 10 * 86400000),
    },

    // --- ASSIGNED ---
    {
      outer_id: TASK_IDS.ASSIGN_1,
      title: 'Build Department-Level Permission Assignment Guard',
      description: 'Implement backend validation ensuring only department managers can approve subordinate project allocations.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: EMPLOYEES[1].id, // Mohammed
      status: 'ASSIGNED',
      priority: 'URGENT',
      assignment_mode: 'DIRECT',
      due_date: new Date(Date.now() + 3 * 86400000),
    },
    {
      outer_id: TASK_IDS.ASSIGN_2,
      title: 'Automate Docker Multi-Stage Builds for Node Microservices',
      description: 'Optimize Docker container images using distroless Node runtime to shrink production image size under 120MB.',
      creator_id: EMPLOYEES[2].id, // Khaled
      current_owner_id: EMPLOYEES[2].id, // Khaled
      status: 'ASSIGNED',
      priority: 'MEDIUM',
      assignment_mode: 'SELF',
      due_date: new Date(Date.now() + 8 * 86400000),
    },
    {
      outer_id: TASK_IDS.ASSIGN_3,
      title: 'Create Interactive Hierarchy Tree Component in Vue 3',
      description: 'Render organization hierarchy tree with collapsible branches and manager assignment badges.',
      creator_id: EMPLOYEES[4].id, // Sarah
      current_owner_id: EMPLOYEES[5].id, // Fahad
      status: 'ASSIGNED',
      priority: 'HIGH',
      assignment_mode: 'DIRECT',
      due_date: new Date(Date.now() + 6 * 86400000),
    },

    // --- IN_PROGRESS ---
    {
      outer_id: TASK_IDS.INPROG_1,
      title: 'Integrate Multi-Factor Authentication (MFA) via TOTP',
      description: 'Add QR-code secret provisioning, RFC 6238 TOTP verification, and emergency recovery codes to User Service.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: EMPLOYEES[1].id, // Mohammed
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignment_mode: 'DIRECT',
      started_at: new Date(Date.now() - 2 * 86400000),
      due_date: new Date(Date.now() + 4 * 86400000),
    },
    {
      outer_id: TASK_IDS.INPROG_2,
      title: 'Configure RabbitMQ Dead-Letter Exchange (DLX) & Retry Policy',
      description: 'Setup resilient message queues with exponential backoff retry and poison message dead-letter quarantine routing.',
      creator_id: EMPLOYEES[2].id, // Khaled
      current_owner_id: EMPLOYEES[2].id, // Khaled
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      assignment_mode: 'SELF',
      started_at: new Date(Date.now() - 1 * 86400000),
      due_date: new Date(Date.now() + 3 * 86400000),
    },
    {
      outer_id: TASK_IDS.INPROG_3,
      title: 'Implement Dark Mode Theme Tokens in CSS Design System',
      description: 'Complete HSL tailored color palette variables and theme toggle switch with persistent local preference caching.',
      creator_id: EMPLOYEES[4].id, // Sarah
      current_owner_id: EMPLOYEES[5].id, // Fahad
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      assignment_mode: 'DIRECT',
      started_at: new Date(Date.now() - 3 * 86400000),
      due_date: new Date(Date.now() + 2 * 86400000),
    },

    // --- BLOCKED (Connected to Problems in Problem Service) ---
    {
      outer_id: TASK_IDS.BLOCK_1,
      title: 'Migrate Redis Cluster to Version 7 with TLS Encryption',
      description: 'Upgrade high-availability Redis Sentinel nodes to v7. Blocked due to Sentinel quorum handshake timeout across replica subnets.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: EMPLOYEES[2].id, // Khaled
      status: 'BLOCKED',
      priority: 'URGENT',
      assignment_mode: 'DIRECT',
      started_at: new Date(Date.now() - 4 * 86400000),
      due_date: new Date(Date.now() + 1 * 86400000),
    },
    {
      outer_id: TASK_IDS.BLOCK_2,
      title: 'Integrate Stripe Payment Gateway Webhook Handling',
      description: 'Process asynchronous charge events and recurring billing invoices. Blocked by intermittent HMAC signature verification failure.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: EMPLOYEES[1].id, // Mohammed
      status: 'BLOCKED',
      priority: 'HIGH',
      assignment_mode: 'DIRECT',
      started_at: new Date(Date.now() - 5 * 86400000),
      due_date: new Date(Date.now() + 2 * 86400000),
    },
    {
      outer_id: TASK_IDS.BLOCK_3,
      title: 'Automated End-to-End Cypress Cross-Browser Test Suite',
      description: 'Run continuous regression suite in GitHub Actions. Blocked due to headless Chrome memory leak during token hydration.',
      creator_id: EMPLOYEES[1].id, // Mohammed
      current_owner_id: EMPLOYEES[3].id, // Tariq
      status: 'BLOCKED',
      priority: 'MEDIUM',
      assignment_mode: 'DIRECT',
      started_at: new Date(Date.now() - 6 * 86400000),
      due_date: new Date(Date.now() + 1 * 86400000),
    },

    // --- COMPLETED ---
    {
      outer_id: TASK_IDS.COMPL_1,
      title: 'Setup PostgreSQL Connection Pooling with PgBouncer',
      description: 'Implemented transaction-mode connection pooling to handle peak concurrency spikes without exhausting database worker threads.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: EMPLOYEES[2].id, // Khaled
      status: 'COMPLETED',
      priority: 'HIGH',
      assignment_mode: 'DIRECT',
      started_at: new Date(Date.now() - 12 * 86400000),
      completed_at: new Date(Date.now() - 7 * 86400000),
      due_date: new Date(Date.now() - 6 * 86400000),
    },
    {
      outer_id: TASK_IDS.COMPL_2,
      title: 'Implement Arabic & English Bi-Directional Localization',
      description: 'Configured GNU gettext translations in Django and Vue i18n JSON locales with dynamic RTL HTML layout switching.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: EMPLOYEES[1].id, // Mohammed
      status: 'COMPLETED',
      priority: 'MEDIUM',
      assignment_mode: 'DIRECT',
      started_at: new Date(Date.now() - 8 * 86400000),
      completed_at: new Date(Date.now() - 3 * 86400000),
      due_date: new Date(Date.now() - 2 * 86400000),
    },
    {
      outer_id: TASK_IDS.COMPL_3,
      title: 'Setup Cross-Service AMQP Event Bus Broker Connection',
      description: 'Configured robust RabbitMQ client topology with automated exchange declaration and topic-based message bindings.',
      creator_id: EMPLOYEES[2].id, // Khaled
      current_owner_id: EMPLOYEES[0].id, // Ahmed
      status: 'COMPLETED',
      priority: 'URGENT',
      assignment_mode: 'DIRECT',
      started_at: new Date(Date.now() - 15 * 86400000),
      completed_at: new Date(Date.now() - 11 * 86400000),
      due_date: new Date(Date.now() - 10 * 86400000),
    },
    {
      outer_id: TASK_IDS.COMPL_4,
      title: 'Design Scalable Microservices Architecture Plan',
      description: 'Produced complete blueprint for 4 decoupled microservices with database-per-service pattern and event-driven consistency.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: EMPLOYEES[0].id, // Ahmed
      status: 'COMPLETED',
      priority: 'URGENT',
      assignment_mode: 'SELF',
      started_at: new Date(Date.now() - 18 * 86400000),
      completed_at: new Date(Date.now() - 14 * 86400000),
      due_date: new Date(Date.now() - 13 * 86400000),
    },

    // --- CANCELLED ---
    {
      outer_id: TASK_IDS.CANCEL_1,
      title: 'Deprecate Legacy XML Bulk Export Engine',
      description: 'Cancelled in favor of streaming JSON NDJSON API endpoints.',
      creator_id: EMPLOYEES[0].id, // Ahmed
      current_owner_id: null,
      status: 'CANCELLED',
      priority: 'LOW',
      assignment_mode: 'SELF',
      due_date: new Date(Date.now() - 5 * 86400000),
    },
    {
      outer_id: TASK_IDS.CANCEL_2,
      title: 'Prototype Monolithic Database Rollback Strategy',
      description: 'Dropped due to microservice architecture migration making monolithic schema rollback obsolete.',
      creator_id: EMPLOYEES[2].id, // Khaled
      current_owner_id: EMPLOYEES[1].id, // Mohammed
      status: 'CANCELLED',
      priority: 'MEDIUM',
      assignment_mode: 'DIRECT',
      due_date: new Date(Date.now() - 8 * 86400000),
    },
  ];

  for (const t of tasksData) {
    await prisma.task.upsert({
      where: { outer_id: t.outer_id },
      create: t,
      update: t,
    });
    console.log(` -> [Task] [${t.status.padEnd(11)}] ${t.title}`);
  }

  const allTasks = await prisma.task.findMany();
  const taskMap = new Map(allTasks.map(t => [t.outer_id, t.id]));

  // 3. Claim Eligibilities for Available Tasks
  console.log('\n -> Seeding Claim Eligibilities for Available Tasks...');
  const eligibilities = [
    { task_outer_id: TASK_IDS.AVAIL_1, employee_id: EMPLOYEES[1].id }, // Mohammed can claim
    { task_outer_id: TASK_IDS.AVAIL_1, employee_id: EMPLOYEES[2].id }, // Khaled can claim
    { task_outer_id: TASK_IDS.AVAIL_1, employee_id: EMPLOYEES[3].id }, // Tariq can claim
    { task_outer_id: TASK_IDS.AVAIL_2, employee_id: EMPLOYEES[1].id }, // Mohammed can claim
    { task_outer_id: TASK_IDS.AVAIL_2, employee_id: EMPLOYEES[5].id }, // Fahad can claim
    { task_outer_id: TASK_IDS.AVAIL_3, employee_id: EMPLOYEES[1].id }, // Mohammed can claim
    { task_outer_id: TASK_IDS.AVAIL_3, employee_id: EMPLOYEES[3].id }, // Tariq can claim
  ];

  for (const el of eligibilities) {
    const taskId = taskMap.get(el.task_outer_id);
    if (taskId) {
      await prisma.taskClaimEligibility.upsert({
        where: { task_id_employee_id: { task_id: taskId, employee_id: el.employee_id } },
        create: { task_id: taskId, employee_id: el.employee_id },
        update: {},
      });
    }
  }

  // 4. Task Assignment History
  console.log(' -> Seeding Task Assignment Histories...');
  const histories = [
    { task_outer_id: TASK_IDS.INPROG_1, employee_id: EMPLOYEES[1].id, reason: 'Assigned by director for security overhaul' },
    { task_outer_id: TASK_IDS.INPROG_2, employee_id: EMPLOYEES[2].id, reason: 'Self-assigned from available task pool' },
    { task_outer_id: TASK_IDS.INPROG_3, employee_id: EMPLOYEES[5].id, reason: 'Assigned by product manager for UI sprint' },
    { task_outer_id: TASK_IDS.BLOCK_1, employee_id: EMPLOYEES[2].id, reason: 'Assigned by director for infrastructure migration' },
    { task_outer_id: TASK_IDS.BLOCK_2, employee_id: EMPLOYEES[1].id, reason: 'Assigned for payment processor rollout' },
    { task_outer_id: TASK_IDS.BLOCK_3, employee_id: EMPLOYEES[3].id, reason: 'Assigned for test coverage milestone' },
    { task_outer_id: TASK_IDS.COMPL_1, employee_id: EMPLOYEES[2].id, reason: 'Assigned for high-load optimization' },
    { task_outer_id: TASK_IDS.COMPL_2, employee_id: EMPLOYEES[1].id, reason: 'Assigned for internationalization release' },
  ];

  for (const h of histories) {
    const taskId = taskMap.get(h.task_outer_id);
    if (taskId) {
      const existing = await prisma.taskAssignmentHistory.findFirst({
        where: { task_id: taskId, employee_id: h.employee_id },
      });
      if (!existing) {
        await prisma.taskAssignmentHistory.create({
          data: { task_id: taskId, employee_id: h.employee_id, reason: h.reason }
        });
      }
    }
  }

  // 5. Many Task Requests with all kinds of status (PENDING, ACCEPTED, REJECTED, CANCELLED)
  console.log('\n -> Seeding Task Requests across all statuses...');
  const requestsData = [
    // PENDING Requests
    {
      task_outer_id: TASK_IDS.INPROG_1,
      requester_id: EMPLOYEES[0].id, // Ahmed asks Mohammed
      requested_employee_id: EMPLOYEES[1].id,
      status: 'PENDING',
    },
    {
      task_outer_id: TASK_IDS.ASSIGN_1,
      requester_id: EMPLOYEES[2].id, // Khaled asks Tariq for assist
      requested_employee_id: EMPLOYEES[3].id,
      status: 'PENDING',
    },
    {
      task_outer_id: TASK_IDS.ASSIGN_2,
      requester_id: EMPLOYEES[1].id, // Mohammed asks Fahad
      requested_employee_id: EMPLOYEES[5].id,
      status: 'PENDING',
    },
    {
      task_outer_id: TASK_IDS.AVAIL_2,
      requester_id: EMPLOYEES[4].id, // Sarah asks Mohammed
      requested_employee_id: EMPLOYEES[1].id,
      status: 'PENDING',
    },
    // ACCEPTED Requests
    {
      task_outer_id: TASK_IDS.BLOCK_1,
      requester_id: EMPLOYEES[0].id, // Ahmed requested Khaled
      requested_employee_id: EMPLOYEES[2].id,
      status: 'ACCEPTED',
      responded_at: new Date(Date.now() - 3 * 86400000),
    },
    {
      task_outer_id: TASK_IDS.BLOCK_3,
      requester_id: EMPLOYEES[1].id, // Mohammed requested Tariq
      requested_employee_id: EMPLOYEES[3].id,
      status: 'ACCEPTED',
      responded_at: new Date(Date.now() - 5 * 86400000),
    },
    // REJECTED Requests
    {
      task_outer_id: TASK_IDS.DRAFT_1,
      requester_id: EMPLOYEES[1].id, // Mohammed asked Khaled
      requested_employee_id: EMPLOYEES[2].id,
      status: 'REJECTED',
      responded_at: new Date(Date.now() - 2 * 86400000),
    },
    {
      task_outer_id: TASK_IDS.AVAIL_3,
      requester_id: EMPLOYEES[0].id, // Ahmed asked Fahad
      requested_employee_id: EMPLOYEES[5].id,
      status: 'REJECTED',
      responded_at: new Date(Date.now() - 1 * 86400000),
    },
    // CANCELLED Requests
    {
      task_outer_id: TASK_IDS.ASSIGN_3,
      requester_id: EMPLOYEES[4].id, // Sarah cancelled request to Tariq
      requested_employee_id: EMPLOYEES[3].id,
      status: 'CANCELLED',
      responded_at: new Date(Date.now() - 1 * 86400000),
    },
  ];

  for (const r of requestsData) {
    const taskId = taskMap.get(r.task_outer_id);
    if (taskId) {
      const existing = await prisma.taskRequest.findFirst({
        where: {
          task_id: taskId,
          requester_id: r.requester_id,
          requested_employee_id: r.requested_employee_id,
        },
      });
      if (!existing) {
        await prisma.taskRequest.create({
          data: {
            task_id: taskId,
            requester_id: r.requester_id,
            requested_employee_id: r.requested_employee_id,
            status: r.status,
            responded_at: r.responded_at || null,
          }
        });
      } else {
        await prisma.taskRequest.update({
          where: { id: existing.id },
          data: { status: r.status, responded_at: r.responded_at || null },
        });
      }
      console.log(` -> [Request] [${r.status.padEnd(9)}] Task ${r.task_outer_id.slice(0, 8)}...`);
    }
  }

  console.log(' -> Task Service seeding successfully completed.\n');
}

seed()
  .catch((e) => {
    console.error('Task Service seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
