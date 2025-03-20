import React, { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import TokenInput, { useToken } from './TokenInput';
import { Download } from 'lucide-react';
import type { Tweet } from '../../tweets';
import type { Profile } from '../../profile';
import {
  MantineReactTable,
  useMantineReactTable,
  type MRT_ColumnDef, //if using TypeScript (optional, but recommended)
} from 'mantine-react-table';

const Index = () => (
  <section className="section">
    <div className="container">
      <h1 className="title twitter-blue">Twitter Scraper API</h1>
      <p className="subtitle">Welcome to the Twitter Scraper API.</p>
      <p>
        <a href="/admin">Admin Panel</a>
        <span className="mx-2">|</span>
        <Link to="/playground">Playground</Link>
      </p>
      <div className="box mt-5">
        <h2 className="title is-4 twitter-blue">API Usage</h2>
        <p>To use the API, include your token in the Authorization header:</p>
        <pre className="has-background-light p-3 mt-2 mb-4">
          <code>Authorization: Bearer YOUR_TOKEN</code>
        </pre>
      </div>
    </div>
  </section>
);

const Playground = () => (
  <section className="section">
    <div className="container">
      <h1 className="title twitter-blue">Playground</h1>
      <p className="subtitle">Welcome to the Playground.</p>

      <TokenInput />

      <div className="box mt-5">
        <h2 className="title is-4 twitter-blue">User Profile</h2>
        <p className="subtitle">
          Get a user's profile information using their handle or ID.
        </p>
        <ProfileForm />
      </div>

      <div className="box mt-5">
        <h2 className="title is-4 twitter-blue">Tweets and Replies</h2>
        <p className="subtitle">
          Tené en cuenta que lamentablemente este endpoint se queda a los ~900
          tweets - es una limitación de la API interna de Twitter que no podemos
          superar. En el futuro vamos a armar un endpoint para descargar todos
          los tweets de un usuario, pero sin incluir retweets (usando la
          funcionalidad de busqueda).
        </p>
        <TweetsAndRepliesForm />
      </div>

      <div className="box mt-5">
        <h2 className="title is-4 twitter-blue">Following</h2>
        <p className="subtitle">
          Get a list of users that this account follows.
        </p>
        <FollowingForm />
      </div>

      <div className="box mt-5">
        <h2 className="title is-4 twitter-blue">Followers</h2>
        <p className="subtitle">
          Get a list of users that follow this account.
        </p>
        <FollowersForm />
      </div>
    </div>
  </section>
);

const TweetsAndRepliesForm = () => {
  const [token] = useToken();
  const [idOrHandle, setIdOrHandle] = useState('');
  const [until, setUntil] = useState('40');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = !idOrHandle
    ? 'Please enter a user ID or handle'
    : !idOrHandle.startsWith('@') && !/\d+$/.test(idOrHandle)
    ? 'Please enter a valid handle'
    : !until
    ? 'Please enter a number of tweets'
    : null;

  const [data, setData] = useState<{ tweets: Tweet[] } | null>(null);

  const columns = useMemo(
    () => [
      { header: 'Username', accessorKey: 'username' },
      { header: 'Name', accessorKey: 'name' },
      { header: 'Text', accessorKey: 'text' },
    ],
    [],
  );

  const table = useMantineReactTable({
    columns,
    data: data?.tweets || [],
    enableColumnOrdering: true,
    enableGlobalFilter: false,
    initialState: {
      density: 'xs',
    },
  });

  const refetch = useCallback(async () => {
    if (validationError) return;
    setIsLoading(true);
    setError(null);
    try {
      const endpoint = `/api/users/${idOrHandle}/tweets-and-replies${
        until ? `?until=${until}` : ''
      }`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || 'An error occurred while fetching tweets',
        );
      }
      setData(data);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'An error occurred while fetching tweets',
      );
    } finally {
      setIsLoading(false);
    }
  }, [idOrHandle, until, token]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          refetch();
        }}
      >
        <div className="field">
          <label className="label">User ID or Handle</label>
          <div className="control">
            <input
              className="input"
              type="text"
              placeholder="Enter @username or user ID"
              value={idOrHandle}
              disabled={isLoading}
              onChange={(e) => setIdOrHandle(e.target.value)}
            />
            <p className="help">
              For username, you can prefix with @ (e.g. @username). For IDs, use
              the numeric ID.
            </p>
          </div>
        </div>

        <div className="field">
          <label className="label">Until</label>
          <div className="control">
            <input
              className="input"
              type="number"
              placeholder="Number of tweets (default: 40)"
              value={until}
              disabled={isLoading}
              onChange={(e) => setUntil(e.target.value)}
            />
            <p className="help">
              Maximum number of tweets to fetch. Default is 40.
            </p>
          </div>
        </div>

        <div className="field">
          <div className="control">
            <button
              className={`button is-primary ${isLoading ? 'is-loading' : ''}`}
              type="submit"
            >
              Fetch Tweets and Replies
            </button>
          </div>
        </div>
      </form>

      {validationError && (
        <div className="notification is-danger mt-4">{validationError}</div>
      )}

      {error && (
        <div className="notification is-danger mt-4">
          <button className="delete" onClick={() => refetch()}></button>
          {error}
        </div>
      )}

      {data && (
        <div className="mt-4">
          <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
            <h3 className="title is-5 mb-0">
              Results ({data.tweets.length} tweets)
            </h3>
            <button
              className="button is-small is-info"
              onClick={() => {
                const dataStr = JSON.stringify(data.tweets, null, 2);
                const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(
                  dataStr,
                )}`;
                const fileName = `tweets-and-replies-${idOrHandle.replace(
                  '@',
                  '',
                )}-${new Date().toISOString().slice(0, 19)}.json`;

                const linkElement = document.createElement('a');
                linkElement.setAttribute('href', dataUri);
                linkElement.setAttribute('download', fileName);
                linkElement.click();
              }}
            >
              <span className="icon is-small mr-1">
                <Download size={16} />
              </span>
              <span>Download JSON</span>
            </button>
          </div>
          <MantineReactTable table={table} />

          <div
            className="tweets-container"
            style={{ maxHeight: '500px', overflowY: 'auto' }}
          >
            {data.tweets.map((tweet: any, index: number) => (
              <div key={index} className="box mb-3">
                <pre style={{ whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(tweet, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const FollowingForm = () => {
  const [token] = useToken();
  const [idOrHandle, setIdOrHandle] = useState('');
  const [until, setUntil] = useState('40');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = !idOrHandle
    ? 'Please enter a user ID or handle'
    : !idOrHandle.startsWith('@') && !/\d+$/.test(idOrHandle)
    ? 'Please enter a valid handle'
    : !until
    ? 'Please enter a number of profiles'
    : null;

  const [data, setData] = useState<{ profiles: Profile[] } | null>(null);

  const columns = useMemo(
    () => [
      { header: 'Username', accessorKey: 'username' },
      { header: 'Name', accessorKey: 'name' },
      { header: 'Description', accessorKey: 'description' },
    ],
    [],
  );

  const table = useMantineReactTable({
    columns,
    data: data?.profiles || [],
    enableColumnOrdering: true,
    enableGlobalFilter: false,
    initialState: {
      density: 'xs',
    },
  });

  const refetch = useCallback(async () => {
    if (validationError) return;
    setIsLoading(true);
    setError(null);
    try {
      const endpoint = `/api/users/${idOrHandle}/following${
        until ? `?until=${until}` : ''
      }`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || 'An error occurred while fetching following',
        );
      }
      setData(data);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'An error occurred while fetching following',
      );
    } finally {
      setIsLoading(false);
    }
  }, [idOrHandle, until, token]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          refetch();
        }}
      >
        <div className="field">
          <label className="label">User ID or Handle</label>
          <div className="control">
            <input
              className="input"
              type="text"
              placeholder="Enter @username or user ID"
              value={idOrHandle}
              disabled={isLoading}
              onChange={(e) => setIdOrHandle(e.target.value)}
            />
            <p className="help">
              For username, you can prefix with @ (e.g. @username). For IDs, use
              the numeric ID.
            </p>
          </div>
        </div>

        <div className="field">
          <label className="label">Until</label>
          <div className="control">
            <input
              className="input"
              type="number"
              placeholder="Number of profiles (default: 40)"
              value={until}
              disabled={isLoading}
              onChange={(e) => setUntil(e.target.value)}
            />
            <p className="help">
              Maximum number of profiles to fetch. Default is 40.
            </p>
          </div>
        </div>

        <div className="field">
          <div className="control">
            <button
              className={`button is-primary ${isLoading ? 'is-loading' : ''}`}
              type="submit"
            >
              Fetch Following
            </button>
          </div>
        </div>
      </form>

      {validationError && (
        <div className="notification is-danger mt-4">{validationError}</div>
      )}

      {error && (
        <div className="notification is-danger mt-4">
          <button className="delete" onClick={() => refetch()}></button>
          {error}
        </div>
      )}

      {data && (
        <div className="mt-4">
          <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
            <span className="tag is-info is-medium">
              {data.profiles.length} profiles found
            </span>
          </div>
          <div className="table-container">
            <MantineReactTable table={table} />
          </div>
        </div>
      )}
    </div>
  );
};

const FollowersForm = () => {
  const [token] = useToken();
  const [idOrHandle, setIdOrHandle] = useState('');
  const [until, setUntil] = useState('40');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = !idOrHandle
    ? 'Please enter a user ID or handle'
    : !idOrHandle.startsWith('@') && !/\d+$/.test(idOrHandle)
    ? 'Please enter a valid handle'
    : !until
    ? 'Please enter a number of profiles'
    : null;

  const [data, setData] = useState<{ profiles: Profile[] } | null>(null);

  const columns = useMemo(
    () => [
      { header: 'Username', accessorKey: 'username' },
      { header: 'Name', accessorKey: 'name' },
      { header: 'Description', accessorKey: 'description' },
    ],
    [],
  );

  const table = useMantineReactTable({
    columns,
    data: data?.profiles || [],
    enableColumnOrdering: true,
    enableGlobalFilter: false,
    initialState: {
      density: 'xs',
    },
  });

  const refetch = useCallback(async () => {
    if (validationError) return;
    setIsLoading(true);
    setError(null);
    try {
      const endpoint = `/api/users/${idOrHandle}/followers${
        until ? `?until=${until}` : ''
      }`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || 'An error occurred while fetching followers',
        );
      }
      setData(data);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'An error occurred while fetching followers',
      );
    } finally {
      setIsLoading(false);
    }
  }, [idOrHandle, until, token]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          refetch();
        }}
      >
        <div className="field">
          <label className="label">User ID or Handle</label>
          <div className="control">
            <input
              className="input"
              type="text"
              placeholder="Enter @username or user ID"
              value={idOrHandle}
              disabled={isLoading}
              onChange={(e) => setIdOrHandle(e.target.value)}
            />
            <p className="help">
              For username, you can prefix with @ (e.g. @username). For IDs, use
              the numeric ID.
            </p>
          </div>
        </div>

        <div className="field">
          <label className="label">Until</label>
          <div className="control">
            <input
              className="input"
              type="number"
              placeholder="Number of profiles (default: 40)"
              value={until}
              disabled={isLoading}
              onChange={(e) => setUntil(e.target.value)}
            />
            <p className="help">
              Maximum number of profiles to fetch. Default is 40.
            </p>
          </div>
        </div>

        <div className="field">
          <div className="control">
            <button
              className={`button is-primary ${isLoading ? 'is-loading' : ''}`}
              type="submit"
            >
              Fetch Followers
            </button>
          </div>
        </div>
      </form>

      {validationError && (
        <div className="notification is-danger mt-4">{validationError}</div>
      )}

      {error && (
        <div className="notification is-danger mt-4">
          <button className="delete" onClick={() => refetch()}></button>
          {error}
        </div>
      )}

      {data && (
        <div className="mt-4">
          <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
            <span className="tag is-info is-medium">
              {data.profiles.length} profiles found
            </span>
          </div>
          <div className="table-container">
            <MantineReactTable table={table} />
          </div>
        </div>
      )}
    </div>
  );
};

const ProfileForm = () => {
  const [token] = useToken();
  const [handle, setIdOrHandle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = !handle ? 'Please enter a user ID or handle' : null;

  const [data, setData] = useState<{ profile: any } | null>(null);

  const refetch = useCallback(async () => {
    if (validationError) return;
    setIsLoading(true);
    setError(null);
    try {
      const endpoint = `/api/users/${handle}`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || 'An error occurred while fetching profile',
        );
      }
      setData(data);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'An error occurred while fetching profile',
      );
    } finally {
      setIsLoading(false);
    }
  }, [handle, token]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          refetch();
        }}
      >
        <div className="field">
          <label className="label">Handle</label>
          <div className="control">
            <input
              className="input"
              type="text"
              placeholder="Enter username"
              value={handle}
              disabled={isLoading}
              onChange={(e) => setIdOrHandle(e.target.value)}
            />
            <p className="help">
              For username, you can prefix with @ (e.g. @username). No IDs
              allowed for now.
            </p>
          </div>
        </div>

        <div className="field">
          <div className="control">
            <button
              className={`button is-primary ${isLoading ? 'is-loading' : ''}`}
              type="submit"
            >
              Fetch User Profile
            </button>
          </div>
        </div>
      </form>

      {validationError && (
        <div className="notification is-danger mt-4">{validationError}</div>
      )}

      {error && (
        <div className="notification is-danger mt-4">
          <button className="delete" onClick={() => refetch()}></button>
          {error}
        </div>
      )}

      {data && (
        <div className="mt-4">
          <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
            <h3 className="title is-5 mb-0">Profile Result</h3>
            <button
              className="button is-small is-info"
              onClick={() => {
                const dataStr = JSON.stringify(data.profile, null, 2);
                const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(
                  dataStr,
                )}`;
                const fileName = `profile-${handle.replace(
                  '@',
                  '',
                )}-${new Date().toISOString().slice(0, 19)}.json`;

                const linkElement = document.createElement('a');
                linkElement.setAttribute('href', dataUri);
                linkElement.setAttribute('download', fileName);
                linkElement.click();
              }}
            >
              <span className="icon is-small mr-1">
                <Download size={16} />
              </span>
              <span>Download JSON</span>
            </button>
          </div>
          <div className="box mb-3">
            <pre style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(data.profile, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/playground" element={<Playground />} />
    </Routes>
  </BrowserRouter>,
);
