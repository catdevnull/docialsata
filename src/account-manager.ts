import { CookieJar } from 'tough-cookie';
import { Scraper } from './scraper.js';
import { type TwitterAuth } from './auth.js';
import path, { join } from 'path';
import { JSONFileSyncPreset } from 'lowdb/node';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { logger } from './apid/tracing.js';

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
  assignedProxy?: string;
};

type DbData = {
  accounts: AccountState[];
  lastSaved?: number;
};

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
  return csvish
    .split(/\r?\n/g)
    .filter((s) => !!s)
    .map((line, index) => {
      const values = line.match(exp)?.groups;
      if (!values) {
        throw new Error(
          `Couldn't match line ${index + 1} with regexp \`${regexp}\``,
        );
      }
      return values as unknown as AccountInfo;
    });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gets a list of proxies from PROXY_LIST environment variable
 * @returns Array of proxy URIs or null if PROXY_LIST is not defined
 */
function getProxyList(): string[] | null {
  if (!process.env.PROXY_LIST) {
    return null;
  }

  return process.env.PROXY_LIST.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Assigns a proxy to an account if not already assigned
 * @param account Account to assign proxy to
 * @returns The assigned proxy URI or undefined if no proxies available
 */
function assignProxyToAccount(account: AccountState): string | undefined {
  if (account.assignedProxy) {
    return account.assignedProxy;
  }

  const proxyList = getProxyList();
  if (!proxyList || proxyList.length === 0) {
    return process.env.PROXY_URI;
  }

  const randomIndex = Math.floor(Math.random() * proxyList.length);
  account.assignedProxy = proxyList[randomIndex];
  return account.assignedProxy;
}

async function telemetryFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const tracer = trace.getTracer('fetch-tracer');
  const urlString =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
  const method = init?.method || 'GET';

  return tracer.startActiveSpan(
    `fetch ${method} ${urlString}`,
    async (span) => {
      try {
        span.setAttributes({
          'http.url': urlString,
          'http.method': method,
        });
        const response = await fetch(input, init);
        span.setAttributes({
          'http.status_code': response.status,
          'http.status_text': response.statusText,
        });
        span.setStatus({
          code: response.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        });
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

type ActiveAccount = {
  scraper: Scraper;
  accountState: AccountState;
};

export class AccountManager {
  private db: ReturnType<typeof JSONFileSyncPreset<DbData>>;
  private activeAccounts: ActiveAccount[] = [];
  private roundRobinIndex = 0;
  private poolSize = 5;
  private initializationPromise: Promise<void> | null = null;
  private readonly logger = logger.child({
    module: 'AccountManager',
  });

  constructor() {
    {
      const DB_PATH = process.env.ACCOUNTS_STATE_PATH || 'accounts-state.json';
      this.db = JSONFileSyncPreset<DbData>(DB_PATH, { accounts: [] });
      this.logger.debug(
        `AccountManager constructed. DB loaded from ${DB_PATH}.`,
      );
    }

    this.logger.info(`Starting background pool initialization.`);
    this.initializationPromise = this._initializePool();
    this.initializationPromise.catch((error) => {
      this.logger.error(
        `Unhandled error during background pool initialization: ${
          (error as Error)?.message
        }`,
      );
    });
  }

  private async _initializePool(): Promise<void> {
    this.logger.info(
      `Starting _initializePool (target size: ${this.poolSize})...`,
    );
    this.activeAccounts = [];

    const candidateAccounts = this.db.data.accounts
      .filter((a) => !a.failedLogin)
      .sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0));

    this.logger.debug(
      `Found ${candidateAccounts.length} potential candidates for the pool.`,
    );

    for (const account of candidateAccounts) {
      if (this.activeAccounts.length >= this.poolSize) {
        this.logger.debug(
          `Reached pool size limit (${this.poolSize}). Stopping initialization loop.`,
        );
        break;
      }

      if (
        account.failedLogin ||
        (account.rateLimitedUntil && account.rateLimitedUntil > Date.now())
      ) {
        this.logger.debug(
          `Skipping candidate @${account.username} (failedLogin: ${
            account.failedLogin
          }, rateLimitedUntil: ${
            account.rateLimitedUntil
              ? new Date(account.rateLimitedUntil).toISOString()
              : 'N/A'
          })`,
        );
        continue;
      }

      // Assign a proxy to the account if needed
      assignProxyToAccount(account);
      this.logger.debug(
        `Attempting to initialize @${account.username}${
          account.assignedProxy ? ` with proxy ${account.assignedProxy}` : ''
        }...`,
      );

      try {
        const scraper = new Scraper({ fetch: telemetryFetch });
        let loggedIn = false;

        if (account.authToken) {
          try {
            this.logger.trace(
              `Attempting token login for @${account.username}...`,
            );
            await scraper.loginWithToken(account.authToken);
            loggedIn = await scraper.isLoggedIn();
            if (!loggedIn) {
              this.logger.warn(
                `Token login failed for @${account.username}. Clearing token.`,
              );
              account.tokenState = 'failed';
              account.authToken = '';
              this.db.write();
            } else {
              this.logger.trace(
                `Token login successful for @${account.username}.`,
              );
            }
          } catch (tokenError) {
            this.logger.warn(
              `Token login error for @${account.username}: ${
                (tokenError as Error).message
              }. Clearing token.`,
            );
            account.tokenState = 'failed';
            account.authToken = '';
            this.db.write();
          }
        }

        if (!loggedIn) {
          this.logger.debug(
            `Attempting user/pass login for @${account.username}...`,
          );
          await scraper.login(
            account.username,
            account.password,
            account.email,
            account.twoFactorSecret,
            account.emailPassword,
          );
          loggedIn = await scraper.isLoggedIn();
        }

        if (loggedIn) {
          const cookies = await scraper.getCookies();
          const authTokenCookie = cookies.find((c) => c.key === 'auth_token');
          this.logger.info(
            `Successfully initialized and logged into @${account.username}. Added to active pool.`,
          );

          account.tokenState = 'working';
          account.failedLogin = false;
          if (
            authTokenCookie?.value &&
            account.authToken !== authTokenCookie.value
          ) {
            account.authToken = authTokenCookie.value;
            this.logger.debug(`Updated auth token for @${account.username}.`);
          }
          account.lastUsed = Date.now();
          this.db.write();

          this.activeAccounts.push({ scraper, accountState: account });
        } else {
          this.logger.error(
            `Login attempt sequence completed for @${account.username}, but still not logged in.`,
          );
          throw new Error('Failed to log in with token or username/password.');
        }
      } catch (error) {
        this.logger.error(
          `Initialization failed for @${account.username}: ${
            (error as Error).message
          }`,
        );
        account.tokenState = 'failed';
        account.failedLogin = true;
        account.lastFailedAt = Date.now();
        this.db.write();
        if ((error as Error).message.includes('Arkose')) {
          await wait(5000);
        }
      }
    }

    if (this.activeAccounts.length === 0) {
      this.logger.error(
        `Pool initialization finished, but NO accounts are currently active.`,
      );
    } else {
      this.logger.info(
        `Pool initialization finished. ${this.activeAccounts.length} active accounts.`,
      );
    }
  }

  public async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.logger.warn(
        `ensureInitialized called but initializationPromise is null. Triggering _initializePool now.`,
      );
      this.initializationPromise = this._initializePool();
      this.initializationPromise.catch((error) => {
        this.logger.error(
          `Unhandled error during late pool initialization: ${
            (error as Error)?.message
          }`,
        );
      });
    }
    this.logger.trace(`ensureInitialized: Awaiting initializationPromise...`);
    await this.initializationPromise;
    this.logger.trace(
      `ensureInitialized: initializationPromise resolved. Active accounts: ${this.activeAccounts.length}`,
    );

    if (this.activeAccounts.length === 0) {
      this.logger.error(
        `ensureInitialized: Pool is initialized but contains no active accounts.`,
      );
      throw new Error(
        'Account pool is empty or failed to initialize properly.',
      );
    }
  }

  public async getNextAccount(): Promise<ActiveAccount | null> {
    this.logger.trace(`getNextAccount called. Ensuring initialized...`);
    await this.ensureInitialized();

    const poolSize = this.activeAccounts.length;
    if (poolSize === 0) {
      this.logger.warn(
        `getNextAccount: No accounts in the active pool after initialization.`,
      );
      return null;
    }

    const initialIndex = this.roundRobinIndex;
    for (let i = 0; i < poolSize; i++) {
      const currentIndex = (initialIndex + i) % poolSize;
      const activeAccount = this.activeAccounts[currentIndex];

      const rateLimitedUntil = activeAccount.accountState.rateLimitedUntil;
      if (rateLimitedUntil && rateLimitedUntil > Date.now()) {
        this.logger.debug(
          `getNextAccount: Skipping @${
            activeAccount.accountState.username
          } (rate-limited until ${new Date(rateLimitedUntil).toISOString()})`,
        );
        continue;
      } else if (rateLimitedUntil) {
        this.logger.info(
          `getNextAccount: Cleared expired rate limit for @${activeAccount.accountState.username}`,
        );
        activeAccount.accountState.rateLimitedUntil = undefined;
        this.db.write();
      }

      this.roundRobinIndex = (currentIndex + 1) % poolSize;
      activeAccount.accountState.lastUsed = Date.now();
      this.logger.debug(
        `getNextAccount: Providing account @${activeAccount.accountState.username}`,
      );
      return activeAccount;
    }

    this.logger.warn(
      `getNextAccount: Looped through all ${poolSize} active accounts, but none are currently usable (all rate-limited?).`,
    );
    return null;
  }

  public updateRateLimit(username: string, until: number | undefined): void {
    const account = this.db.data.accounts.find((a) => a.username === username);
    if (account) {
      account.rateLimitedUntil = until;
      if (until) {
        this.logger.warn(
          `Account @${username} rate-limited until ${new Date(
            until,
          ).toISOString()}`,
        );
      } else {
        this.logger.info(`Cleared rate limit for @${username}`);
      }
      this.db.write();
    } else {
      this.logger.warn(
        `updateRateLimit: Could not find account @${username} in DB to update status.`,
      );
    }
  }

  public markFailed(username: string): void {
    const account = this.db.data.accounts.find((a) => a.username === username);
    if (account) {
      account.failedLogin = true;
      account.tokenState = 'failed';
      account.lastFailedAt = Date.now();
      this.logger.error(`Account @${username} marked as failed in DB.`);
      this.db.write();

      const activeIndex = this.activeAccounts.findIndex(
        (a) => a.accountState.username === username,
      );
      if (activeIndex > -1) {
        this.activeAccounts.splice(activeIndex, 1);
        this.logger.info(
          `Removed @${username} from active pool due to failure. Active count: ${this.activeAccounts.length}. Triggering pool replenishment.`,
        );
        this.initializationPromise = this._initializePool();
        this.initializationPromise.catch((error) => {
          this.logger.error(
            `Unhandled error during background pool replenishment after delete: ${
              (error as Error)?.message
            }`,
          );
        });
      }
    } else {
      this.logger.warn(
        `markFailed: Could not find account @${username} in DB to mark as failed.`,
      );
    }
  }

  addAccounts(newAccounts: AccountInfo[]): void {
    let added = false;
    newAccounts.forEach((account) => {
      if (
        account.username &&
        !this.db.data.accounts.some((a) => a.username === account.username)
      ) {
        const accountState: AccountState = {
          ...account,
          tokenState: 'unknown',
          failedLogin: false,
        };

        assignProxyToAccount(accountState);
        if (accountState.assignedProxy) {
          this.logger.debug(
            `Assigned proxy ${accountState.assignedProxy} to new account @${account.username}`,
          );
        }

        this.db.data.accounts.push(accountState);
        added = true;
      }
    });
    if (added) {
      this.logger.info(
        `Added accounts via addAccounts. Triggering pool re-initialization.`,
      );
      this.db.write();
      this.initializationPromise = this._initializePool();
      this.initializationPromise.catch((error) => {
        this.logger.error(
          `Unhandled error during pool re-initialization after addAccounts: ${
            (error as Error)?.message
          }`,
        );
      });
    }
  }

  deleteAccount(username: string): boolean {
    const initialLength = this.db.data.accounts.length;
    this.db.data.accounts = this.db.data.accounts.filter(
      (a) => a.username !== username,
    );
    const changed = this.db.data.accounts.length !== initialLength;

    if (changed) {
      this.logger.info(`Deleted @${username} from DB.`);
      this.db.write();
      const activeIndex = this.activeAccounts.findIndex(
        (a) => a.accountState.username === username,
      );
      if (activeIndex > -1) {
        this.activeAccounts.splice(activeIndex, 1);
        this.logger.info(
          `Removed @${username} from active pool. Active count: ${this.activeAccounts.length}. Triggering pool replenishment.`,
        );
        this.initializationPromise = this._initializePool();
        this.initializationPromise.catch((error) => {
          this.logger.error(
            `Unhandled error during background pool replenishment after delete: ${
              (error as Error)?.message
            }`,
          );
        });
      }
    }
    return changed;
  }

  getAllAccounts(): AccountState[] {
    return this.db.data.accounts;
  }
  getActivePoolAccounts(): ActiveAccount[] {
    return this.activeAccounts;
  }
  get hasAccountsAvailable(): boolean {
    const dbHasPotential = this.db.data.accounts.some((a) => !a.failedLogin);
    const poolIsActive =
      this.initializationPromise != null && this.activeAccounts.length > 0;
    return dbHasPotential || poolIsActive;
  }

  createAuthInstance(): TwitterAuth {
    return new TwitterPoolAuth(this);
  }

  public resetFailedLogins(): void {
    this.logger.info(`Resetting failed/rate-limit status for all accounts.`);

    const hasProxyList = !!getProxyList();

    this.db.data.accounts.forEach((account) => {
      account.failedLogin = false;
      account.tokenState = 'unknown';
      account.lastFailedAt = undefined;
      account.rateLimitedUntil = undefined;

      account.assignedProxy = undefined;
      if (!account.assignedProxy && hasProxyList) {
        assignProxyToAccount(account);
        if (account.assignedProxy) {
          this.logger.debug(
            `Assigned proxy ${account.assignedProxy} to reset account @${account.username}`,
          );
        }
      }
    });
    this.db.write();
    this.logger.info(`Triggering full pool re-initialization after reset.`);
    this.initializationPromise = this._initializePool();
    this.initializationPromise.catch((error) => {
      this.logger.error(
        `Unhandled error during pool re-initialization after reset: ${
          (error as Error)?.message
        }`,
      );
    });
  }
}

