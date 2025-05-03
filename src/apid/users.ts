import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { accountManager } from '../account-manager.js';
import { getProfile, getUserIdByScreenName } from '../profile.js';
import { getTweetsAndRepliesByUserId } from '../tweets.js';
import { verifyToken } from './auth.js';
import { HTTPException } from 'hono/http-exception';
import type { TwitterAuth } from '../auth.js';
import { getFollowers, getFollowing } from '../relationships.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getAllTweetsEver, SearchMode, searchTweets } from '../search.js';

export const router = new Hono();

class HTTPJsonException extends HTTPException {
  constructor(status: ContentfulStatusCode, message: string) {
    super(status, { message });
  }

  getResponse() {
    return new Response(JSON.stringify({ error: this.message }), {
      status: this.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

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
        throw new HTTPJsonException(404, 'User not found');
      }
      throw new HTTPJsonException(500, 'Failed to get user ID');
    }
  } else {
    if (!/^[0-9]+$/.test(idOrHandle)) {
      throw new HTTPJsonException(
        400,
        'Invalid user ID - if you are using a handle, it must start with @',
      );
    }
    id = idOrHandle;
  }

  return id;
}

router.get('/:handle', verifyToken, async (c) => {
  if (!c.req.param('handle').startsWith('@'))
    throw new HTTPJsonException(400, 'Handle must start with @');
  const handle = c.req.param('handle').slice(1);
  const auth = accountManager.createAuthInstance();

  try {
    const res = await getProfile(handle, auth);
    if (!res.success) throw res.err;

    return c.json({ profile: res.value });
  } catch (error: unknown) {
    if ((error as Error).message === 'User not found.') {
      throw new HTTPJsonException(404, 'User not found');
    }
    console.log(error);
    throw new HTTPJsonException(500, 'Failed to get user profile');
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

router.get('/:id_or_handle/all-tweets', verifyToken, async (c) => {
  const idOrHandle = c.req.param('id_or_handle');
  if (!idOrHandle.startsWith('@'))
    throw new HTTPJsonException(400, 'Handle must start with @');
  const handle = idOrHandle.slice(1);
  const auth = accountManager.createAuthInstance();

  const res = getAllTweetsEver(auth, handle);
  if (c.req.header('accept') === 'application/jsonl') {
    return stream(c, async (stream) => {
      for await (const tweet of res) {
        stream.writeln(JSON.stringify(tweet));
      }
    });
  }
  let tweets = [];
  for await (const tweet of res) {
    tweets.push(tweet);
  }
  return c.json({ tweets });
});
