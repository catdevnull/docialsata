import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import useLocalStorageState from 'use-local-storage-state';
import { Download } from 'lucide-react';
import type { Tweet } from '../../tweets';

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
        <h2 className="title is-4 twitter-blue">Tweets and Replies</h2>
        <TweetsAndRepliesForm />
      </div>
    </div>
  </section>
);

const useToken = () => {
  const [token, setToken] = useLocalStorageState('token', {
    defaultValue: '',
  });
  return [token, setToken] as const;
};

const TokenInput = () => {
  const [token, setToken] = useToken();
  const [state, setState] = React.useState<
    null | 'loading' | 'error' | 'success'
  >(null);
  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        setState('loading');
        const res = await fetch('/api/tokens/me', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) setState('success');
        else setState('error');
      } catch (error) {
        setState('error');
      }
    })();
  }, [token]);
  return (
    <div className="field is-horizontal">
      <div className="field-label is-normal">
        <label className="label">Token</label>
        {state === 'success' && <span className="tag is-success">Valid</span>}
        {state === 'error' && <span className="tag is-danger">Invalid</span>}
        {state === 'loading' && <span className="tag is-info">Loading...</span>}
      </div>
      <div className="field-body">
        <div className="field">
          <p className="control">
            <input
              className="input"
              type="password"
              placeholder="Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </p>
        </div>
      </div>
    </div>
  );
};

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

  const refetch = useCallback(
    async (e?: Event) => {
      e?.preventDefault();
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
    },
    [idOrHandle, until, token],
  );

  return (
    <div>
      <form onSubmit={refetch}>
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

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/playground" element={<Playground />} />
    </Routes>
  </BrowserRouter>,
);
