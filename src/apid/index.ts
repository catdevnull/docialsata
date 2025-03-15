import { Hono } from 'hono';
import { TwitterGuestAuth } from '../auth';
import { getTweet, getTweetAnonymous, type Tweet } from '../tweets';
import {
  AccountManager,
  parseAccountList,
  type AccountInfo,
} from '../account-manager';

declare global {
  var PLATFORM_NODE: boolean;
}
globalThis.PLATFORM_NODE = true;

const accountManager = new AccountManager();

const app = new Hono();

app.get('/', (c) => c.text('Twitter Scraper API'));

app.get('/api/tweets/:id', async (c) => {
  const id = c.req.param('id');
  const useAccount = c.req.query('use_account') === 'true';

  let tweet: Tweet | null;
  let fetchedWith = 'anonymous';

  if (useAccount && accountManager.hasAccounts()) {
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

app.post('/api/accounts/import', async (c) => {
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
      accounts: accountManager.getAccountSummaries(),
    });
  } catch (error) {
    console.error('Error importing accounts:', error);
    return c.json({ error: 'Failed to import accounts' }, 500);
  }
});

app.get('/api/accounts', (c) => {
  return c.json({
    accounts: accountManager.getAccountSummaries(),
    currentlyLoggedIn: accountManager.isLoggedIn(),
    currentUsername: accountManager.getCurrentUsername(),
  });
});
app.post('/api/accounts/login', async (c) => {
  try {
    if (!accountManager.hasAccounts()) {
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

app.get('/api/scraper', (c) => {
  if (!accountManager.hasAccounts()) {
    return c.json({ error: 'No accounts available' }, 400);
  }

  return c.json({
    message:
      'Use the /api/tweets/:id endpoint with use_account=true to use the scraper',
    loggedIn: accountManager.isLoggedIn(),
    username: accountManager.getCurrentUsername(),
  });
});

export default app;
