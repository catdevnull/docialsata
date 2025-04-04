import { CookieJar, Cookie } from 'tough-cookie';
import { Scraper } from './scraper.js';
import { type TwitterAuth, TwitterGuestAuth } from './auth.js';
import path, { join } from 'path';
import { JSONFileSyncPreset } from 'lowdb/node';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { createPool, Pool } from 'lightning-pool';

export type AccountInfo = {
  username: string;
  password: string;
  email: string;
  emailPassword: string;
  authToken: string;
  twoFactorSecret: string;
};

export type AccountState = AccountInfo & {
  tokenState: 'unknown' | 'working' | 'failed';
  failedLogin: boolean;
  lastUsed?: number;
  lastFailedAt?: number;
  rateLimitedUntil?: number;
};

type DbData = {
  accounts: AccountState[];
  lastSaved?: number;
};

// Default format for account list
export const defaultAccountListFormat =
  'username:password:email:emailPassword:authToken:twoFactorSecret';

/**
 * Parses an CSV that contains the details of multiple Twitter accounts
 * @param csvish the CSV file to parse
 * @param format the format of each line (ex: "username:password:email:emailPassword:authToken:twoFactorSecret")
 * @returns parsed accounts
 */
export function parseAccountList(
  csvish: string,
  format: string = defaultAccountListFormat,
): AccountInfo[] {
  // Escape special regex characters from the format, then replace field names with capture groups
  let regexp = format
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special characters
    .replace('username', `(?<username>.*)`)
    .replace('password', `(?<password>.*)`)
    .replace('email', `(?<email>.*)`)
    .replace('emailPassword', `(?<emailPassword>.*)`)
    .replace('authToken', `(?<authToken>.*)`)
    .replace('twoFactorSecret', `(?<twoFactorSecret>.*)`)
    .replaceAll('ANY', `.*`);
  const exp = new RegExp(regexp);
  const accounts = csvish
    .split(/\r?\n/g)
    .filter((s) => !!s)
    .map((line, index) => {
      const values = line.match(exp)?.groups;
      if (!values) {
        throw new Error(
          `Couldn't match line ${index + 1} with regexp \`${regexp}\``,
        );
      }
      const {
        authToken,
        email,
        emailPassword,
        password,
        username,
        twoFactorSecret,
      } = values;
      return {
        username,
        password,
        email,
        emailPassword,
        authToken,
        twoFactorSecret,
      };
    });
  return accounts;
}

// Wait utility function
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Debounce function implementation for login
function pDebounce<T extends (...args: any[]) => Promise<any>>(fn: T) {
  let pending: Promise<any> | null = null;
  const debounced = ((...args: Parameters<T>) => {
    if (!pending) {
      pending = fn(...args).finally(() => {
        pending = null;
      });
    }
    return pending;
  }) as T;

  return debounced;
}

