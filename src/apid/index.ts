import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { TwitterGuestAuth } from '../auth.js';
import { getTweet, getTweetAnonymous, type Tweet } from '../tweets.js';
import { accountManager, AccountManager } from '../account-manager.js';
import { tokenManager } from '../token-manager.js';
import { router as communitiesRouter } from './community.js';
import { router as tokensRouter } from './token.js';
import { router as accountsRouter } from './account.js';

declare global {
  var PLATFORM_NODE: boolean;
}
globalThis.PLATFORM_NODE = true;

const app = new Hono();

// Token verification middleware
const verifyToken = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized - Missing or invalid token' }, 401);
  }

  const token = authHeader.split(' ')[1];
  if (!tokenManager.validateToken(token)) {
    return c.json({ error: 'Unauthorized - Invalid token' }, 401);
  }

  await next();
};

// Simple home page with links
app.get('/', (c) => {
  const isLoggedIn = getCookie(c, 'admin_auth') !== undefined;

  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Twitter Scraper API</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          color: #333;
        }
        h1 { color: #1DA1F2; }
        a { color: #1DA1F2; text-decoration: none; }
        a:hover { text-decoration: underline; }
        ul { padding-left: 20px; }
        li { margin: 10px 0; }
        .admin-panel {
          background-color: #f8f9fa;
          border-radius: 8px;
          padding: 20px;
          margin-top: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .card {
          background-color: #f8f9fa;
          border-radius: 8px;
          padding: 20px;
          margin-top: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
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
      <h1>Twitter Scraper API</h1>
      <p>Welcome to the Twitter Scraper API.</p>
      
      ${
        isLoggedIn
          ? `
      <div class="admin-panel">
        <h2>Admin Panel</h2>
        <ul>
          <li><a href="/api/tokens">Manage API Tokens</a></li>
          <li><a href="/api/accounts">Manage Twitter Accounts</a></li>
          <li><a href="/api/tokens/logout">Logout</a></li>
        </ul>
      </div>
      `
          : `
      <div class="admin-panel">
        <h2>Admin Access</h2>
        <p>Admin features are protected. Please <a href="/api/tokens/login">login</a> to access the admin panel.</p>
      </div>
      `
      }
      
      <div class="card">
        <h2>API Usage</h2>
        <p>To use the API, include your token in the Authorization header:</p>
        <code>Authorization: Bearer YOUR_TOKEN</code>
        <p>Available endpoints:</p>
        <ul>
          <li><code>GET /api/tweets/:id</code> - Get a tweet by ID</li>
          <li><code>GET /api/scraper</code> - Get scraper status</li>
        </ul>
      </div>
    </body>
    </html>
  `);
});
app.route('/api/communities', communitiesRouter);
app.route('/api/tokens', tokensRouter);
app.route('/api/accounts', accountsRouter);

app.get('/api/tweets/:id', verifyToken, async (c) => {
  const id = c.req.param('id');
  const useAccount = c.req.query('use_account') === 'true';

  let tweet: Tweet | null;
  let fetchedWith = 'anonymous';

  if (useAccount && accountManager.hasAccountsAvailable) {
    if (!accountManager.isLoggedIn()) {
      await accountManager.logIn();
    }
    tweet = await getTweet(id, accountManager.createAuthInstance());
    fetchedWith = accountManager.getCurrentUsername() || 'anonymous';
  } else {
    const auth = new TwitterGuestAuth(AccountManager.DEFAULT_BEARER_TOKEN);
    tweet = await getTweetAnonymous(id, auth);
  }

  const metadata = { tweetId: id, fetchedWith };
  if (!tweet) {
    return c.json({ error: 'Tweet not found', metadata }, 404);
  }

  return c.json({
    tweet,
    metadata,
  });
});
app.get('/api/scraper', verifyToken, (c) => {
  if (!accountManager.hasAccountsAvailable) {
    return c.json({ error: 'No accounts available' }, 400);
  }

  return c.json({
    message:
      'Use the /api/tweets/:id endpoint with use_account=true to use the scraper',
    loggedIn: accountManager.isLoggedIn(),
    username: accountManager.getCurrentUsername(),
  });
});

// https://github.com/orgs/honojs/discussions/3722
export default {
  idleTimeout: 255, // seconds
  fetch: app.fetch,
};
