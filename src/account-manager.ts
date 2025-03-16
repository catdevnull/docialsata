import { CookieJar, Cookie } from 'tough-cookie';
import { Scraper } from './scraper.js';
import { type TwitterAuth, TwitterGuestAuth } from './auth.js';
import { Headers } from 'headers-polyfill';
import path, { join } from 'path';
import { JSONFileSyncPreset } from 'lowdb/node';

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
function pDebounce<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  wait: number = 0,
) {
  let pending: Promise<any> | null = null;
  const debounced = ((...args: Parameters<T>) => {
    if (!pending) {
      pending = fn(...args).finally(() => {
        const timeout = setTimeout(() => {
          pending = null;
        }, wait);
        // Ensure the timeout is cleared if the process exits
        if (timeout.unref) timeout.unref();
      });
    }
    return pending;
  }) as T;

  return debounced;
}

/**
 * Account manager for Twitter scraping
 * Handles account rotation, authentication, and cookie management
 */
export class AccountManager {
  private cookieJar = new CookieJar();
  private currentAccount: AccountState | null = null;
  public static DEFAULT_BEARER_TOKEN =
    'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  private db: ReturnType<typeof JSONFileSyncPreset<DbData>>;

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
  isLoggedIn(): boolean {
    return !!this.currentAccount;
  }

  get hasAccountsAvailable(): boolean {
    return this.db.data.accounts.some((a) => !a.failedLogin);
  }

