const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Přístup odepřen. Token chybí.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email, isAdmin: decoded.isAdmin };
    next();
  } catch {
    return res.status(401).json({ message: 'Neplatný nebo expirovaný token.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: 'Přístup odepřen. Vyžadována role administrátora.' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
