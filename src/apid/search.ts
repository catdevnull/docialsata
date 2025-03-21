import { Hono } from 'hono';
import { verifyToken } from './auth';
import { SearchMode, searchProfiles, searchTweets } from '../search';
import { accountManager } from '../account-manager';

export const router = new Hono();

router.get('/people/:query', verifyToken, async (c) => {
  const query = c.req.param('query');
  const until = c.req.query('until') ? Number(c.req.query('until')) : 20;
  const auth = accountManager.createAuthInstance();

  const res = searchProfiles(query, until, auth);
  let profiles = [];
  for await (const profile of res) {
    profiles.push(profile);
  }

  return c.json({ profiles });
});

router.get('/tweets/:query', verifyToken, async (c) => {
  const query = c.req.param('query');
  const until = c.req.query('until') ? Number(c.req.query('until')) : 20;
  const auth = accountManager.createAuthInstance();

  const res = searchTweets(query, until, SearchMode.Top, auth);
  let tweets = [];
  for await (const tweet of res) {
    tweets.push(tweet);
  }

  return c.json({ tweets });
});
