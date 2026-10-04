const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'microservices-shared-task-management-jwt-secret-key-2026';

function authenticateJwt(req, res, next) {
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
    
    // Normalize user payload
    req.user = {
      userId: decoded.user_id,
      employeeId: decoded.employee_id || decoded.user_id,
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
