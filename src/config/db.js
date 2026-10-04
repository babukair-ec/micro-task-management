const prisma = require('./prisma');

/**
 * Prisma database module.
 * Raw SQL commands have been completely removed.
 * All schema migrations and table structures are managed declaratively via Prisma (prisma/schema.prisma).
 */
async function seedDefaultEmployees() {
  const employees = [
    { id: 1, username: 'ahmed', full_name: 'Ahmed Al-Mansoor', email: 'ahmed@company.com', department: 'Backend Engineering', job_title: 'Senior Software Engineer' },
    { id: 2, username: 'mohammed', full_name: 'Mohammed Al-Sayed', email: 'mohammed@company.com', department: 'Product Development', job_title: 'Full Stack Developer' },
    { id: 3, username: 'khaled', full_name: 'Khaled Al-Rashid', email: 'khaled@company.com', department: 'DevOps & Reliability', job_title: 'Systems Engineer' },
    { id: 4, username: 'tariq', full_name: 'Tariq Al-Harbi', email: 'tariq@company.com', department: 'Quality Assurance', job_title: 'QA Automation Specialist' },
  ];

  for (const emp of employees) {
    await prisma.employeeCache.upsert({
      where: { id: emp.id },
      create: emp,
      update: emp,
    });
  }
}

module.exports = {
  prisma,
  seedDefaultEmployees,
};
