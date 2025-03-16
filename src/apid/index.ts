import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { router as communitiesRouter } from './community.js';
import { router as tokensRouter } from './token.js';
import { router as accountsRouter } from './account.js';
import { router as tweetsRouter } from './tweets.js';

declare global {
  var PLATFORM_NODE: boolean;
}
globalThis.PLATFORM_NODE = true;

const app = new Hono();

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
app.route('/api/tweets', tweetsRouter);

// https://github.com/orgs/honojs/discussions/3722
export default {
  idleTimeout: 255, // seconds
  fetch: app.fetch,
};
