import { Hono } from 'hono';
import { html } from 'hono/html';
import { setCookie, getCookie } from 'hono/cookie';
import {
  accountManager,
  parseAccountList,
  defaultAccountListFormat,
  type AccountInfo,
} from '../account-manager.js';

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

  const authToken = getCookie(c, 'admin_auth');
  if (!authToken || authToken !== adminPassword) {
    return c.redirect('/api/tokens/login');
  }

  await next();
};

export const router = new Hono();

router.get('/', verifyAdmin, (c) => {
  const accounts = accountManager.getAllAccounts();

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Account Management</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
        <style>
          .twitter-blue { color: #1DA1F2; }
          .status-working { color: #23d160; font-weight: bold; }
          .status-failed { color: #ff3860; font-weight: bold; }
          .status-unknown { color: #ffdd57; font-weight: bold; }
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
                  <a href="/api/tokens" class="button is-light mr-2">Tokens</a>
                  <a href="/api/tokens/logout" class="button is-danger">Logout</a>
                </div>
              </div>
            </div>

            <div class="columns is-desktop">
              <div class="column">
                <div class="box">
                  <h2 class="title is-4 twitter-blue">Import Accounts</h2>
                  <form action="/api/accounts/import-bulk" method="post">
                    <div class="field">
                      <label class="label" for="format">Format:</label>
                      <div class="control">
                        <div class="select is-fullwidth">
                          <select name="format" id="format">
                            <option value="${defaultAccountListFormat}" selected>
                              ${defaultAccountListFormat}
                            </option>
                            <option value="username:password:email:emailPassword:authToken:ANY">
                              username:password:email:emailPassword:authToken:ANY
                            </option>
                            <option value="username:password:email:emailPassword:ANY:ANY">
                              username:password:email:emailPassword:ANY:ANY
                            </option>
                          </select>
                        </div>
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
                        <button type="submit" class="button is-info is-fullwidth">Import Accounts</button>
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
                        <table class="table is-fullwidth is-striped is-hoverable">
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
                                    ${account.failedLogin
                                      ? 'Login Failed'
                                      : account.tokenState.toUpperCase()}
                                  </td>
                                  <td>
                                    ${account.lastUsed
                                      ? new Date(account.lastUsed).toLocaleString()
                                      : 'Never'}
                                  </td>
                                  <td>
                                    <form
                                      action="/api/accounts/delete/${encodeURIComponent(
                                        account.username,
                                      )}"
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
                    : html`<p class="has-text-centered">No accounts available.</p>`}
                </div>
              </div>
            </div>

            <div class="box mt-5">
              <h2 class="title is-4 twitter-blue">API Endpoints</h2>
              <div class="content">
                <ul>
                  <li>
                    <code class="has-background-light">POST /api/accounts/import</code> - Import accounts via API (JSON)
                  </li>
                  <li>
                    <code class="has-background-light">POST /api/accounts/login</code> - Force login with a different account
                  </li>
                </ul>

                <h4 class="title is-5 mt-4">Example API Usage</h4>
                <pre class="has-background-light p-3">
// Import accounts via API
fetch('/api/accounts/import', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    accounts: [
      {
        username: "example_user",
        password: "password123",
        email: "example@email.com",
        emailPassword: "email_password",
        authToken: "auth_token_value",
        twoFactorSecret: "2fa_secret"
      }
    ]
  })
});
                </pre>
              </div>
            </div>
          </div>
        </section>
      </body>
    </html>
  `);
});

// Import accounts from form
router.post('/import-bulk', verifyAdmin, async (c) => {
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
      return c.redirect('/api/accounts?error=No_valid_accounts_found');
    }

    accountManager.addAccounts(accountsList);

    // Redirect back to the account management page
    return c.redirect(
      '/api/accounts?success=Imported_' + accountsList.length + '_accounts',
    );
  } catch (error) {
    console.error('Error importing accounts:', error);
    return c.redirect(
      '/api/accounts?error=' + encodeURIComponent((error as Error).message),
    );
  }
});

// Delete account
router.post('/delete/:username', verifyAdmin, async (c) => {
  try {
    const username = decodeURIComponent(c.req.param('username'));
    const deleted = accountManager.deleteAccount(username);

    if (!deleted) {
      return c.redirect('/api/accounts?error=Account_not_found');
    }

    return c.redirect('/api/accounts?success=Account_deleted');
  } catch (error) {
    console.error('Error deleting account:', error);
    return c.redirect(
      '/api/accounts?error=' + encodeURIComponent((error as Error).message),
    );
  }
});

// Import accounts (API endpoint)
router.post('/import', verifyAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { accounts } = body as { accounts: AccountInfo[] };

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return c.json({ error: 'A valid array of accounts is required' }, 400);
    }

    accountManager.addAccounts(accounts);

    return c.json({
      message: 'Accounts imported successfully',
      count: accounts.length,
    });
  } catch (error) {
    console.error('Error importing accounts:', error);
    return c.json({ error: 'Failed to import accounts' }, 500);
  }
});

// Login (API endpoint)
router.post('/login', verifyAdmin, async (c) => {
  try {
    if (!accountManager.hasAccountsAvailable) {
      return c.json({ error: 'No accounts available' }, 400);
    }

    // Force logout and re-login with a different account
    await accountManager.logIn();

    return c.json({
      success: true,
      loggedIn: accountManager.isLoggedIn(),
      username: accountManager.getCurrentUsername(),
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json(
      {
        error: 'Failed to log in',
        message: (error as Error).message,
      },
      500,
    );
  }
});
