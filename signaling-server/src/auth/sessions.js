/**
 * sessions.js — bearer-token auth for HTTP + Socket.IO.
 *
 * Reuses the existing `users.token` column (issued by users.register).
 * Express:    app.use(authMiddleware(users))
 *             route handlers can read req.user
 * Socket.IO:  io.use(socketAuth(users))   -> socket.data.user
 *
 * Tokens come from `Authorization: Bearer <token>` header, or `?token=` query,
 * or socket `auth.token`.
 */
export function authMiddleware(users, { required = false } = {}) {
  return async function (req, res, next) {
    const token = extractHttpToken(req);
    if (!token) {
      if (required) return res.status(401).json({ error: 'unauthenticated' });
      return next();
    }
    try {
      const u = await users.loginByToken(token);
      if (!u) {
        if (required) return res.status(401).json({ error: 'invalid_token' });
        return next();
      }
      req.user = u;
      next();
    } catch (e) {
      if (required) return res.status(500).json({ error: 'auth_failed' });
      next();
    }
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

export function socketAuth(users) {
  return async function (socket, next) {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      extractHeader(socket.handshake.headers?.authorization);
    if (!token) return next(new Error('unauthenticated'));
    try {
      const u = await users.loginByToken(token);
      if (!u) return next(new Error('invalid_token'));
      socket.data.user = u;
      next();
    } catch {
      next(new Error('auth_failed'));
    }
  };
}

function extractHttpToken(req) {
  const h = req.headers?.authorization;
  const fromHeader = extractHeader(h);
  if (fromHeader) return fromHeader;
  return req.query?.token || null;
}
function extractHeader(value) {
  if (!value || typeof value !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(value);
  return m ? m[1].trim() : null;
}
