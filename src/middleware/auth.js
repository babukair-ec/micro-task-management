const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'microservices-shared-task-management-jwt-secret-key-2026';

async function authenticateJwt(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication credentials were not provided' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({ error: 'Invalid Authorization header format. Format: Bearer <token>' });
  }

  const token = parts[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    // Look for employee outer_id:
    // 1. From header or decoded employee_id
    // 2. From EmployeeCache by username or outer_id
    // 3. Fallback to querying employee-service /api/employees/me/
    const headerEmpId = req.headers['x-employee-id'] || req.headers['x-employee-outer-id'];
    let employeeOuterId = decoded.employee_id || null;

    if (!employeeOuterId && headerEmpId) {
      const empByHeader = await prisma.employeeCache.findFirst({
        where: { outer_id: String(headerEmpId) }
      });
      if (empByHeader) {
        employeeOuterId = empByHeader.outer_id;
      } else {
        employeeOuterId = String(headerEmpId);
      }
    }

    if (!employeeOuterId && decoded.username) {
      const empByUsername = await prisma.employeeCache.findFirst({
        where: { username: decoded.username }
      });
      if (empByUsername) {
        employeeOuterId = empByUsername.outer_id;
      }
    }

    if (!employeeOuterId && decoded.user_id) {
      const empByUserId = await prisma.employeeCache.findFirst({
        where: { outer_id: String(decoded.user_id) }
      });
      if (empByUserId) {
        employeeOuterId = empByUserId.outer_id;
      }
    }

    // If still not resolved to an employee outer_id in cache, try fetching from Employee Service
    if (!employeeOuterId) {
      try {
        const empUrl = process.env.EMPLOYEE_SERVICE_URL || 'http://localhost:8002';
        const empRes = await fetch(`${empUrl}/api/employees/me/`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (empRes.ok) {
          const empData = await empRes.json();
          if (empData && empData.outer_id) {
            employeeOuterId = empData.outer_id;
            await prisma.employeeCache.upsert({
              where: { outer_id: empData.outer_id },
              create: {
                outer_id: empData.outer_id,
                username: empData.username,
                full_name: empData.full_name || empData.username,
                email: empData.email || '',
                job_title: empData.job_title || '',
                employee_type: empData.employee_type || 'EMPLOYEE',
                is_active: empData.is_active !== false,
              },
              update: {
                username: empData.username,
                full_name: empData.full_name || empData.username,
                email: empData.email || '',
                job_title: empData.job_title || '',
                employee_type: empData.employee_type || 'EMPLOYEE',
                is_active: empData.is_active !== false,
              }
            });
          }
        }
      } catch (fetchErr) {
        // Fallback silently if employee-service is not reachable
      }
    }

    // Normalize user payload with resolved employeeId (Employee outer_id)
    req.user = {
      userId: decoded.user_id,
      employeeId: employeeOuterId || decoded.employee_id || decoded.user_id,
      username: decoded.username,
      fullName: decoded.full_name || decoded.username,
      email: decoded.email,
      department: decoded.department,
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Given token not valid for any token type', details: err.message });
  }
}

module.exports = {
  authenticateJwt,
};
