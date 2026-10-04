const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = require('./config/prisma');
const { startRabbitMQConsumer } = require('./messaging/rabbitmq');
const taskRoutes = require('./routes/task_routes');
const taskRequestRoutes = require('./routes/task_request_routes');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'task-service', port: PORT, timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/tasks', taskRoutes);
app.use('/api/task-requests', taskRequestRoutes);

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
});

async function startServer() {
  try {
    // Connect to database via Prisma
    await prisma.$connect();
    console.log('[Task Service] Connected to PostgreSQL via Prisma ORM.');

    // Start RabbitMQ consumer
    startRabbitMQConsumer().catch((err) => {
      console.warn('[RabbitMQ] Startup note:', err.message);
    });

    // Start Express app
    app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(`  Task Management Microservice running on :${PORT}`);
      console.log(`  Base URL: http://localhost:${PORT}`);
      console.log(`===============================================`);
    });
  } catch (err) {
    console.error('Failed to start task service:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
