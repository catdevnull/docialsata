import { Hono } from 'hono';
import { accountManager } from '../account-manager.js';
import { getUserIdByScreenName } from '../profile.js';
import { getTweetsAndRepliesByUserId } from '../tweets.js';
import { verifyToken } from './auth.js';

export const router = new Hono();

router.get('/:id_or_handle/tweets-and-replies', verifyToken, async (c) => {
  const idOrHandle = c.req.param('id_or_handle');
  const until = c.req.query('until') ? Number(c.req.query('until')) : 40;
  const auth = accountManager.createAuthInstance();

  let id: string;
  if (idOrHandle.startsWith('@')) {
    const handle = idOrHandle.slice(1);
    try {
      const res = await getUserIdByScreenName(handle, auth);
      if (!res.success) throw res.err;
      id = res.value;
    } catch (error: unknown) {
      console.log(error);
      if ((error as Error).message === 'User not found.') {
        return c.json({ error: 'User not found', handle }, 404);
      }
      return c.json({ error: 'Failed to get user ID' }, 500);
    }
  } else {
    id = idOrHandle;
  }

  const res = getTweetsAndRepliesByUserId(id, until, auth);
  let tweets = [];
  for await (const tweet of res) {
    tweets.push(tweet);
  }

  return c.json({ tweets });
});
