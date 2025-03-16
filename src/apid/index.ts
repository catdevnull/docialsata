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
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
      <style>
        .twitter-blue { color: #1DA1F2; }
        .twitter-blue-bg { background-color: #1DA1F2; }
      </style>
    </head>
    <body>
      <section class="section">
        <div class="container">
          <h1 class="title twitter-blue">Twitter Scraper API</h1>
          <p class="subtitle">Welcome to the Twitter Scraper API.</p>
          
          ${
            isLoggedIn
              ? `
          <div class="box mt-5">
            <h2 class="title is-4 twitter-blue">Admin Panel</h2>
            <div class="buttons">
              <a href="/api/tokens" class="button is-info">Manage API Tokens</a>
              <a href="/api/accounts" class="button is-info">Manage Twitter Accounts</a>
              <a href="/api/tokens/logout" class="button is-danger">Logout</a>
            </div>
          </div>
          `
              : `
          <div class="box mt-5">
            <h2 class="title is-4 twitter-blue">Admin Access</h2>
            <p>Admin features are protected. Please <a href="/api/tokens/login" class="has-text-info">login</a> to access the admin panel.</p>
          </div>
          `
          }
          
          <div class="box mt-5">
            <h2 class="title is-4 twitter-blue">API Usage</h2>
            <p>To use the API, include your token in the Authorization header:</p>
            <pre class="has-background-light p-3 mt-2 mb-4"><code>Authorization: Bearer YOUR_TOKEN</code></pre>
            <p class="mb-2">Available endpoints:</p>
            <ul class="ml-5">
              <li><code class="has-background-light">GET /api/tweets/:id</code> - Get a tweet by ID</li>
              <li><code class="has-background-light">GET /api/scraper</code> - Get scraper status</li>
            </ul>
          </div>
        </div>
      </section>
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
