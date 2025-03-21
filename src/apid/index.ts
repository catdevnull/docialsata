import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { router as communitiesRouter } from './community.js';
import { router as tokensRouter } from './token.js';
import { router as accountsRouter } from './account.js';
import { router as tweetsRouter } from './tweets.js';
import { router as usersRouter } from './users.js';
import { router as adminRouter } from './admin.js';
import { router as searchRouter } from './search.js';
import index from './web/index.html';

declare global {
  var PLATFORM_NODE: boolean;
}
globalThis.PLATFORM_NODE = true;

const app = new Hono();

app.route('/admin', adminRouter);
app.route('/api/communities', communitiesRouter);
app.route('/api/tokens', tokensRouter);
app.route('/api/accounts', accountsRouter);
app.route('/api/tweets', tweetsRouter);
app.route('/api/users', usersRouter);
app.route('/api/search', searchRouter);

// https://github.com/orgs/honojs/discussions/3722
export default {
  idleTimeout: 255, // seconds
  routes: {
    '/': index,
    '/playground': index,
  },
  fetch: app.fetch,
};
