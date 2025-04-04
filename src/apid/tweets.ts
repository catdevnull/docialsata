import { Hono } from 'hono';
import type { Tweet } from '../_module.js';
import { AccountManager, accountManager } from '../account-manager.js';
import { TwitterGuestAuth } from '../auth.js';
import { getTweet, getTweetAnonymous } from '../tweets.js';
import { verifyToken } from './auth.js';

export const router = new Hono();

router.get('/:id', verifyToken, async (c) => {
  const id = c.req.param('id');
  let tweet: Tweet | null;
  if (accountManager.hasAccountsAvailable) {
    tweet = await getTweet(id, accountManager.createAuthInstance());
  } else {
    const auth = new TwitterGuestAuth();
    tweet = await getTweetAnonymous(id, auth);
  }

  const metadata = { tweetId: id };
  if (!tweet) {
    return c.json({ error: 'Tweet not found', metadata }, 404);
  }

  return c.json({ tweet, metadata });
});
