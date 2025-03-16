import { Hono } from 'hono';
import { html } from 'hono/html';
import { setCookie, getCookie } from 'hono/cookie';
import { tokenManager } from '../token-manager.js';
import { verifyToken } from './auth.js';

export const router = new Hono();

router.get('/me', verifyToken, (c) => {
  return c.json({
    success: true,
  });
});