async function telemetryFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const tracer = trace.getTracer('fetch-tracer');

  return tracer.startActiveSpan(
    `fetch ${init?.method || 'GET'} ${
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url
    }`,
    async (span) => {
      try {
        // Add request details to span
        span.setAttribute(
          'http.url',
          typeof input === 'string'
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url,
        );
        span.setAttribute('http.method', init?.method || 'GET');

        // Perform the fetch
        const response = await fetch(input, init);

        // Add response details to span
        span.setAttribute('http.status_code', response.status);
        span.setAttribute('http.status_text', response.statusText);

        span.setStatus({
          code: response.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        });

        return response;
      } catch (error) {
        // Record error in span
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

// TODO: implement rotating auth pool
// [x] use lighting-pool or something similar (https://www.npmjs.com/package/lightning-pool)
// [x] each is a Scraper instance or similar which represents an authed user
// [ ] (under a specific proxy!)
// [x] ~~if it fails, reset into another account with another proxy~~ just create a new one
// [x] make a virtual TwitterAuth that just fetched from an account.
//    if it fails because of an account-related problem, kill account from pool (and have it reset into another account+proxy), and pull another account
// if there's no accounts available in the pool, await until one is available.
// because of how this pool works, it should also mean accounts are only used one at a time. i don't think that's necesarily bad but it can be a bit slow.

/**
 * Account manager for Twitter scraping
 * Handles account rotation, authentication, and cookie management
 */
export class AccountManager {
  // public static DEFAULT_BEARER_TOKEN =
  // 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  private db: ReturnType<typeof JSONFileSyncPreset<DbData>>;
  private pool: Pool<{ scraper: Scraper; account: AccountState }>;

  constructor(accounts: AccountInfo[] = [], options?: { statePath?: string }) {
    const dbPath =
      options?.statePath ||
      join(
        process.cwd(),
        process.env.ACCOUNTS_STATE_PATH || 'account-state.json',
      );

    this.db = JSONFileSyncPreset<DbData>(dbPath, {
      accounts: accounts.map((a) => ({
        ...a,
        tokenState: 'unknown',
        failedLogin: false,
      })),
    });
    this.db.write();

    let usernamesBeingUsed = new Set<string>();

    this.pool = createPool(
      {
        create: async (info) => {
          const scraper = new Scraper({
            fetch: telemetryFetch,
          });

          const logger = logs.getLogger('docial', '0.0.0');

          const loggingableAccounts = this.db.data.accounts
            .filter(
              (a) =>
                !a.failedLogin &&
                !usernamesBeingUsed.has(a.username) &&
                (a.rateLimitedUntil ? a.rateLimitedUntil < Date.now() : true),
            )
            .sort((a, b) =>
              a.tokenState === 'working'
                ? -1
                : b.tokenState === 'working'
                ? 1
                : Math.random() - 0.5,
            );
          if (!loggingableAccounts.length) {
            throw new Error('No accounts available for login');
          }

          // Keep trying to log into accounts unless all don't work
          let i = 0;
          let account: AccountState;
          while (true) {
            account = loggingableAccounts[i];
            console.debug('Trying', account);
            if (!account) {
              throw new Error('No accounts available for login');
            }
            usernamesBeingUsed.add(account.username);

            try {
              let loggedIn = false;

              if (account.authToken) {
                await scraper.loginWithToken(account.authToken);
                if (await scraper.isLoggedIn()) {
                  loggedIn = true;
                }
              }
              if (!loggedIn) {
                console.warn(
                  `Couldn't log in with authToken, logging in with username/password.`,
                );
                await scraper.login(
                  account.username,
                  account.password,
                  account.email,
                  account.twoFactorSecret,
                );
                if (await scraper.isLoggedIn()) {
                  loggedIn = true;
                }
              }

              if (loggedIn) {
                logger.emit({
                  severityNumber: SeverityNumber.DEBUG,
                  body: `Logged into @${account.username}`,
                });
                const cookies = await scraper.getCookies();
                const authTokenCookie = cookies.find(
                  (c) => c.key === 'auth_token',
                );
                logger.emit({
                  severityNumber: SeverityNumber.DEBUG,
                  body: `auth_token: ${authTokenCookie?.value}`,
                });

                // Update account state with working token
                if (authTokenCookie && authTokenCookie.value) {
                  account.authToken = authTokenCookie.value;
                  account.tokenState = 'working';
                  account.failedLogin = false;
                  account.lastUsed = Date.now();
                  this.db.write();
                }
                return { scraper, account };
              } else {
                throw new Error('Failed to log in');
              }
            } catch (error) {
              usernamesBeingUsed.delete(account.username);
              console.error(
                `Couldn't login into @${account.username}:`,
                (error as Error).toString(),
              );

              account.tokenState = 'failed';
              account.failedLogin = true;
              account.lastFailedAt = Date.now();
              this.db.write();

              // Special handling for rate limiting
              if ((error as Error).toString().includes('ArkoseLogin')) {
                await wait(30 * 1000); // Wait 30 seconds before trying another account
              }
            } finally {
              i++;
            }
          }
          throw new Error('No accounts available for login');
        },
        destroy(resource) {
          usernamesBeingUsed.delete(resource.account.username);
        },
        async validate(resource) {
          const loggedIn = await resource.scraper.isLoggedIn();
          if (!loggedIn) {
            throw new Error('Not logged in');
          }
        },
      },
      {
        min: 1,
        minIdle: 1,
        max: 10,
        acquireMaxRetries: 5,
      },
    );
  }

  /**
   * Add accounts to the manager
   */
  addAccounts(newAccounts: AccountInfo[]): void {
    newAccounts.forEach((account) => {
      if (account.username) {
        this.db.data.accounts.push({
          ...account,
          tokenState: 'unknown',
          failedLogin: false,
        });
      }
    });
    this.db.write();
  }

  deleteAccount(username: string): boolean {
    const initialLength = this.db.data.accounts.length;
    this.db.data.accounts = this.db.data.accounts.filter(
      (account) => account.username !== username,
    );

    if (this.db.data.accounts.length !== initialLength) {
      this.db.write();
      return true;
    }

    return false;
  }

  getAllAccounts(): AccountState[] {
    return this.db.data.accounts;
  }

  get hasAccountsAvailable(): boolean {
    return this.db.data.accounts.some((a) => !a.failedLogin);
  }

  /**
   * Create a TwitterAuth instance that uses the account manager
   */
  createAuthInstance(): TwitterAuth {
    return new TwitterPoolAuth(this.pool, this.db);
  }

  public resetFailedLogins(): void {
    this.db.data.accounts.forEach((account) => {
      account.failedLogin = false;
    });
    this.db.write();
  }
}

export const accountManager = new AccountManager([], {
  statePath:
    process.env.ACCOUNTS_STATE_PATH ||
    path.join(process.cwd(), 'accounts-state.json'),
});

class TwitterPoolAuth implements TwitterAuth {
  private pool: Pool<{ scraper: Scraper; account: AccountState }>;
  private db: ReturnType<typeof JSONFileSyncPreset<DbData>>;
  private currentResource: { scraper: Scraper; account: AccountState } | null =
    null;

  constructor(
    pool: Pool<{ scraper: Scraper; account: AccountState }>,
    db: ReturnType<typeof JSONFileSyncPreset<DbData>>,
  ) {
    this.pool = pool;
    this.db = db;
  }

  cookieJar(): CookieJar {
    if (!this.currentResource) {
      return new CookieJar();
    }
    return this.currentResource.scraper.auth.cookieJar();
  }

  async isLoggedIn(): Promise<boolean> {
    // This is handled at the pool level
    return true;
  }

  async login(
    username: string,
    password: string,
    email?: string,
    twoFactorSecret?: string,
  ): Promise<void> {
    throw new Error('Login is handled at the pool level');
  }

  async logout(): Promise<void> {
    throw new Error('Logout is handled at the pool level');
  }

  deleteToken(): void {
    // No-op as tokens are managed at the pool level
  }

  hasToken(): boolean {
    // Assume we always have a token available through the pool
    return true;
  }

  authenticatedAt(): Date | null {
    // We don't track this at this level
    return new Date();
  }

  async installTo(headers: Headers, url: string): Promise<void> {
    // noop, handled at the pool level
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const resource = await this.pool.acquire();
    this.currentResource = resource;
    try {
      const headers = new Headers(init?.headers);
      await resource.scraper.auth.installTo(
        headers,
        input instanceof Request ? input.url : input.toString(),
      );

      const response = await resource.scraper.auth.fetch(input, {
        ...init,
        headers,
        proxy: process.env.PROXY_URI,
      });

      // Handle rate limiting
      if (response.status === 429) {
        console.warn(`Rate limited, retrying with another account`);
        const ratelimitUntil = new Date(
          parseInt(response.headers.get('x-rate-limit-reset') || '0') * 1000,
        );
        resource.account.rateLimitedUntil = ratelimitUntil.getTime();
        this.db.write();
        throw new Error('Rate limited');
      }

      // Handle suspended account
      if (response.status === 403) {
        console.warn(`403, retrying with another account`);
        await this.pool.release(resource);
        throw new Error('Account probably suspended');
      }

      // Clone response so we can read the body and still return it
      const clonedResponse = response.clone();
      try {
        const json = await clonedResponse.json();
        if (
          'errors' in (json as any) &&
          (json as any).errors != null &&
          (json as any).errors.length > 0 &&
          (json as any).errors[0].message.includes(
            'Authorization: Denied by access control',
          )
        ) {
          console.warn(`Error in response, retrying with another account`);
          // TODO: revisar que es lo correcto en estas situaciones
          resource.account.tokenState = 'failed';
          this.db.write();
          throw new Error('Account probably suspended');
        }

        return new Response(JSON.stringify(json), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (e) {
        // If we can't parse JSON, just return the original response
        return response;
      }
    } catch (error) {
      // If there's an error, we'll release the resource and let the pool handle it
      return await this.fetch(input, init);
    } finally {
      this.currentResource = null;
      await this.pool.release(resource);
    }
  }
}
