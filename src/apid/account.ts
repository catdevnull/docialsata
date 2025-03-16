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
          input,
          textarea,
          select {
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 16px;
          }
          textarea {
            min-height: 200px;
            font-family: monospace;
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
          pre {
            background-color: #f4f4f4;
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
          }
          .status-working {
            color: #27ae60;
            font-weight: bold;
          }
          .status-failed {
            color: #e74c3c;
            font-weight: bold;
          }
          .status-unknown {
            color: #f39c12;
            font-weight: bold;
          }
          .nav-links {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
          }
          .nav-links a {
            color: #1da1f2;
            text-decoration: none;
          }
          .nav-links a:hover {
            text-decoration: underline;
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
        </style>
      </head>
      <body>
        <div class="nav-links">
          <h1>Account Management</h1>
          <div>
            <a href="/api/tokens">Token Management</a> |
            <a href="/api/tokens/logout" style="color: #e74c3c;">Logout</a>
          </div>
        </div>

        <div class="container">
          <div class="card">
            <h2>Import Accounts</h2>
            <form action="/api/accounts/import-bulk" method="post">
              <div>
                <label for="format">Format:</label>
                <select name="format" id="format">
                  <option value="${defaultAccountListFormat}" selected>
                    ${defaultAccountListFormat}
                  </option>
                  <option
                    value="username:password:email:emailPassword:authToken:ANY"
                  >
                    username:password:email:emailPassword:authToken:ANY
                  </option>
                  <option value="username:password:email:emailPassword:ANY:ANY">
                    username:password:email:emailPassword:ANY:ANY
                  </option>
                </select>
              </div>
              <textarea
                name="accounts"
                placeholder="Paste account list here, one account per line"
                required
              ></textarea>
              <button type="submit">Import Accounts</button>
            </form>
          </div>

          <div class="card">
            <h2>Account Status</h2>
            ${accounts.length > 0
              ? html`
                  <table>
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
              : html`<p>No accounts available.</p>`}
          </div>
        </div>

        <div class="card" style="margin-top: 20px;">
          <h2>API Endpoints</h2>
          <ul>
            <li>
              <code>POST /api/accounts/import</code> - Import accounts via API
              (JSON)
            </li>
            <li>
              <code>POST /api/accounts/login</code> - Force login with a
              different account
            </li>
          </ul>

          <h3>Example API Usage</h3>
          <pre>
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
        </pre
          >
        </div>
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
