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
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
        <style>
          .twitter-blue { color: #1DA1F2; }
          .login-container {
            max-width: 400px;
            margin: 100px auto;
          }
        </style>
      </head>
      <body>
        <div class="login-container">
          <div class="box">
            <h1 class="title has-text-centered twitter-blue">Admin Login</h1>
            ${error ? html`<div class="notification is-danger">Invalid password</div>` : ''}
            <form action="/api/tokens/login" method="post">
              <div class="field">
                <div class="control">
                  <input
                    class="input is-medium"
                    type="password"
                    name="password"
                    placeholder="Admin Password"
                    required
                    autofocus
                  />
                </div>
              </div>
              <div class="field">
                <div class="control">
                  <button type="submit" class="button is-info is-fullwidth is-medium">Login</button>
                </div>
              </div>
            </form>
          </div>
        </div>
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
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
        <style>
          .twitter-blue { color: #1DA1F2; }
          .token-value {
            font-family: monospace;
            word-break: break-all;
          }
        </style>
      </head>
      <body>
        <section class="section">
          <div class="container">
            <div class="level">
              <div class="level-left">
                <div class="level-item">
                  <h1 class="title twitter-blue">Token Management</h1>
                </div>
              </div>
              <div class="level-right">
                <div class="level-item">
                  <a href="/" class="button is-light mr-2">Home</a>
                  <a href="/api/accounts" class="button is-light mr-2">Accounts</a>
                  <a href="/api/tokens/logout" class="button is-danger">Logout</a>
                </div>
              </div>
            </div>
            
            <div class="columns is-desktop">
              <div class="column">
                <div class="box">
                  <h2 class="title is-4 twitter-blue">Create API Token</h2>
                  <form action="/api/tokens/create" method="post">
                    <div class="field">
                      <div class="control">
                        <input
                          class="input"
                          type="text"
                          name="name"
                          placeholder="Token Name (e.g., Personal Use, Testing)"
                          required
                        />
                      </div>
                    </div>
                    <div class="field">
                      <div class="control">
                        <button type="submit" class="button is-info">Create Token</button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>

              <div class="column">
                <div class="box">
                  <h2 class="title is-4 twitter-blue">Manage Tokens</h2>
                  ${tokens.length > 0
                    ? html`
                      <div class="table-container">
                        <table class="table is-fullwidth is-striped is-hoverable">
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
                                      <button type="submit" class="button is-small is-danger">
                                        Delete
                                      </button>
                                    </form>
                                  </td>
                                </tr>
                              `,
                            )}
                          </tbody>
                        </table>
                      </div>
                    `
                    : html`<p class="has-text-centered">No tokens created yet.</p>`}
                </div>
              </div>
            </div>

            <div class="box mt-5">
              <h2 class="title is-4 twitter-blue">API Usage</h2>
              <p>To use the API, include your token in the Authorization header:</p>
              <pre class="has-background-light p-3 mt-2 mb-4"><code>Authorization: Bearer YOUR_TOKEN</code></pre>
              <p class="mb-2">Available endpoints:</p>
              <div class="content">
                <ul>
                  <li><code class="has-background-light">GET /api/tweets/:id</code> - Get a tweet by ID</li>
                  <li><code class="has-background-light">GET /api/scraper</code> - Get scraper status</li>
                  <li><code class="has-background-light">POST /api/accounts/import</code> - Import accounts</li>
                  <li><code class="has-background-light">POST /api/accounts/login</code> - Login to an account</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
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
