const prisma = require('./prisma');

/**
 * Prisma database module.
 * Employee cache with UUID primary keys.
 */
async function seedDefaultEmployees() {
  const employees = [
    { id: '11111111-1111-4111-8111-111111111111', username: 'ahmed', full_name: 'Ahmed Al-Mansoor', email: 'ahmed@company.com', department: 'Backend Engineering', job_title: 'Senior Software Engineer', employee_type: 'EMPLOYEE' },
    { id: '22222222-2222-4222-8222-222222222222', username: 'mohammed', full_name: 'Mohammed Al-Sayed', email: 'mohammed@company.com', department: 'Product Development', job_title: 'Full Stack Developer', employee_type: 'EMPLOYEE' },
    { id: '33333333-3333-4333-8333-333333333333', username: 'khaled', full_name: 'Khaled Al-Rashid', email: 'khaled@company.com', department: 'DevOps & Reliability', job_title: 'Systems Engineer', employee_type: 'EMPLOYEE' },
    { id: '44444444-4444-4444-8444-444444444444', username: 'tariq', full_name: 'Tariq Al-Harbi', email: 'tariq@company.com', department: 'Quality Assurance', job_title: 'QA Automation Specialist', employee_type: 'TESTER' },
  ];

  for (const emp of employees) {
    const { id, ...rest } = emp;
    await prisma.employeeCache.upsert({
      where: { outer_id: id },
      create: { outer_id: id, ...rest },
      update: rest,
    });
  }
}

module.exports = {
  prisma,
  seedDefaultEmployees,
};
