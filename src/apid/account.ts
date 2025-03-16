import { Hono } from 'hono';
import { html } from 'hono/html';
import { setCookie, getCookie } from 'hono/cookie';
import {
  accountManager,
  parseAccountList,
  defaultAccountListFormat,
  type AccountInfo,
} from '../account-manager.js';

export const router = new Hono();

// // Import accounts (API endpoint)
// router.post('/import', verifyAdmin, async (c) => {
//   try {
//     const body = await c.req.json();
//     const { accounts } = body as { accounts: AccountInfo[] };

//     if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
//       return c.json({ error: 'A valid array of accounts is required' }, 400);
//     }

//     accountManager.addAccounts(accounts);

//     return c.json({
//       message: 'Accounts imported successfully',
//       count: accounts.length,
//     });
//   } catch (error) {
//     console.error('Error importing accounts:', error);
//     return c.json({ error: 'Failed to import accounts' }, 500);
//   }
// });

// // Login (API endpoint)
// router.post('/login', verifyAdmin, async (c) => {
//   try {
//     if (!accountManager.hasAccountsAvailable) {
//       return c.json({ error: 'No accounts available' }, 400);
//     }

//     // Force logout and re-login with a different account
//     await accountManager.logIn();

//     return c.json({
//       success: true,
//       loggedIn: accountManager.isLoggedIn(),
//       username: accountManager.getCurrentUsername(),
//     });
//   } catch (error) {
//     console.error('Login error:', error);
//     return c.json(
//       {
//         error: 'Failed to log in',
//         message: (error as Error).message,
//       },
//       500,
//     );
//   }
// });