  /**
   * Log in to a Twitter account
   * Tries to log in with a random account, rotating through accounts on failure
   */
  logIn = pDebounce(async () => {
    const loggingableAccounts = this.db.data.accounts
      .filter(
        (a) =>
          !a.failedLogin &&
          a.username !== this.currentAccount?.username &&
          (!a.rateLimitedUntil || a.rateLimitedUntil < Date.now()),
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

    this.cookieJar = new CookieJar();
    this.currentAccount = null;

    // Keep trying to log into accounts unless all don't work
    let i = 0;
    while (!this.isLoggedIn()) {
      let account: AccountState;
      account = loggingableAccounts[i];

      try {
        const scraper = new Scraper();

        try {
          if (!account.authToken) throw new Error('No auth token available');
          await scraper.loginWithToken(account.authToken);
          if (await scraper.isLoggedIn()) {
            this.currentAccount = account;
          }
        } catch (error) {
          if (account.username && account.password) {
            console.warn(
              `Couldn't log in with authToken, logging in with username/password. Error:`,
              (error as Error).toString(),
            );
          } else {
            console.warn(
              `Couldn't log in with authToken, and no username/password provided. Error:`,
              (error as Error).toString(),
            );
            throw error;
          }

          await scraper.login(
            account.username,
            account.password,
            account.email,
            account.twoFactorSecret,
          );
          if (await scraper.isLoggedIn()) {
            this.currentAccount = account;
          }
        }

        if (this.isLoggedIn()) {
          console.debug(`Logged into @${account.username}`);
          const cookies = await scraper.getCookies();
          const authTokenCookie = cookies.find((c) => c.key === 'auth_token');
          console.debug(`auth_token: ${authTokenCookie?.value}`);

          // Update account state with working token
          if (authTokenCookie && authTokenCookie.value) {
            account.authToken = authTokenCookie.value;
            account.tokenState = 'working';
            account.failedLogin = false;
            account.lastUsed = Date.now();
          }
          this.db.write();

          // Transfer cookies to our jar
          for (const cookie of cookies) {
            await this.cookieJar.setCookie(
              cookie.toString(),
              'https://twitter.com',
            );
          }
        }
      } catch (error) {
        console.error(
          `Couldn't login into @${account.username}:`,
          (error as Error).toString(),
        );

        // Update account state to mark as failed
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
  });

  /**
   * Create a fetch function that uses the authenticated account
   * Automatically rotates accounts on rate limits or errors
   */
  createAuthenticatedFetch() {
    const self = this;

    return async function fetchWithAuthenticatedAccount(
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> {
      if (!self.isLoggedIn()) {
        console.debug("Tried to request but wasn't logged in");
        await self.logIn();
      }

      const headers = new Headers(init?.headers);
      {
        headers.set(
          'cookie',
          self.cookieJar.getCookieStringSync('https://twitter.com'),
        );
        const cookies = await self.cookieJar.getCookies('https://twitter.com');
        const xCsrfToken = cookies.find((cookie) => cookie.key === 'ct0');
        if (xCsrfToken) {
          headers.set('x-csrf-token', xCsrfToken.value);
        }
      }

      const response = await fetch(input, { ...init, headers });
      {
        const cookieHeader = response.headers.get('set-cookie');
        if (cookieHeader) {
          const cookie = Cookie.parse(cookieHeader);
          if (cookie) await self.cookieJar.setCookie(cookie, response.url);
        }
      }

      // Handle rate limiting
      if (response.status === 429) {
        console.warn(`Rate limited, retrying with another account`);
        const ratelimitUntil = new Date(
          parseInt(response.headers.get('x-rate-limit-reset') || '0') * 1000,
        );
        self.currentAccount!.rateLimitedUntil = ratelimitUntil.getTime();
        self.db.write();
        await self.logIn();
        return await fetchWithAuthenticatedAccount(input, init);
      }

      // Handle suspended account
      if (response.status === 403) {
        console.warn(`403, retrying with another account`);
        await self.logIn();
        return await fetchWithAuthenticatedAccount(input, init);
      }

      // Clone response so we can read the body and still return it
      const clonedResponse = response.clone();
      try {
        const json = await clonedResponse.json();
        // if (
        //   'errors' in (json as any) &&
        //   (json as any).errors != null &&
        //   (json as any).errors.length > 0
        // ) {
        //   console.warn(`Error in response, retrying with another account`);
        //   await self.logIn();
        //   return await fetchWithAuthenticatedAccount(input, init);
        // }

        return new Response(JSON.stringify(json), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (e) {
        // If we can't parse JSON, just return the original response
        return response;
      }
    };
  }

  /**
   * Create a Scraper instance with authenticated fetch
   */
  createScraper(): Scraper {
    return new Scraper({
      fetch: this.createAuthenticatedFetch() as any,
    });
  }

  /**
   * Create a TwitterAuth instance that uses the account manager
   */
  createAuthInstance(): TwitterAuth {
    const self = this;
    const auth = new TwitterGuestAuth(AccountManager.DEFAULT_BEARER_TOKEN);

    auth.fetch = this.createAuthenticatedFetch() as any;

    // // Create a custom installTo function that matches the interface but handles our logic
    // // @ts-ignore - We need to override the method signature to accept the URL parameter
    // auth.installTo = async function (
    //   headers: Headers,
    //   url?: string,
    // ): Promise<void> {
    //   if (self.hasAccountsAvailable && !self.isLoggedIn()) {
    //     await self.logIn();
    //   }

    //   if (self.isLoggedIn()) {
    //     const urlString = 'https://twitter.com';
    //     headers.set('cookie', self.cookieJar.getCookieStringSync(urlString));
    //     const cookies = await self.cookieJar.getCookies(urlString);
    //     const xCsrfToken = cookies.find((cookie) => cookie.key === 'ct0');
    //     if (xCsrfToken) {
    //       headers.set('x-csrf-token', xCsrfToken.value);
    //     }
    //     headers.set(
    //       'authorization',
    //       `Bearer ${AccountManager.DEFAULT_BEARER_TOKEN}`,
    //     );
    //   } else {
    //     headers.set(
    //       'authorization',
    //       `Bearer ${AccountManager.DEFAULT_BEARER_TOKEN}`,
    //     );
    //   }
    // };

    return auth;
  }
}

export const accountManager = new AccountManager([], {
  statePath:
    process.env.ACCOUNTS_STATE_PATH ||
    path.join(process.cwd(), 'accounts-state.json'),
});
