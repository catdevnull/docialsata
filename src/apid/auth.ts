import { tokenManager } from '../token-manager.js';

export const verifyToken = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized - Missing or invalid token' }, 401);
  }

  const token = authHeader.split(' ')[1];
  if (!tokenManager.validateToken(token)) {
    return c.json({ error: 'Unauthorized - Invalid token' }, 401);
  }

  c.set('token', token);

  await next();
};
