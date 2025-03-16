import { Hono } from 'hono';
import { Tweet } from '../_module.js';
import { AccountManager, accountManager } from '../account-manager.js';
import { TwitterGuestAuth } from '../auth.js';
import { getTweet, getTweetAnonymous } from '../tweets.js';
import { verifyToken } from './auth.js';

export const router = new Hono();

router.get('/:id', verifyToken, async (c) => {
  const id = c.req.param('id');
  let tweet: Tweet | null;
  let fetchedWith = 'anonymous';
  if (accountManager.hasAccountsAvailable) {
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

  return c.json({ tweet, metadata });
});
