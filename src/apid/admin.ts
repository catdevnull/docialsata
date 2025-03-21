import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { tokenManager } from '../token-manager';
import {
  accountManager,
  defaultAccountListFormat,
  parseAccountList,
} from '../account-manager';

export const router = new Hono();

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
    return c.redirect('/admin/login');
  }

  await next();
};

router.get('/login', async (c) => {
  const error = c.req.query('error');

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Admin Login</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css"
        />
        <style>
          .twitter-blue {
            color: #1da1f2;
          }
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
            ${error
              ? html`<div class="notification is-danger">Invalid password</div>`
              : ''}
            <form action="/admin/login" method="post">
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
                  <button
                    type="submit"
                    class="button is-info is-fullwidth is-medium"
                  >
                    Login
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </body>
    </html>
  `);
});

router.post('/login', async (c) => {
  const { password } = (await c.req.parseBody()) as { password?: string };
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || password !== adminPassword) {
    return c.redirect('/admin/login?error=1');
  }

  setCookie(c, 'admin_auth', adminPassword, {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
    secure: process.env.NODE_ENV === 'production',
  });

  return c.redirect('/admin');
});

router.get('/logout', async (c) => {
  setCookie(c, 'admin_auth', '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });

  return c.redirect('/admin/login');
});

router.get('/', verifyAdmin, (c) => {
  const tokens = tokenManager.getAllTokens();

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Token Management</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css"
        />
        <style>
          .twitter-blue {
            color: #1da1f2;
          }
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
                  <a href="/admin/accounts" class="button is-light mr-2"
                    >Accounts</a
                  >
                  <a href="/admin/logout" class="button is-danger">Logout</a>
                </div>
              </div>
            </div>

            <div class="columns is-desktop">
              <div class="column">
                <div class="box">
                  <h2 class="title is-4 twitter-blue">Create API Token</h2>
                  <form action="/admin/create" method="post">
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
                        <button type="submit" class="button is-info">
                          Create Token
                        </button>
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
                          <table
                            class="table is-fullwidth is-striped is-hoverable"
                          >
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
                                      ${new Date(
                                        token.createdAt,
                                      ).toLocaleString()}
                                    </td>
                                    <td>
                                      ${token.lastUsed
                                        ? new Date(
                                            token.lastUsed,
                                          ).toLocaleString()
                                        : 'Never'}
                                    </td>
                                    <td>
                                      <form
                                        action="/admin/delete/${token.id}"
                                        method="post"
                                      >
                                        <button
                                          type="submit"
                                          class="button is-small is-danger"
                                        >
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
                    : html`<p class="has-text-centered">
                        No tokens created yet.
                      </p>`}
                </div>
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
    return c.redirect('/admin');
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
    return c.redirect('/admin');
  } catch (error) {
    console.error('Error deleting token:', error);
    return c.json({ error: 'Failed to delete token' }, 500);
  }
});

router.get('/accounts', verifyAdmin, (c) => {
  const accounts = accountManager.getAllAccounts();

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Account Management</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css"
        />
        <style>
          .twitter-blue {
            color: #1da1f2;
          }
          .status-working {
            color: #23d160;
            font-weight: bold;
          }
          .status-failed {
            color: #ff3860;
            font-weight: bold;
          }
          .status-unknown {
            color: #ffdd57;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <section class="section">
          <div class="container">
            <div class="level">
              <div class="level-left">
                <div class="level-item">
                  <h1 class="title twitter-blue">Account Management</h1>
                </div>
              </div>
              <div class="level-right">
                <div class="level-item">
                  <a href="/" class="button is-light mr-2">Home</a>
                  <a href="/admin" class="button is-light mr-2">Tokens</a>
                  <a href="/admin/logout" class="button is-danger">Logout</a>
                </div>
              </div>
            </div>

            <div class="columns is-desktop">
              <div class="column">
                <div class="box">
                  <h2 class="title is-4 twitter-blue">Import Accounts</h2>
                  <form action="/admin/accounts/import-bulk" method="post">
                    <div class="field" id="customFormatField">
                      <label class="label" for="customFormat"
                        >Custom Format:</label
                      >
                      <div class="control">
                        <input
                          class="input"
                          type="text"
                          id="format"
                          name="format"
                          placeholder="username:password:email:..."
                          value="username:password:email:emailPassword:authToken:twoFactorSecret"
                        />
                        <p class="help">
                          Use field names: username, password, email,
                          emailPassword, authToken, twoFactorSecret. Use ANY for
                          fields to ignore.
                        </p>
                      </div>
                    </div>
                    <div class="field">
                      <div class="control">
                        <textarea
                          class="textarea"
                          name="accounts"
                          placeholder="Paste account list here, one account per line"
                          rows="10"
                          required
                        ></textarea>
                      </div>
                    </div>
                    <div class="field">
                      <div class="control">
                        <button
                          type="submit"
                          class="button is-info is-fullwidth"
                        >
                          Import Accounts
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>

              <div class="column">
                <div class="box">
                  <h2 class="title is-4 twitter-blue">Account Status</h2>
                  ${accounts.length > 0
                    ? html`
                        <div class="table-container">
                          <table
                            class="table is-fullwidth is-striped is-hoverable"
                          >
                            <thead>
                              <tr>
                                <th>Username</th>
                                <th>Status</th>
                                <th>Last Used</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${accounts.map(
                                (account) => html`
                                  <tr>
                                    <td>${account.username}</td>
                                    <td class="status-${account.tokenState}">
                                      ${
                                        account.failedLogin
                                          ? 'Login Failed'
                                          : account.tokenState.toUpperCase()
                                      }
                                      ${
                                        account.rateLimitedUntil
                                          ? ` (Rate Limited for ${Math.round(
                                              (account.rateLimitedUntil -
                                                Date.now()) /
                                                1000,
                                            )}s)`
                                          : ''
                                      }
                                    </td>
                                    </td>
                                    <td>
                                      ${
                                        account.lastUsed
                                          ? new Date(
                                              account.lastUsed,
                                            ).toLocaleString()
                                          : 'Never'
                                      }
                                    </td>
                                    <td>
                                      <form
                                        action="/admin/accounts/delete/${encodeURIComponent(
                                          account.username,
                                        )}"
                                        method="post"
                                      >
                                        <button
                                          type="submit"
                                          class="button is-small is-danger"
                                        >
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
                    : html`<p class="has-text-centered">
                        No accounts available.
                      </p>`}
                </div>
              </div>
            </div>
          </div>
        </section>
      </body>
    </html>
  `);
});

// Import accounts from form
router.post('/accounts/import-bulk', verifyAdmin, async (c) => {
  try {
    const { accounts, format } = (await c.req.parseBody()) as {
      accounts?: string;
      format?: string;
    };

    if (!accounts) {
      return c.json({ error: 'Accounts data is required' }, 400);
    }

    const accountsList = parseAccountList(
      accounts,
      format || defaultAccountListFormat,
    );

    if (accountsList.length === 0) {
      return c.redirect('/admin/accounts?error=No_valid_accounts_found');
    }

    accountManager.addAccounts(accountsList);

    // Redirect back to the account management page
    return c.redirect(
      '/admin/accounts?success=Imported_' + accountsList.length + '_accounts',
    );
  } catch (error) {
    console.error('Error importing accounts:', error);
    return c.redirect(
      '/admin/accounts?error=' + encodeURIComponent((error as Error).message),
    );
  }
});

// Delete account
router.post('/accounts/delete/:username', verifyAdmin, async (c) => {
  try {
    const username = decodeURIComponent(c.req.param('username'));
    const deleted = accountManager.deleteAccount(username);

    if (!deleted) {
      return c.redirect('/admin/accounts?error=Account_not_found');
    }

    return c.redirect('/admin/accounts?success=Account_deleted');
  } catch (error) {
    console.error('Error deleting account:', error);
    return c.redirect(
      '/admin/accounts?error=' + encodeURIComponent((error as Error).message),
    );
  }
});
