import {
  BEARER_TOKEN,
  type TwitterAuthOptions,
  TwitterGuestAuth,
} from './auth';
import { bearerToken, requestApi } from './api';
import { CookieJar } from 'tough-cookie';
import { updateCookieJar } from './requests';
import type { TwitterApiErrorRaw } from './errors';
import { Type, type Static } from '@sinclair/typebox';
import { Check } from '@sinclair/typebox/value';
import * as OTPAuth from 'otpauth';
import { fetchConfirmationCodeFromEmail } from './email-helper';
import { execSync } from 'child_process';
import { mkdtemp, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

interface TwitterUserAuthFlowInitRequest {
  flow_name: string;
  input_flow_data: Record<string, unknown>;
}

interface TwitterUserAuthFlowSubtaskRequest {
  flow_token: string;
  subtask_inputs: ({
    subtask_id: string;
  } & Record<string, unknown>)[];
}

type TwitterUserAuthFlowRequest =
  | TwitterUserAuthFlowInitRequest
  | TwitterUserAuthFlowSubtaskRequest;

interface TwitterUserAuthFlowResponse {
  errors?: TwitterApiErrorRaw[];
  flow_token?: string;
  status?: string;
  subtasks?: TwitterUserAuthSubtask[];
}

interface TwitterUserAuthVerifyCredentials {
  errors?: TwitterApiErrorRaw[];
}

const TwitterUserAuthSubtask = Type.Object({
  subtask_id: Type.String(),
  enter_text: Type.Optional(
    Type.Object({
      header: Type.Optional(
        Type.Object({
          primary_text: Type.Optional(
            Type.Object({
              text: Type.String(),
            }),
          ),
        }),
      ),
    }),
  ),
});
type TwitterUserAuthSubtask = Static<typeof TwitterUserAuthSubtask>;

type FlowTokenResultSuccess = {
  status: 'success';
  flowToken: string;
  subtask?: TwitterUserAuthSubtask;
};

type FlowTokenResult = FlowTokenResultSuccess | { status: 'error'; err: Error };

/**
 * A user authentication token manager.
 */
export class TwitterUserAuth extends TwitterGuestAuth {
  private initialHtmlContent: string | null = null;

  constructor(options?: Partial<TwitterAuthOptions>) {
    super(options);
  }

  async initTransactionIdGenerator(): Promise<void> {
    const MAX_REDIRECTS = 5;
    let currentUrl = 'https://x.com';
    let html = '';
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: await this.getCookieString(),
    };

    try {
      for (
        let redirectCount = 0;
        redirectCount < MAX_REDIRECTS;
        redirectCount++
      ) {
        const response = await this.fetch(currentUrl, { headers });
        await updateCookieJar(this.jar, response.headers);
        headers['Cookie'] = await this.getCookieString();

        if (!response.ok) {
          throw new Error(
            `Failed fetching ${currentUrl}: ${response.status} ${response.statusText}`,
          );
        }

        html = await response.text();

        // Check for meta refresh redirect
        const metaRefreshMatch = html.match(
          /<meta\s+http-equiv=["']refresh["']\s+content=["'][^;]+;\s*url=([^"']+)/i,
        );
        const migrationRedirectionRegex =
          /(http(?:s)?:\/\/(?:www\.)?(?:twitter|x)\.com(?:\/x)?\/migrate(?:[\/?])?tok=[a-zA-Z0-9%\-_]+)/i;
        const bodyMatch = html.match(migrationRedirectionRegex);
        let migrationUrl = metaRefreshMatch?.[1] || bodyMatch?.[0];

        if (migrationUrl) {
          currentUrl = migrationUrl;
          continue;
        }

        // Handle migration form
        const formMatch = html.match(
          /<form[^>]*?(?:name=["']f["']|action=["']https:\/\/x\.com\/x\/migrate["'])[^>]*>([\s\S]*?)<\/form>/i,
        );
        if (formMatch) {
          const formContent = formMatch[1];
          const actionMatch = formMatch[0].match(/action=["']([^"']+)["']/i);
          const methodMatch = formMatch[0].match(/method=["']([^"']+)["']/i);

          const formAction = actionMatch?.[1] || 'https://x.com/x/migrate';
          const formMethod = methodMatch?.[1]?.toUpperCase() || 'POST';
          const formUrl = new URL(formAction, currentUrl);
          if (!formUrl.searchParams.has('mx')) {
            formUrl.searchParams.set('mx', '2');
          }

          const payload = new URLSearchParams();
          const inputRegex =
            /<input[^>]*?name=["']([^"']+)["'][^>]*?(?:value=["']([^"']*)["'])?[^>]*?>/gi;
          let inputMatch;
          while ((inputMatch = inputRegex.exec(formContent)) !== null) {
            payload.append(inputMatch[1], inputMatch[2] || '');
          }

          const formHeaders = {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: currentUrl,
          };

          const response = await this.fetch(formUrl.toString(), {
            method: formMethod,
            headers: formHeaders,
            body: payload,
            redirect: 'manual',
          });
          await updateCookieJar(this.jar, response.headers);
          headers['Cookie'] = await this.getCookieString();

          if (
            response.status >= 300 &&
            response.status < 400 &&
            response.headers.has('location')
          ) {
            currentUrl = new URL(
              response.headers.get('location')!,
              currentUrl,
            ).toString();
            continue;
          }

          if (!response.ok) {
            throw new Error(
              `Migration form submission failed: ${response.status} ${response.statusText}`,
            );
          }

          html = await response.text();
          const subsequentMetaRefresh = html.match(
            /<meta\s+http-equiv=["']refresh["']\s+content=["'][^;]+;\s*url=([^"']+)/i,
          );
          const subsequentBodyMatch = html.match(migrationRedirectionRegex);

          if (subsequentMetaRefresh?.[1] || subsequentBodyMatch?.[0]) {
            currentUrl = subsequentMetaRefresh?.[1] || subsequentBodyMatch![0];
            if (!currentUrl.startsWith('http')) {
              currentUrl = new URL(currentUrl, response.url).toString();
            }
            continue;
          }
        }

        break;
      }

      if (!html) {
        throw new Error('Failed to retrieve HTML after potential migrations.');
      }

      this.initialHtmlContent = html;
    } catch (error: any) {
      this.initialHtmlContent = null;
      throw new Error(
        `Transaction ID initialization failed: ${error.message || error}`,
      );
    }
  }

  private async generateTransactionIdViaCli(
    method: string,
    path: string,
  ): Promise<string> {
    if (!this.initialHtmlContent) {
      throw new Error(
        'Initial HTML content is missing. Run initTransactionIdGenerator() first.',
      );
    }

    let tempDirPath: string | undefined;
    let tempHtmlPath: string | undefined;

    try {
      tempDirPath = await mkdtemp(join(tmpdir(), 'twitter-scraper-'));
      tempHtmlPath = join(tempDirPath, 'x-initial.html');

      await writeFile(tempHtmlPath, this.initialHtmlContent, 'utf-8');

      const cliScriptDir = join(
        process.cwd(),
        'src',
        'x-client-transaction-py',
      );
      const command = `uv run python -m x_client_transaction.cli --html-file "${tempHtmlPath}" --method "${method}" --path "${path}"`;

      const transactionId = execSync(command, {
        cwd: cliScriptDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

      if (!transactionId || transactionId.length < 10) {
        throw new Error(`Invalid transaction ID generated: '${transactionId}'`);
      }

      return transactionId;
    } catch (error: any) {
      throw new Error(
        `Failed to generate transaction ID: ${error.message || error}`,
      );
    } finally {
      if (tempHtmlPath) {
        try {
          await unlink(tempHtmlPath);
        } catch (cleanupError: any) {
          // Silently ignore cleanup errors
        }
      }
    }
  }

  async isLoggedIn(): Promise<boolean> {
    const res = await requestApi<TwitterUserAuthVerifyCredentials>(
      'https://api.twitter.com/1.1/account/verify_credentials.json',
      this,
    );
    if (!res.success) {
      return false;
    }

    const { value: verify } = res;
    return verify != null && (!verify.errors || verify.errors.length === 0);
  }

  async loginWithToken(token: string): Promise<void> {
    let ct0 = '';
    const choices = [...'0123456789abcdefghijklmnopqrstuvwxyz'.split('')];
    for (let i = 0; i < 160; i++) {
      ct0 += choices[Math.floor(Math.random() * choices.length)];
    }
    await this.jar.setCookie(`ct0=${ct0}`, 'https://x.com');

    await this.jar.setCookie(`auth_token=${token}`, 'https://x.com');

    try {
      await this.initTransactionIdGenerator();
    } catch (error: any) {
      console.warn(
        '[Login With Token] Failed to fetch initial HTML:',
        error.message || error,
      );
    }

    const headers = new Headers();
    await this.installTo(headers);

    const variables = {
      withCommunitiesMemberships: true,
    };
    const features = {
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
    };
    const fieldToggles = {
      isDelegate: false,
      withAuxiliaryUserLabels: false,
    };

    const viewerUrl = new URL(
      'https://twitter.com/i/api/graphql/HC-1ZetsBT1HKVUOvnLE8Q/Viewer',
    );
    viewerUrl.searchParams.set('variables', JSON.stringify(variables));
    viewerUrl.searchParams.set('features', JSON.stringify(features));
    viewerUrl.searchParams.set('fieldToggles', JSON.stringify(fieldToggles));

    try {
      console.log(
        `[Login With Token] Calling Viewer endpoint: ${viewerUrl.toString()}`,
      );
      const res = await this.fetch(viewerUrl.toString(), { headers });

      console.log(
        `[Login With Token] Viewer endpoint response status: ${res.status}`,
      );
      await updateCookieJar(this.jar, res.headers);

      if (!res.ok) {
        const responseBody = await res
          .text()
          .catch(() => 'Could not read response body');
        console.warn(
          `[Login With Token] Viewer endpoint call failed with status ${res.status}. Session might be invalid or require re-authentication. Body: ${responseBody}`,
        );
      } else {
        console.log('[Login With Token] Viewer endpoint call successful.');
      }
    } catch (error: any) {
      console.error(
        '[Login With Token] Error calling Viewer endpoint:',
        error.message || error,
      );
      throw error;
    }

    if (!(await this.isLoggedIn())) {
      console.warn(
        '[Login With Token] isLoggedIn() returned false after token setup and Viewer call.',
      );
    } else {
      console.log(
        '[Login With Token] isLoggedIn() returned true. Login likely successful.',
      );
    }
  }

  async login(
    username: string,
    password: string,
    email?: string,
    twoFactorSecret?: string,
    emailPassword?: string,
  ): Promise<void> {
    await this.updateGuestToken();

    try {
      await this.initTransactionIdGenerator();
    } catch (error: any) {
      console.warn(
        '[Login Flow] Failed to initialize HTML for transaction ID generation before login flow:',
        error.message || error,
      );
    }

    let next = await this.initLogin();

    while (next.status === 'success' && next.subtask) {
      const currentSubtaskId = next.subtask.subtask_id;
      console.log(`[Login Flow] Processing subtask: ${currentSubtaskId}`);

      if (currentSubtaskId === 'LoginJsInstrumentationSubtask') {
        next = await this.handleJsInstrumentationSubtask(next);
      } else if (currentSubtaskId === 'LoginEnterUserIdentifierSSO') {
        next = await this.handleEnterUserIdentifierSSO(next, username);
      } else if (currentSubtaskId === 'LoginEnterAlternateIdentifierSubtask') {
        if (!email) {
          throw new Error(
            "Subtask 'LoginEnterAlternateIdentifierSubtask' requires an email address, but none was provided.",
          );
        }
        next = await this.handleEnterAlternateIdentifierSubtask(next, email);
      } else if (currentSubtaskId === 'LoginEnterPassword') {
        next = await this.handleEnterPassword(next, password);
      } else if (currentSubtaskId === 'AccountDuplicationCheck') {
        next = await this.handleAccountDuplicationCheck(next);
      } else if (currentSubtaskId === 'LoginTwoFactorAuthChallenge') {
        if (twoFactorSecret) {
          next = await this.handleTwoFactorAuthChallenge(next, twoFactorSecret);
        } else {
          throw new Error(
            'Requested two factor authentication code but no secret provided',
          );
        }
      } else if (currentSubtaskId === 'LoginAcid') {
        next = await this.handleAcid(next, email, emailPassword);
      } else if (currentSubtaskId === 'LoginSuccessSubtask') {
        console.log(
          '[Login Flow] LoginSuccessSubtask received. Login complete.',
        );
        break;
      } else if (currentSubtaskId === 'DenyLoginSubtask') {
        console.error('[Login Flow] DenyLoginSubtask encountered during flow.');
        throw new Error(
          'Login denied by Twitter (DenyLoginSubtask). Check credentials or account status.',
        );
      } else {
        console.error(
          `[Login Flow] Encountered unknown subtask: ${currentSubtaskId}`,
          JSON.stringify(next.subtask, null, 2),
        );
        throw new Error(
          `Unknown or unhandled login subtask: ${currentSubtaskId}`,
        );
      }

      if (next.status === 'error') {
        console.error(
          `[Login Flow] Error encountered during subtask processing (${currentSubtaskId}):`,
          next.err,
        );
        throw next.err;
      }
    }

    if (next.status === 'error') {
      console.error('[Login Flow] Login flow finished with an error state.');
      throw next.err;
    } else if (
      !next.subtask ||
      next.subtask.subtask_id !== 'LoginSuccessSubtask'
    ) {
      const finalSubtaskId = next.subtask?.subtask_id ?? 'None';
      console.warn(
        `[Login Flow] Loop finished unexpectedly. Final status: ${next.status}, Final subtask ID: ${finalSubtaskId}`,
        next,
      );
      throw new Error(
        `Login flow did not complete successfully. Ended on subtask: ${finalSubtaskId}`,
      );
    } else {
      console.log('[Login Flow] Login process completed successfully.');
      if (!(await this.isLoggedIn())) {
        console.warn(
          '[Login Flow] isLoggedIn() returned false immediately after successful login flow. There might be a cookie or session issue.',
        );
      }
    }
  }

  async logout(): Promise<void> {
    if (!(await this.isLoggedIn())) {
      console.log('[Logout] Not logged in, skipping logout API call.');
      this.clearAuthData();
      return;
    }

    const headers = new Headers();
    await this.installTo(headers);

    if (!headers.has('x-csrf-token')) {
      console.warn(
        '[Logout] Missing x-csrf-token. Logout might fail. Ensuring ct0 cookie exists.',
      );
      const cookies = await this.getCookies();
      const ct0Cookie = cookies.find((c) => c.key === 'ct0');
      if (!ct0Cookie?.value) {
        console.warn(
          '[Logout] ct0 cookie is missing. Logout will likely fail.',
        );
      } else if (ct0Cookie) {
        headers.set('x-csrf-token', ct0Cookie.value);
        console.log('[Logout] Added x-csrf-token from cookie.');
      }
    }

    try {
      const res = await this.fetch(
        'https://api.twitter.com/1.1/account/logout.json',
        {
          method: 'POST',
          headers: headers,
          body: '',
        },
      );

      await updateCookieJar(this.jar, res.headers);

      if (!res.ok) {
        const errorText = await res
          .text()
          .catch(() => 'Could not read error body');
        console.warn(
          `[Logout] Logout API call failed: ${res.status} ${res.statusText}. Body: ${errorText}`,
        );
      } else {
        console.log('[Logout] Logout API call successful.');
      }
    } catch (error: any) {
      console.error(
        '[Logout] Error during logout API call:',
        error.message || error,
      );
    }

    this.clearAuthData();
    console.log('[Logout] Cleared local authentication data.');
  }

  private clearAuthData(): void {
    this.deleteToken();
    this.jar = new CookieJar();
    this.initialHtmlContent = null;
  }

  async installCsrfToken(headers: Headers): Promise<void> {
    const cookies = await this.getCookies();
    const xCsrfToken = cookies.find((cookie) => cookie.key === 'ct0');
    if (xCsrfToken) {
      headers.set('x-csrf-token', xCsrfToken.value);
    } else {
      console.warn(
        '[Install CSRF] ct0 cookie not found. x-csrf-token header cannot be set.',
      );
    }
  }

  async installTo(headers: Headers): Promise<void> {
    headers.set('authorization', `Bearer ${bearerToken}`);
    headers.set('cookie', await this.getCookieString());
    await this.installCsrfToken(headers);

    headers.set('x-twitter-auth-type', 'OAuth2Session');
    headers.set('x-twitter-active-user', 'yes');
    headers.set('x-twitter-client-language', 'en');
  }

  private async initLogin(): Promise<FlowTokenResult> {
    const cookiesToClear = [
      'twitter_ads_id',
      'ads_prefs',
      '_twitter_sess',
      'zipbox_forms_auth_token',
      'lang',
      'bouncer_reset_cookie',
      'twid',
      'twitter_ads_idb',
      'email_uid',
      'external_referer',
      'ct0',
      'aa_u',
      'att',
      'kdt',
      'remember_checked_on',
    ];
    console.log(
      '[Init Login] Clearing potentially stale cookies:',
      cookiesToClear.join(', '),
    );
    for (const cookieName of cookiesToClear) {
      await this.removeCookie(cookieName);
    }
    await this.updateGuestToken();

    return await this.executeFlowTask({
      flow_name: 'login',
      input_flow_data: {
        flow_context: {
          debug_overrides: {},
          start_location: { location: 'splash_screen' },
        },
      },
    });
  }

  private async handleJsInstrumentationSubtask(
    prev: FlowTokenResultSuccess,
  ): Promise<FlowTokenResult> {
    console.log('[Login Flow] Handling JS Instrumentation subtask.');
    const hardcodedJsResponse =
      '{"rf":{"a025043bb37f213c64177fb7dee22fa9622c41d63db12a8320344d2e4eb870b4":-252,"a3ef81ad1f68f094ab6b38abbd90a2e5fa1725153d0a6e5b4ae2358fbe10f786":251,"a6bdc63164db5b9016b7ea90549fa9250f6f73fc5699c059fe403eab598708ba":-218,"ab7835855ed63123eb666561fd011a0abcf04d4da7d02e288dc91448eabcb18b":219},"s":"rU9F_dp9s1M0bbnfdrWH7yIqTl2DYdxDkqB0HehtDaNJwDp78HjutGdXmsBupKSYjDtRMpepAHPNepcMFwmLyhi4RGnfi9CR9aOj3eHxa_yOIJfjy6deDrPSoBp0Ci-JjPk6QkulbW-VgNos-eG-dAXScs91EiWW1-2hUFQIlGM_t2gBoTwsQHSZc70SBHNDZBNYB0sCpHbf69oox-SDAREeO4wHj7743V9DnygwK7Th7ECqrmXrw24pgQxw_bizAaI2S1cVS9Yf2IX-8QWL6qkjypVkPUNoXJ-SdUKegAYfeQ8RM13B7_aGMYk6U1mZyBSQrWf5IMQqXZsERHiP3wAAAZYD0RfC"}';

    return await this.executeFlowTask({
      flow_token: prev.flowToken,
      subtask_inputs: [
        {
          subtask_id: 'LoginJsInstrumentationSubtask',
          js_instrumentation: {
            response: hardcodedJsResponse,
            link: 'next_link',
          },
        },
      ],
    });
  }

  private async handleEnterAlternateIdentifierSubtask(
    prev: FlowTokenResultSuccess,
    email: string,
  ): Promise<FlowTokenResult> {
    console.log(
      '[Login Flow] Handling Enter Alternate Identifier (Email) subtask.',
    );
    return await this.executeFlowTask({
      flow_token: prev.flowToken,
      subtask_inputs: [
        {
          subtask_id: 'LoginEnterAlternateIdentifierSubtask',
          enter_text: {
            text: email,
            link: 'next_link',
          },
        },
      ],
    });
  }

  private async handleEnterUserIdentifierSSO(
    prev: FlowTokenResultSuccess,
    username: string,
  ): Promise<FlowTokenResult> {
    console.log(
      `[Login Flow] Handling Enter User Identifier subtask with identifier: ${username}`,
    );
    return await this.executeFlowTask({
      flow_token: prev.flowToken,
      subtask_inputs: [
        {
          subtask_id: 'LoginEnterUserIdentifierSSO',
          settings_list: {
            setting_responses: [
              {
                key: 'user_identifier',
                response_data: {
                  text_data: { result: username },
                },
              },
            ],
            link: 'next_link',
          },
        },
      ],
    });
  }

  private async handleEnterPassword(
    prev: FlowTokenResultSuccess,
    password: string,
  ): Promise<FlowTokenResult> {
    console.log('[Login Flow] Handling Enter Password subtask.');
    return await this.executeFlowTask({
      flow_token: prev.flowToken,
      subtask_inputs: [
        {
          subtask_id: 'LoginEnterPassword',
          enter_password: {
            password,
            link: 'next_link',
          },
        },
      ],
    });
  }

  private async handleAccountDuplicationCheck(
    prev: FlowTokenResultSuccess,
  ): Promise<FlowTokenResult> {
    console.log('[Login Flow] Handling Account Duplication Check subtask.');
    return await this.executeFlowTask({
      flow_token: prev.flowToken,
      subtask_inputs: [
        {
          subtask_id: 'AccountDuplicationCheck',
          check_logged_in_account: {
            link: 'AccountDuplicationCheck_false',
          },
        },
      ],
    });
  }

  private async handleTwoFactorAuthChallenge(
    prev: FlowTokenResultSuccess,
    secret: string,
  ): Promise<FlowTokenResult> {
    console.log('[Login Flow] Handling Two Factor Auth Challenge subtask.');
    const totp = new OTPAuth.TOTP({ secret });
    let lastError: Error | null = null;
    const maxAttempts = 3;
    const delayBetweenAttemptsMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const code = totp.generate();
      console.log(
        `[Login Flow] Attempt ${attempt}/${maxAttempts}: Trying 2FA code ${code}`,
      );
      try {
        const result = await this.executeFlowTask({
          flow_token: prev.flowToken,
          subtask_inputs: [
            {
              subtask_id: 'LoginTwoFactorAuthChallenge',
              enter_text: {
                link: 'next_link',
                text: code,
              },
            },
          ],
        });

        if (result.status === 'error') {
          console.warn(
            `[Login Flow] Attempt ${attempt} failed with API error: ${result.err.message}`,
          );
          lastError = result.err;
          if (
            result.err.message
              ?.toLowerCase()
              .includes('verification code is invalid')
          ) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayBetweenAttemptsMs * attempt),
            );
            continue;
          } else {
            throw result.err;
          }
        }

        console.log(`[Login Flow] Attempt ${attempt} successful.`);
        return result;
      } catch (err: any) {
        console.warn(
          `[Login Flow] Attempt ${attempt} failed with exception: ${
            err.message || err
          }`,
        );
        lastError = err instanceof Error ? err : new Error(String(err));
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenAttemptsMs * attempt),
        );
      }
    }

    console.error(
      `[Login Flow] Failed 2FA challenge after ${maxAttempts} attempts.`,
    );
    throw (
      lastError ??
      new Error(
        'Failed Two Factor Authentication challenge after multiple attempts.',
      )
    );
  }

  private async handleAcid(
    prev: FlowTokenResultSuccess,
    email: string | undefined,
    emailPassword: string | undefined,
  ): Promise<FlowTokenResult> {
    console.log(
      '[Login Flow] Handling ACID (Account Confirmation/Identity) subtask.',
    );
    let inputText: string | undefined;

    const primaryText =
      prev.subtask?.enter_text?.header?.primary_text?.text?.toLowerCase() ?? '';
    const isCodePrompt =
      primaryText.includes('code') || primaryText.includes('verification');
    const isEmailPrompt = primaryText.includes('email');

    console.log(
      `[Login Flow] ACID prompt text: "${primaryText}" (isCode: ${isCodePrompt}, isEmail: ${isEmailPrompt})`,
    );

    if (isCodePrompt) {
      console.log(
        '[Login Flow] ACID subtask is requesting a verification code.',
      );
      if (email && emailPassword) {
        console.log(
          `Attempting to fetch confirmation code from email: ${email}`,
        );
        try {
          inputText = await fetchConfirmationCodeFromEmail(
            email,
            emailPassword,
          );
          console.log(`Successfully fetched confirmation code: ${inputText}`);
        } catch (error: any) {
          console.error(
            `Failed to fetch email code: ${error.message || error}`,
          );
          throw new Error(
            `Failed to automatically fetch the email confirmation code for ${email}. Please provide it manually or check email/password credentials. Error: ${
              error.message || error
            }`,
          );
        }
      } else if (email && !emailPassword) {
        throw new Error(
          "Twitter is asking for an email confirmation code, but 'emailPassword' was not provided to automatically fetch it.",
        );
      } else {
        throw new Error(
          "Twitter is asking for an email confirmation code, but the 'email' address is unknown.",
        );
      }
    } else {
      console.log(
        '[Login Flow] ACID subtask seems to be requesting email address.',
      );
      if (email) {
        inputText = email;
        console.log(`[Login Flow] Providing email address: ${email}`);
      } else {
        throw new Error(
          "Twitter is asking for email confirmation, but the 'email' address was not provided.",
        );
      }
    }

    if (!inputText) {
      throw new Error(
        'Failed to determine required input (code or email) for the ACID verification step.',
      );
    }

    return await this.executeFlowTask({
      flow_token: prev.flowToken,
      subtask_inputs: [
        {
          subtask_id: 'LoginAcid',
          enter_text: {
            text: inputText,
            link: 'next_link',
          },
        },
      ],
    });
  }

  private async executeFlowTask(
    data: TwitterUserAuthFlowRequest,
  ): Promise<FlowTokenResult> {
    const onboardingTaskUrl =
      'https://api.twitter.com/1.1/onboarding/task.json';
    const requestPath = '/1.1/onboarding/task.json';
    const requestMethod = 'POST';

    const guestToken = this.guestToken;
    if (!guestToken) {
      console.warn(
        '[Execute Flow Task] Guest token is missing. Attempting to refresh...',
      );
      await this.updateGuestToken();
      if (!this.guestToken) {
        throw new Error(
          'Guest token is missing and could not be refreshed. Cannot execute flow task.',
        );
      }
      console.log('[Execute Flow Task] Guest token refreshed.');
    }

    const headers = new Headers({
      authorization: `Bearer ${BEARER_TOKEN}`,
      cookie: await this.getCookieString(),
      'content-type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      'x-guest-token': this.guestToken!,
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
    });
    await this.installCsrfToken(headers);

    if (this.initialHtmlContent) {
      try {
        const transactionId = await this.generateTransactionIdViaCli(
          requestMethod,
          requestPath,
        );
        console.log(
          `[Execute Flow Task] Adding X-Client-Transaction-Id: ${transactionId}`,
        );
        headers.set('X-Client-Transaction-Id', transactionId);
      } catch (error: any) {
        console.warn(
          '[Execute Flow Task] Failed to generate transaction ID for onboarding task, proceeding without it:',
          error.message || error,
        );
      }
    } else {
      console.warn(
        '[Execute Flow Task] Initial HTML content not available, skipping X-Client-Transaction-Id header.',
      );
    }

    console.log(`[Execute Flow Task] Sending request to ${onboardingTaskUrl}`);

    let res: Response;
    try {
      res = await this.fetch(onboardingTaskUrl, {
        method: requestMethod,
        headers: headers,
        body: JSON.stringify(data),
        redirect: 'follow',
      });
    } catch (fetchError: any) {
      console.error(
        `[Execute Flow Task] Network error during fetch: ${
          fetchError.message || fetchError
        }`,
      );
      return {
        status: 'error',
        err: new Error(
          `Network error executing flow task: ${
            fetchError.message || fetchError
          }`,
        ),
      };
    }

    await updateCookieJar(this.jar, res.headers);

    let responseBodyText: string | null = null;
    try {
      responseBodyText = await res.text();
    } catch (bodyError: any) {
      console.warn(
        `[Execute Flow Task] Could not read response body: ${
          bodyError.message || bodyError
        }`,
      );
    }

    if (!res.ok) {
      console.error(
        `[Execute Flow Task] Error executing flow task: ${res.status} ${res.statusText}`,
        `Response body: ${responseBodyText ?? '(Could not read body)'}`,
      );
      return {
        status: 'error',
        err: new Error(
          `Flow task failed (${res.status} ${res.statusText}): ${
            responseBodyText || '(No response body)'
          }`,
        ),
      };
    }

    if (!responseBodyText) {
      console.error(
        '[Execute Flow Task] Received OK status but response body is empty or unreadable.',
      );
      return {
        status: 'error',
        err: new Error(
          'Flow task returned OK status but response body was empty.',
        ),
      };
    }

    let flow: TwitterUserAuthFlowResponse;
    try {
      flow = JSON.parse(responseBodyText);
    } catch (parseError: any) {
      console.error(
        `[Execute Flow Task] Failed to parse JSON response: ${
          parseError.message || parseError
        }`,
        `Raw body: ${responseBodyText}`,
      );
      return {
        status: 'error',
        err: new Error(
          `Failed to parse flow task JSON response: ${
            parseError.message || parseError
          }`,
        ),
      };
    }

    if (flow.errors?.length) {
      const primaryError = flow.errors[0];
      const errMsg = `Flow task API error (Code ${primaryError.code}): ${primaryError.message}`;
      console.error(errMsg, flow.errors);
      return { status: 'error', err: new Error(errMsg) };
    }

    if (typeof flow.flow_token !== 'string' || !flow.flow_token) {
      console.error(
        '[Execute Flow Task] Flow token missing or invalid in response:',
        flow,
      );
      return {
        status: 'error',
        err: new Error(
          'flow_token not found or is invalid in the API response.',
        ),
      };
    }

    console.log(
      `[Execute Flow Task] Step successful. New flow token: ${flow.flow_token.substring(
        0,
        10,
      )}...`,
    );

    const subtask = flow.subtasks?.length ? flow.subtasks[0] : undefined;

    if (subtask && !Check(TwitterUserAuthSubtask, subtask)) {
      console.warn(
        '[Execute Flow Task] Received subtask does not match expected schema:',
        subtask,
      );
    }

    if (subtask) {
      console.log(`[Execute Flow Task] Next subtask ID: ${subtask.subtask_id}`);
      if (subtask.subtask_id === 'DenyLoginSubtask') {
        console.error(
          '[Execute Flow Task] Authentication denied: DenyLoginSubtask received.',
          subtask,
        );
        return {
          status: 'error',
          err: new Error(
            'Authentication error: DenyLoginSubtask received from API.',
          ),
        };
      }
    } else {
      console.log(
        '[Execute Flow Task] No further subtasks received in this step.',
      );
    }

    return {
      status: 'success',
      subtask,
      flowToken: flow.flow_token,
    };
  }
}
