const { PrismaClient } = require('@prisma/client');

let prisma;

try {
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
  });
} catch (err) {
  console.warn('[Prisma Warning] PrismaClient initialization notice:', err.message);
}

module.exports = prisma;
