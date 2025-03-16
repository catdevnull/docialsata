import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useLocalStorageState from 'use-local-storage-state';

// Hook to handle token state in localStorage
export const useToken = () => {
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
  const [copiedExample, setCopiedExample] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('curl');

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

  const copyToClipboard = useCallback((text: string, exampleType: string) => {
    navigator.clipboard.writeText(text);
    setCopiedExample(exampleType);
    setTimeout(() => setCopiedExample(null), 2000);
  }, []);

  // Prepare example code snippets with actual token
  const examples = useMemo(() => {
    const baseUrl = window.location.origin;
    return {
      curl: `curl -X GET "${baseUrl}/api/users/elonmusk/tweets-and-replies?until=40" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json"`,
      javascript: `fetch("${baseUrl}/api/users/elonmusk/tweets-and-replies?until=40", {
  method: "GET",
  headers: {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json",
    "Accept": "application/json"
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));`,
      python: `import requests

url = "${baseUrl}/api/users/elonmusk/tweets-and-replies"
params = {"until": "40"}

headers = {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json",
    "Accept": "application/json"
}

response = requests.get(
    url, 
    params=params,
    headers=headers
)

print(response.json())`
    };
  }, [token]);

  // Censored version of token for display
  const censoredToken = token ? token.substring(0, 4) + '●●●●●●●●●●●●' + token.substring(token.length - 4) : '';

  // Replace token with censored version for display
  const displayExamples = useMemo(() => {
    if (!token) return examples;
    return {
      curl: examples.curl.replace(token, censoredToken),
      javascript: examples.javascript.replace(token, censoredToken),
      python: examples.python.replace(token, censoredToken)
    };
  }, [examples, token, censoredToken]);

  return (
    <div>
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

      {token && (
        <details className="mt-4 mb-4">
          <summary className="has-text-weight-medium">API Usage Examples</summary>
          <div className="content mt-2">
            <div className="tabs">
              <ul>
                <li className={activeTab === 'curl' ? 'is-active' : ''}>
                  <a onClick={() => setActiveTab('curl')}>curl</a>
                </li>
                <li className={activeTab === 'javascript' ? 'is-active' : ''}>
                  <a onClick={() => setActiveTab('javascript')}>JavaScript</a>
                </li>
                <li className={activeTab === 'python' ? 'is-active' : ''}>
                  <a onClick={() => setActiveTab('python')}>Python</a>
                </li>
              </ul>
            </div>

            <div className="tab-content">
              <div className={activeTab === 'curl' ? '' : 'is-hidden'}>
                <div className="is-flex is-justify-content-flex-end mb-2">
                  <button 
                    className="button is-small" 
                    onClick={() => copyToClipboard(examples.curl, 'curl')}
                  >
                    {copiedExample === 'curl' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre style={{ background: '#f5f5f5', padding: '1em', borderRadius: '4px' }}>
                  <code>{displayExamples.curl}</code>
                </pre>
              </div>

              <div className={activeTab === 'javascript' ? '' : 'is-hidden'}>
                <div className="is-flex is-justify-content-flex-end mb-2">
                  <button 
                    className="button is-small" 
                    onClick={() => copyToClipboard(examples.javascript, 'javascript')}
                  >
                    {copiedExample === 'javascript' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre style={{ background: '#f5f5f5', padding: '1em', borderRadius: '4px' }}>
                  <code>{displayExamples.javascript}</code>
                </pre>
              </div>

              <div className={activeTab === 'python' ? '' : 'is-hidden'}>
                <div className="is-flex is-justify-content-flex-end mb-2">
                  <button 
                    className="button is-small" 
                    onClick={() => copyToClipboard(examples.python, 'python')}
                  >
                    {copiedExample === 'python' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre style={{ background: '#f5f5f5', padding: '1em', borderRadius: '4px' }}>
                  <code>{displayExamples.python}</code>
                </pre>
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
  );
};

export default TokenInput;
