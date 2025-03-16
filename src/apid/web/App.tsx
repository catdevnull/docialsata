import React, { useEffect, useState } from 'react';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import useLocalStorageState from 'use-local-storage-state';
import { Download } from 'lucide-react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

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
      try {
        if (token) {
          setState('loading');
          const res = await fetch('/api/tokens/me', {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (res.ok) {
            setState('success');
          } else {
            setState('error');
          }
        }
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

// Custom hook for fetching tweets and replies
const useTweetsAndReplies = (formattedHandle: string | null, until: string, token: string) => {
  return useQuery({
    queryKey: ['tweetsAndReplies', formattedHandle, until, token],
    queryFn: async () => {
      if (!formattedHandle || !token) {
        return { tweets: [] };
      }

      const endpoint = `/api/users/${formattedHandle}/tweets-and-replies${
        until ? `?until=${until}` : ''
      }`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'An error occurred while fetching tweets');
      }

      return data;
    },
    enabled: false, // Don't run automatically, wait for manual trigger
  });
};

const TweetsAndRepliesForm = () => {
  const [token] = useToken();
  const [idOrHandle, setIdOrHandle] = useState('');
  const [until, setUntil] = useState('40');
  const [formattedHandle, setFormattedHandle] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Using TanStack Query for data fetching
  const {
    data,
    error,
    isLoading,
    isError,
    refetch,
    isFetched,
  } = useTweetsAndReplies(formattedHandle, until, token);

  const tweets = data?.tweets || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!token) {
      setValidationError('Please enter a valid token first');
      return;
    }

    if (!idOrHandle) {
      setValidationError('Please enter a user ID or handle');
      return;
    }

    // Format the handle and trigger the query
    const formatted = idOrHandle.startsWith('@')
      ? idOrHandle
      : idOrHandle.startsWith('id:')
      ? idOrHandle.slice(3)
      : `@${idOrHandle}`;
      
    setFormattedHandle(formatted);
    refetch();
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label className="label">User ID or Handle</label>
          <div className="control">
            <input
              className="input"
              type="text"
              placeholder="Enter @username or user ID"
              value={idOrHandle}
              onChange={(e) => setIdOrHandle(e.target.value)}
            />
            <p className="help">
              For username, you can optionally prefix with @ (e.g. @username).
              For IDs, use the numeric ID.
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
        <div className="notification is-danger mt-4">
          <button className="delete" onClick={() => setValidationError(null)}></button>
          {validationError}
        </div>
      )}
      
      {isError && (
        <div className="notification is-danger mt-4">
          <button className="delete" onClick={() => refetch()}></button>
          {error instanceof Error ? error.message : 'An error occurred while fetching tweets'}
        </div>
      )}

      {isFetched && tweets.length > 0 && (
        <div className="mt-4">
          <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
            <h3 className="title is-5 mb-0">
              Results ({tweets.length} tweets)
            </h3>
            <button
              className="button is-small is-info"
              onClick={() => {
                const dataStr = JSON.stringify(tweets, null, 2);
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
            {tweets.map((tweet: any, index: number) => (
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

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/playground" element={<Playground />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>,
);
