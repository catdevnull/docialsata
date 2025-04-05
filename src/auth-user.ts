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
  constructor(options?: Partial<TwitterAuthOptions>) {
    super(options);
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
    return verify && !verify.errors?.length;
  }

  async loginWithToken(token: string): Promise<void> {
    // await this.updateGuestToken();

    let ct0 = '';
    const choices = [...'0123456789abcdefghijklmnopqrstuvwxyz'.split('')];
    for (let i = 0; i < 160; i++) {
      ct0 += choices[Math.floor(Math.random() * choices.length)];
    }
    await this.jar.setCookie(`ct0=${ct0}`, 'https://twitter.com');

    await this.jar.setCookie(`auth_token=${token}`, 'https://twitter.com');

    const headers = new Headers();
    await this.installTo(headers);

    // https://github.com/fa0311/TwitterInternalAPIDocument/blob/2b28ecb1450b80e61d6dcfcd2633df68d01940e4/docs/json/API.json#L1771
    const variables = {
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
    };

    // https://github.com/HeavyHell/pytwex/blob/c3e5ccae9f3124a8a2c0d333b2cb6bd6fb2dad16/pytwex/client.py#L100
    const res = await this.fetch(
      `https://twitter.com/i/api/graphql/HC-1ZetsBT1HKVUOvnLE8Q/Viewer?variables=${encodeURIComponent(
        JSON.stringify({ withCommunitiesMemberships: true }),
      )}&features=${encodeURIComponent(
        JSON.stringify(variables),
      )}&fieldToggles=${encodeURIComponent(
        JSON.stringify({ isDelegate: false, withAuxiliaryUserLabels: false }),
      )}`,
      {
        headers,
      },
    );
    if (res.status === 403) {
      // as expected
      await updateCookieJar(this.jar, res.headers);
    } else {
      throw new Error('no 403 on oauth authorize');
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

    let next = await this.initLogin();
    while ('subtask' in next && next.subtask) {
      if (next.subtask.subtask_id === 'LoginJsInstrumentationSubtask') {
        next = await this.handleJsInstrumentationSubtask(next);
      } else if (next.subtask.subtask_id === 'LoginEnterUserIdentifierSSO') {
        next = await this.handleEnterUserIdentifierSSO(next, username);
      } else if (
        next.subtask.subtask_id === 'LoginEnterAlternateIdentifierSubtask'
      ) {
        next = await this.handleEnterAlternateIdentifierSubtask(
          next,
          email as string,
        );
      } else if (next.subtask.subtask_id === 'LoginEnterPassword') {
        next = await this.handleEnterPassword(next, password);
      } else if (next.subtask.subtask_id === 'AccountDuplicationCheck') {
        next = await this.handleAccountDuplicationCheck(next);
      } else if (next.subtask.subtask_id === 'LoginTwoFactorAuthChallenge') {
        if (twoFactorSecret) {
          next = await this.handleTwoFactorAuthChallenge(next, twoFactorSecret);
        } else {
          throw new Error(
            'Requested two factor authentication code but no secret provided',
          );
        }
      } else if (next.subtask.subtask_id === 'LoginAcid') {
        next = await this.handleAcid(next, email, emailPassword);
      } else if (next.subtask.subtask_id === 'LoginSuccessSubtask') {
        next = await this.handleSuccessSubtask(next);
      } else {
        throw new Error(`Unknown subtask ${next.subtask.subtask_id}`);
      }
    }
    if ('err' in next) {
      throw next.err;
    }
  }

  async logout(): Promise<void> {
    if (!this.isLoggedIn()) {
      return;
    }

    await requestApi<void>(
      'https://api.twitter.com/1.1/account/logout.json',
      this,
      'POST',
    );
    this.deleteToken();
    this.jar = new CookieJar();
  }

  async installCsrfToken(headers: Headers): Promise<void> {
    const cookies = await this.getCookies();
    const xCsrfToken = cookies.find((cookie) => cookie.key === 'ct0');
    if (xCsrfToken) {
      headers.set('x-csrf-token', xCsrfToken.value);
    }
  }

  async installTo(headers: Headers): Promise<void> {
    headers.set('authorization', `Bearer ${bearerToken}`);
    headers.set('cookie', await this.getCookieString());
    await this.installCsrfToken(headers);
  }

  private async initLogin() {
    // Reset certain session-related cookies because Twitter complains sometimes if we don't
    this.removeCookie('twitter_ads_id=');
    this.removeCookie('ads_prefs=');
    this.removeCookie('_twitter_sess=');
    this.removeCookie('zipbox_forms_auth_token=');
    this.removeCookie('lang=');
    this.removeCookie('bouncer_reset_cookie=');
    this.removeCookie('twid=');
    this.removeCookie('twitter_ads_idb=');
    this.removeCookie('email_uid=');
    this.removeCookie('external_referer=');
    this.removeCookie('ct0=');
    this.removeCookie('aa_u=');

    return await this.executeFlowTask({
      flow_name: 'login',
      // prettier-ignore
      ...{"input_flow_data":{"flow_context":{"debug_overrides":{},"start_location":{"location":"splash_screen"}}},"subtask_versions":{"action_list":2,"alert_dialog":1,"app_download_cta":1,"check_logged_in_account":1,"choice_selection":3,"contacts_live_sync_permission_prompt":0,"cta":7,"email_verification":2,"end_flow":1,"enter_date":1,"enter_email":2,"enter_password":5,"enter_phone":2,"enter_recaptcha":1,"enter_text":5,"enter_username":2,"generic_urt":3,"in_app_notification":1,"interest_picker":3,"js_instrumentation":1,"menu_dialog":1,"notifications_permission_prompt":2,"open_account":2,"open_home_timeline":1,"open_link":1,"phone_verification":4,"privacy_options":1,"security_key":3,"select_avatar":4,"select_banner":2,"settings_list":7,"show_code":1,"sign_up":2,"sign_up_review":4,"tweet_selection_urt":1,"update_users":1,"upload_media":1,"user_recommendations_list":4,"user_recommendations_urt":1,"wait_spinner":3,"web_modal":1}},
    });
  }

  private async handleJsInstrumentationSubtask(prev: FlowTokenResultSuccess) {
    return await this.executeFlowTask({
      flow_token: prev.flowToken,
      subtask_inputs: [
        {
          subtask_id: 'LoginJsInstrumentationSubtask',
          js_instrumentation: {
            response:
              '{"rf":{"a025043bb37f213c64177fb7dee22fa9622c41d63db12a8320344d2e4eb870b4":-252,"a3ef81ad1f68f094ab6b38abbd90a2e5fa1725153d0a6e5b4ae2358fbe10f786":251,"a6bdc63164db5b9016b7ea90549fa9250f6f73fc5699c059fe403eab598708ba":-218,"ab7835855ed63123eb666561fd011a0abcf04d4da7d02e288dc91448eabcb18b":219},"s":"rU9F_dp9s1M0bbnfdrWH7yIqTl2DYdxDkqB0HehtDaNJwDp78HjutGdXmsBupKSYjDtRMpepAHPNepcMFwmLyhi4RGnfi9CR9aOj3eHxa_yOIJfjy6deDrPSoBp0Ci-JjPk6QkulbW-VgNos-eG-dAXScs91EiWW1-2hUFQIlGM_t2gBoTwsQHSZc70SBHNDZBNYB0sCpHbf69oox-SDAREeO4wHj7743V9DnygwK7Th7ECqrmXrw24pgQxw_bizAaI2S1cVS9Yf2IX-8QWL6qkjypVkPUNoXJ-SdUKegAYfeQ8RM13B7_aGMYk6U1mZyBSQrWf5IMQqXZsERHiP3wAAAZYD0RfC"}',
            link: 'next_link',
          },
        },
      ],
    });
  }

  private async handleEnterAlternateIdentifierSubtask(
    prev: FlowTokenResultSuccess,
    email: string,
  ) {
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
  ) {
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
  ) {
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

  private async handleAccountDuplicationCheck(prev: FlowTokenResultSuccess) {
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
  ) {
    const totp = new OTPAuth.TOTP({ secret });
    let error;
    for (let attempts = 1; attempts < 4; attempts += 1) {
      try {
        return await this.executeFlowTask({
          flow_token: prev.flowToken,
          subtask_inputs: [
            {
              subtask_id: 'LoginTwoFactorAuthChallenge',
              enter_text: {
                link: 'next_link',
                text: totp.generate(),
              },
            },
          ],
        });
      } catch (err) {
        error = err;
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempts));
      }
    }
    throw error;
  }

  private async handleAcid(
    prev: FlowTokenResultSuccess,
    email: string | undefined,
  ) {
    let inputText: string | undefined = email;

    const isCodePrompt = prev.subtask?.enter_text?.header?.primary_text?.text
      ?.toLowerCase()
      .includes('code');

    if (isCodePrompt && email && emailPassword) {
      console.log(`Attempting to fetch confirmation code from email: ${email}`);
      try {
        // Call the imported helper function
        inputText = await fetchConfirmationCodeFromEmail(email, emailPassword);
        console.log(`Successfully fetched confirmation code: ${inputText}`);
      } catch (error) {
        console.error(`Failed to fetch email code: ${error}`);
        throw new Error(
          `Failed to automatically fetch the email confirmation code for ${email}. Please provide it manually or check credentials.`,
        );
      }
    } else if (isCodePrompt && !emailPassword) {
      throw new Error(
        "Twitter is asking for an email confirmation code, but 'emailPassword' was not provided.",
      );
    } else if (!inputText && !isCodePrompt) {
      throw new Error(
        "Twitter is asking for email confirmation, but 'email' was not provided.",
      );
    } else if (!inputText && isCodePrompt) {
      throw new Error(
        'Failed to determine input for LoginAcid step. Email code might be required.',
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

  private async handleSuccessSubtask(prev: FlowTokenResultSuccess) {
    return await this.executeFlowTask({
      flow_token: prev.flowToken,
      subtask_inputs: [],
    });
  }

  private async executeFlowTask(
    data: TwitterUserAuthFlowRequest,
  ): Promise<FlowTokenResult> {
    const onboardingTaskUrl =
      'https://api.twitter.com/1.1/onboarding/task.json';

    const token = this.guestToken;
    if (token == null) {
      throw new Error('Authentication token is null or undefined.');
    }

    const headers = new Headers({
      authorization: `Bearer ${BEARER_TOKEN}`,
      cookie: await this.getCookieString(),
      'content-type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 11; Nokia G20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.88 Mobile Safari/537.36',
      'x-guest-token': token,
      'x-twitter-auth-type': 'OAuth2Client',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
    });
    await this.installCsrfToken(headers);

    const res = await this.fetch(onboardingTaskUrl, {
      credentials: 'include',
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data),
    });

    await updateCookieJar(this.jar, res.headers);

    if (!res.ok) {
      return { status: 'error', err: new Error(await res.text()) };
    }

    const flow: TwitterUserAuthFlowResponse = await res.json();
    if (flow?.flow_token == null) {
      return { status: 'error', err: new Error('flow_token not found.') };
    }

    if (flow.errors?.length) {
      return {
        status: 'error',
        err: new Error(
          `Authentication error (${flow.errors[0].code}): ${flow.errors[0].message}`,
        ),
      };
    }

    if (typeof flow.flow_token !== 'string') {
      return {
        status: 'error',
        err: new Error('flow_token was not a string.'),
      };
    }

    const subtask = flow.subtasks?.length ? flow.subtasks[0] : undefined;
    Check(TwitterUserAuthSubtask, subtask);

    if (subtask && subtask.subtask_id === 'DenyLoginSubtask') {
      return {
        status: 'error',
        err: new Error('Authentication error: DenyLoginSubtask'),
      };
    }

    return {
      status: 'success',
      subtask,
      flowToken: flow.flow_token,
    };
  }
}
