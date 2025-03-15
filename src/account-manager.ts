import { CookieJar, Cookie } from 'tough-cookie';
import { Scraper } from './scraper';
import { type TwitterAuth, TwitterGuestAuth } from './auth';
import { Headers } from 'headers-polyfill';

// Account information type
export type AccountInfo = {
  username: string;
  password: string;
  email: string;
  emailPassword: string;
  authToken: string;
  twoFactorSecret: string;
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
  wait: number = 1000,
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
  private accounts: AccountInfo[] = [];
  private cookieJar = new CookieJar();
  private loggedIn = false;
  private failedAccountUsernames = new Set<string>();
  public static DEFAULT_BEARER_TOKEN =
    'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  private currentUsername: string | null = null;

  constructor(accounts: AccountInfo[] = []) {
    this.accounts = accounts;
  }

  /**
   * Add accounts to the manager
   */
  addAccounts(newAccounts: AccountInfo[]): void {
    this.accounts.push(...newAccounts);
  }

  /**
   * Get the current list of accounts
   */
  getAccounts(): AccountInfo[] {
    return [...this.accounts];
  }

  /**
   * Get a summary of accounts (non-sensitive data only)
   */
  getAccountSummaries() {
    return this.accounts.map((account, index) => ({
      id: `${account.username}_${index}`,
      username: account.username,
      hasAuthToken: !!account.authToken,
      has2FA: !!account.twoFactorSecret,
      isCurrentlyActive: this.currentUsername === account.username,
    }));
  }

  /**
   * Check if the manager has accounts
   */
  hasAccounts(): boolean {
    return this.accounts.length > 0;
  }

  /**
   * Check if the manager is logged in
   */
  isLoggedIn(): boolean {
    return this.loggedIn;
  }

  /**
   * Get the current cookie jar
   */
  getCookieJar(): CookieJar {
    return this.cookieJar;
  }

  /**
   * Get the current username (if logged in)
   */
  getCurrentUsername(): string | null {
    return this.currentUsername;
  }

  /**
   * Log in to a Twitter account
   * Tries to log in with a random account, rotating through accounts on failure
   */
  logIn = pDebounce(async () => {
    if (this.loggedIn) return;

    if (!this.hasAccounts()) {
      throw new Error('No accounts available for login');
    }

    // Reset login state
    this.cookieJar = new CookieJar();
    this.loggedIn = false;
    this.currentUsername = null;

    // Keep trying to log into accounts unless all don't work
    while (!this.loggedIn) {
      let account: AccountInfo;
      do {
        if (this.failedAccountUsernames.size >= this.accounts.length) {
          console.error('Resetting failed accounts list');
          this.failedAccountUsernames = new Set();
        }
        account =
          this.accounts[Math.floor(Math.random() * this.accounts.length)];
      } while (this.failedAccountUsernames.has(account.username));

      try {
        const scraper = new Scraper();

        try {
          if (!account.authToken) throw new Error('No auth token available');
          await scraper.loginWithToken(account.authToken);
          this.loggedIn = await scraper.isLoggedIn();
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
          this.loggedIn = await scraper.isLoggedIn();
        }

        if (this.loggedIn) {
          console.debug(`Logged into @${account.username}`);
          this.currentUsername = account.username;
          const cookies = await scraper.getCookies();
          console.debug(
            `auth_token: ${cookies.find((c) => c.key === 'auth_token')?.value}`,
          );

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
        this.failedAccountUsernames.add(account.username);

        // Special handling for rate limiting
        if ((error as Error).toString().includes('ArkoseLogin')) {
          await wait(30 * 1000); // Wait 30 seconds before trying another account
        }
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
      if (!self.loggedIn) {
        console.debug("Tried to request but wasn't logged in");
        await self.logIn();
      }

      const headers = new Headers(init?.headers);
      {
        headers.set(
          'cookie',
          self.cookieJar.getCookieStringSync(input.toString()),
        );
        const cookies = await self.cookieJar.getCookies(input.toString());
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
        self.cookieJar = new CookieJar();
        self.loggedIn = false;
        self.currentUsername = null;
        console.warn(`Rate limited, retrying with another account`);
        return await fetchWithAuthenticatedAccount(input, init);
      }

      // Handle suspended account
      if (response.status === 403) {
        self.cookieJar = new CookieJar();
        self.loggedIn = false;
        self.currentUsername = null;
        console.warn(`403, retrying with another account`);
        return await fetchWithAuthenticatedAccount(input, init);
      }

      // Clone response so we can read the body and still return it
      const clonedResponse = response.clone();
      try {
        const json = await clonedResponse.json();
        if (
          'errors' in (json as any) &&
          (json as any).errors != null &&
          (json as any).errors.length > 0
        ) {
          self.cookieJar = new CookieJar();
          self.loggedIn = false;
          self.currentUsername = null;
          console.warn(`Error in response, retrying with another account`);
          return await fetchWithAuthenticatedAccount(input, init);
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

    // Create a custom installTo function that matches the interface but handles our logic
    // @ts-ignore - We need to override the method signature to accept the URL parameter
    auth.installTo = async function (
      headers: Headers,
      url?: string,
    ): Promise<void> {
      if (self.hasAccounts() && !self.isLoggedIn()) {
        await self.logIn();
      }

      if (self.isLoggedIn()) {
        // Use the account manager's cookie jar
        const urlString = url || 'https://twitter.com';
        headers.set('cookie', self.cookieJar.getCookieStringSync(urlString));
        const cookies = await self.cookieJar.getCookies(urlString);
        const xCsrfToken = cookies.find((cookie) => cookie.key === 'ct0');
        if (xCsrfToken) {
          headers.set('x-csrf-token', xCsrfToken.value);
        }
        headers.set(
          'authorization',
          `Bearer ${AccountManager.DEFAULT_BEARER_TOKEN}`,
        );
      } else {
        // Fall back to guest auth by setting basic headers
        headers.set(
          'authorization',
          `Bearer ${AccountManager.DEFAULT_BEARER_TOKEN}`,
        );
      }
    };

    return auth;
  }
}
