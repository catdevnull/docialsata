import { Hono } from 'hono';
import { accountManager } from '../account-manager.js';
import { getProfile, getUserIdByScreenName } from '../profile.js';
import { getTweetsAndRepliesByUserId } from '../tweets.js';
import { verifyToken } from './auth.js';
import { HTTPException } from 'hono/http-exception';
import type { TwitterAuth } from '../auth.js';
import { getFollowers, getFollowing } from '../relationships.js';

export const router = new Hono();

async function parseIdOrHandle(idOrHandle: string, auth: TwitterAuth) {
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
        throw new HTTPException(404, { message: 'User not found' });
      }
      throw new HTTPException(500, { message: 'Failed to get user ID' });
    }
  } else {
    if (!/^[0-9]+$/.test(idOrHandle)) {
      throw new HTTPException(400, {
        message:
          'Invalid user ID - if you are using a handle, it must start with @',
      });
    }
    id = idOrHandle;
  }

  return id;
}

router.get('/:handle', verifyToken, async (c) => {
  const handle = c.req.param('handle').slice(1);
  const auth = accountManager.createAuthInstance();

  try {
    const res = await getProfile(handle, auth);
    if (!res.success) throw res.err;

    return c.json({ profile: res.value });
  } catch (error: unknown) {
    if ((error as Error).message === 'User not found.') {
      throw new HTTPException(404, { message: 'User not found' });
    }
    console.log(error);
    throw new HTTPException(500, { message: 'Failed to get user profile' });
  }
});

router.get('/:id_or_handle/tweets-and-replies', verifyToken, async (c) => {
  const idOrHandle = c.req.param('id_or_handle');
  const until = c.req.query('until') ? Number(c.req.query('until')) : 40;
  const auth = accountManager.createAuthInstance();
  const id = await parseIdOrHandle(idOrHandle, auth);

  const res = getTweetsAndRepliesByUserId(id, until, auth);
  let tweets = [];
  for await (const tweet of res) {
    tweets.push(tweet);
  }

  return c.json({ tweets });
});

router.get('/:id_or_handle/following', verifyToken, async (c) => {
  const idOrHandle = c.req.param('id_or_handle');
  const until = c.req.query('until') ? Number(c.req.query('until')) : 40;
  const auth = accountManager.createAuthInstance();
  const id = await parseIdOrHandle(idOrHandle, auth);

  const res = getFollowing(id, until, auth);
  let profiles = [];
  for await (const profile of res) {
    profiles.push(profile);
  }

  return c.json({ profiles });
});

router.get('/:id_or_handle/followers', verifyToken, async (c) => {
  const idOrHandle = c.req.param('id_or_handle');
  const until = c.req.query('until') ? Number(c.req.query('until')) : 40;
  const auth = accountManager.createAuthInstance();
  const id = await parseIdOrHandle(idOrHandle, auth);

  const res = getFollowers(id, until, auth);
  let profiles = [];
  for await (const profile of res) {
    profiles.push(profile);
  }

  return c.json({ profiles });
});
