const amqp = require('amqplib');
const prisma = require('../config/prisma');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/';
const EXCHANGE_NAME = 'task_management_events';
const QUEUE_NAME = 'task_service_events_queue';

let channel = null;
let connection = null;

async function startRabbitMQConsumer() {
  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
    const q = await channel.assertQueue(QUEUE_NAME, { durable: true });

    // Bind to employee and problem events
    await channel.bindQueue(q.queue, EXCHANGE_NAME, 'employee.*');
    await channel.bindQueue(q.queue, EXCHANGE_NAME, 'problem.*');

    console.log(`[RabbitMQ Task Service] Subscribed to queue: ${q.queue}`);

    channel.consume(q.queue, async (msg) => {
      if (msg !== null) {
        try {
          const content = JSON.parse(msg.content.toString());
          const { event, data } = content;

          if (event === 'employee.created' || event === 'employee.updated') {
            await handleEmployeeSync(data);
          } else if (event === 'problem.reported') {
            // Task becomes BLOCKED
            await prisma.task.update({
              where: { id: parseInt(data.task_id, 10) },
              data: { status: 'BLOCKED' },
            });
            console.log(`[RabbitMQ] Task #${data.task_id} transitioned to BLOCKED due to problem report`);
          } else if (event === 'problem.resolved' || event === 'problem.cancelled') {
            // Task returns to IN_PROGRESS without changing task owner
            await prisma.task.updateMany({
              where: {
                id: parseInt(data.task_id, 10),
                status: 'BLOCKED',
              },
              data: { status: 'IN_PROGRESS' },
            });
            console.log(`[RabbitMQ] Task #${data.task_id} restored to IN_PROGRESS`);
          }

          channel.ack(msg);
        } catch (err) {
          console.error('[RabbitMQ Task Service Error]', err.message);
          channel.nack(msg, false, false);
        }
      }
    });

    connection.on('error', (err) => console.warn('[RabbitMQ Task Service] Connection error:', err.message));
    connection.on('close', () => {
      console.warn('[RabbitMQ Task Service] Connection closed. Retrying in 10s...');
      setTimeout(startRabbitMQConsumer, 10000);
    });
  } catch (err) {
    console.warn('[RabbitMQ Task Service] Offline or unreachable, retrying in 15s:', err.message);
    setTimeout(startRabbitMQConsumer, 15000);
  }
}

async function handleEmployeeSync(employeeData) {
  if (!employeeData || !employeeData.id) return;
  try {
    await prisma.employeeCache.upsert({
      where: { id: parseInt(employeeData.id, 10) },
      create: {
        id: parseInt(employeeData.id, 10),
        username: employeeData.username,
        full_name: employeeData.full_name || employeeData.username,
        email: employeeData.email || '',
        department: employeeData.department || '',
        job_title: employeeData.job_title || '',
        is_active: employeeData.is_active !== false,
      },
      update: {
        username: employeeData.username,
        full_name: employeeData.full_name || employeeData.username,
        email: employeeData.email || '',
        department: employeeData.department || '',
        job_title: employeeData.job_title || '',
        is_active: employeeData.is_active !== false,
      }
    });
  } catch (err) {
    console.error('[Employee Cache Sync Error]', err.message);
  }
}

module.exports = {
  startRabbitMQConsumer,
  handleEmployeeSync,
};
