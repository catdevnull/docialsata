import { Hono } from 'hono';
import { html } from 'hono/html';
import { setCookie, getCookie } from 'hono/cookie';
import { tokenManager } from '../token-manager.js';

// Admin authentication middleware
const verifyAdmin = async (c: any, next: any) => {
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return c.html(
      html`
        <html>
          <head>
            <title>Error</title>
          </head>
          <body>
            <h1>Admin Access Not Configured</h1>
            <p>The ADMIN_PASSWORD environment variable has not been set.</p>
          </body>
        </html>
      `,
      500,
    );
  }

  // Check for auth cookie
  const authToken = getCookie(c, 'admin_auth');
  if (!authToken || authToken !== adminPassword) {
    return c.redirect('/api/tokens/login');
  }

  await next();
};

export const router = new Hono();

// Admin login form
router.get('/login', async (c) => {
  const error = c.req.query('error');

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Admin Login</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
              Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue',
              sans-serif;
            max-width: 400px;
            margin: 100px auto;
            padding: 20px;
            color: #333;
            background-color: #f8f9fa;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          }
          h1 {
            color: #1da1f2;
            text-align: center;
          }
          form {
            display: flex;
            flex-direction: column;
            gap: 15px;
          }
          input {
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 16px;
          }
          button {
            background-color: #1da1f2;
            color: white;
            border: none;
            padding: 12px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
          }
          button:hover {
            background-color: #0c85d0;
          }
          .error {
            color: #e74c3c;
            margin-bottom: 15px;
          }
        </style>
      </head>
      <body>
        <h1>Admin Login</h1>
        ${error ? html`<div class="error">Invalid password</div>` : ''}
        <form action="/api/tokens/login" method="post">
          <input
            type="password"
            name="password"
            placeholder="Admin Password"
            required
            autofocus
          />
          <button type="submit">Login</button>
        </form>
      </body>
    </html>
  `);
});

// Process admin login
router.post('/login', async (c) => {
  const { password } = (await c.req.parseBody()) as { password?: string };
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || password !== adminPassword) {
    return c.redirect('/api/tokens/login?error=1');
  }

  // Set auth cookie and redirect to token management
  setCookie(c, 'admin_auth', adminPassword, {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
    secure: process.env.NODE_ENV === 'production',
  });

  return c.redirect('/');
});

// Logout endpoint
router.get('/logout', async (c) => {
  setCookie(c, 'admin_auth', '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });

  return c.redirect('/api/tokens/login');
});

// Main page with token management interface
router.get('/', verifyAdmin, (c) => {
  const tokens = tokenManager.getAllTokens();

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Token Management</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
              Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue',
              sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
          }
          h1,
          h2 {
            color: #1da1f2;
          }
          .container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
          }
          @media (max-width: 768px) {
            .container {
              grid-template-columns: 1fr;
            }
          }
          .card {
            background-color: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          form {
            display: flex;
            flex-direction: column;
            gap: 15px;
          }
          input {
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 16px;
          }
          button {
            background-color: #1da1f2;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
          }
          button:hover {
            background-color: #0c85d0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
          }
          th,
          td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
          }
          th {
            background-color: #f2f2f2;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
          }
          .token-value {
            font-family: monospace;
            word-break: break-all;
          }
          .delete-btn {
            background-color: #e74c3c;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
          }
          .delete-btn:hover {
            background-color: #c0392b;
          }
          .api-info {
            margin-top: 30px;
          }
          code {
            background-color: #f4f4f4;
            padding: 2px 5px;
            border-radius: 3px;
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <h1>Token Management</h1>
        <div style="text-align: right; margin-bottom: 20px;">
          <a
            href="/api/tokens/logout"
            style="color: #e74c3c; text-decoration: none;"
            >Logout</a
          >
        </div>
        <div class="container">
          <div class="card">
            <h2>Create API Token</h2>
            <form action="/api/tokens/create" method="post">
              <input
                type="text"
                name="name"
                placeholder="Token Name (e.g., Personal Use, Testing)"
                required
              />
              <button type="submit">Create Token</button>
            </form>
          </div>

          <div class="card">
            <h2>Manage Tokens</h2>
            ${tokens.length > 0
              ? html`
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Token</th>
                        <th>Created</th>
                        <th>Last Used</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${tokens.map(
                        (token) => html`
                          <tr>
                            <td>${token.name}</td>
                            <td class="token-value">${token.value}</td>
                            <td>
                              ${new Date(token.createdAt).toLocaleString()}
                            </td>
                            <td>
                              ${token.lastUsed
                                ? new Date(token.lastUsed).toLocaleString()
                                : 'Never'}
                            </td>
                            <td>
                              <form
                                action="/api/tokens/delete/${token.id}"
                                method="post"
                              >
                                <button type="submit" class="delete-btn">
                                  Delete
                                </button>
                              </form>
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                `
              : html`<p>No tokens created yet.</p>`}
          </div>
        </div>

        <div class="api-info">
          <h2>API Usage</h2>
          <p>To use the API, include your token in the Authorization header:</p>
          <code>Authorization: Bearer YOUR_TOKEN</code>
          <p>Available endpoints:</p>
          <ul>
            <li><code>GET /api/tweets/:id</code> - Get a tweet by ID</li>
            <li><code>GET /api/scraper</code> - Get scraper status</li>
            <li><code>POST /api/accounts/import</code> - Import accounts</li>
            <li><code>POST /api/accounts/login</code> - Login to an account</li>
          </ul>
        </div>
      </body>
    </html>
  `);
});

// Create new token
router.post('/create', verifyAdmin, async (c) => {
  try {
    const { name } = (await c.req.parseBody()) as { name?: string };

    if (!name) {
      return c.json({ error: 'Token name is required' }, 400);
    }

    const token = tokenManager.createToken(name);

    // Redirect back to the main page
    return c.redirect('/api/tokens');
  } catch (error) {
    console.error('Error creating token:', error);
    return c.json({ error: 'Failed to create token' }, 500);
  }
});

// Delete token
router.post('/delete/:id', verifyAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const deleted = tokenManager.deleteToken(id);

    if (!deleted) {
      return c.json({ error: 'Token not found' }, 404);
    }

    // Redirect back to the main page
    return c.redirect('/api/tokens');
  } catch (error) {
    console.error('Error deleting token:', error);
    return c.json({ error: 'Failed to delete token' }, 500);
  }
});