export const accountManager = new AccountManager();

class TwitterPoolAuth implements TwitterAuth {
  private manager: AccountManager;
  private readonly logger = logs.getLogger('docial-auth', '0.0.0');

  constructor(manager: AccountManager) {
    this.manager = manager;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const activePoolSize = this.manager.getActivePoolAccounts().length;
    const maxRetries = Math.max(activePoolSize, 1);
    this.logger.emit({
      severityNumber: SeverityNumber.TRACE,
      body: `TwitterPoolAuth.fetch called. Max retries: ${maxRetries}`,
    });

    const triedUsernames = new Set<string>();
    const url = input instanceof Request ? input.url : input.toString();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.logger.emit({
        severityNumber: SeverityNumber.TRACE,
        body: `Fetch attempt ${attempt}/${maxRetries}. Getting next account...`,
      });
      const activeAccount = await this.manager.getNextAccount();

      if (!activeAccount) {
        this.logger.emit({
          severityNumber: SeverityNumber.WARN,
          body: `Fetch attempt ${attempt}/${maxRetries}: No accounts available from getNextAccount(). Waiting...`,
        });
        await wait(5000);
        continue;
      }

      const username = activeAccount.accountState.username;
      if (triedUsernames.has(username)) {
        this.logger.emit({
          severityNumber: SeverityNumber.DEBUG,
          body: `Fetch attempt ${attempt}/${maxRetries}: Already tried @${username} in this fetch call. Skipping.`,
        });
        if (triedUsernames.size >= activePoolSize) {
          this.logger.emit({
            severityNumber: SeverityNumber.WARN,
            body: `Fetch attempt ${attempt}/${maxRetries}: All ${activePoolSize} active accounts already tried and failed in this fetch call.`,
          });
          break;
        }
        continue;
      }
      triedUsernames.add(username);

      try {
        this.logger.emit({
          severityNumber: SeverityNumber.DEBUG,
          body: `Fetch attempt ${attempt}/${maxRetries} using @${username} for URL: ${url}`,
        });

        const scraper = activeAccount.scraper;
        const headers = new Headers(init?.headers);
        await scraper.auth.installTo(headers, url);
        this.logger.emit({
          severityNumber: SeverityNumber.TRACE,
          body: `Auth headers installed for @${username}.`,
        });

        const response = await telemetryFetch(input, {
          ...init,
          headers,
          proxy:
            activeAccount.accountState.assignedProxy || process.env.PROXY_URI,
        });
        this.logger.emit({
          severityNumber: SeverityNumber.TRACE,
          body: `Fetch response received for @${username}: ${response.status}`,
        });

        if (response.ok) {
          this.logger.emit({
            severityNumber: SeverityNumber.DEBUG,
            body: `Fetch successful for @${username} (Status: ${response.status})`,
          });
          return response;
        }

        this.logger.emit({
          severityNumber: SeverityNumber.WARN,
          body: `Fetch failed for @${username} (Status: ${response.status}) on URL: ${url}.`,
        });

        if (response.status === 429) {
          const resetHeader = response.headers.get('x-rate-limit-reset');
          const until = resetHeader
            ? parseInt(resetHeader, 10) * 1000
            : Date.now() + 5 * 60 * 1000;
          this.logger.emit({
            severityNumber: SeverityNumber.WARN,
            body: `Rate limit (429) hit for @${username}. Marking limited until ${new Date(
              until,
            ).toISOString()}.`,
          });
          this.manager.updateRateLimit(username, until);
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          this.logger.emit({
            severityNumber: SeverityNumber.ERROR,
            body: `Auth error (${response.status}) for @${username}. Marking as failed.`,
          });
          this.manager.markFailed(username);
          continue;
        }

        this.logger.emit({
          severityNumber: SeverityNumber.WARN,
          body: `Non-critical error status ${response.status} for @${username}. Trying next account.`,
        });
        continue;
      } catch (error) {
        this.logger.emit({
          severityNumber: SeverityNumber.ERROR,
          body: `Network error for @${username}: ${
            (error as Error).message
          }. Marking as failed.`,
        });
        this.manager.markFailed(username);
        continue;
      }
    }

    this.logger.emit({
      severityNumber: SeverityNumber.ERROR,
      body: `Fetch failed for ${url} after exhausting all ${maxRetries} retry attempts.`,
    });
    throw new Error(
      `Failed to fetch ${url} after trying ${triedUsernames.size} accounts.`,
    );
  }

  cookieJar(): CookieJar {
    return new CookieJar();
  }
  async isLoggedIn(): Promise<boolean> {
    try {
      await this.manager.ensureInitialized();
      return this.manager.getActivePoolAccounts().length > 0;
    } catch (initError) {
      return false;
    }
  }
  async login(): Promise<void> {
    throw new Error('Login managed by AccountManager pool.');
  }
  async logout(): Promise<void> {
    throw new Error('Logout managed by AccountManager pool.');
  }
  deleteToken(): void {
    throw new Error('Tokens managed by AccountManager pool.');
  }
  hasToken(): boolean {
    return this.manager.getActivePoolAccounts().length > 0;
  }
  authenticatedAt(): Date | null {
    return new Date();
  }
  async installTo(): Promise<void> {
    /* No-op: handled within fetch */
  }
}
