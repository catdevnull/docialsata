import { type TwitterAuth } from './auth';
import { ApiError } from './errors';
import { Platform, type PlatformExtensions } from './platform';
import { updateCookieJar } from './requests';

// For some reason using Parameters<typeof fetch> reduces the request transform function to
// `(url: string) => string` in tests.
type FetchParameters = [input: RequestInfo | URL, init?: RequestInit];

export interface FetchTransformOptions {
  /**
   * Transforms the request options before a request is made. This executes after all of the default
   * parameters have been configured, and is stateless. It is safe to return new request options
   * objects.
   * @param args The request options.
   * @returns The transformed request options.
   */
  request: (
    ...args: FetchParameters
  ) => FetchParameters | Promise<FetchParameters>;

  /**
   * Transforms the response after a request completes. This executes immediately after the request
   * completes, and is stateless. It is safe to return a new response object.
   * @param response The response object.
   * @returns The transformed response object.
   */
  response: (response: Response) => Response | Promise<Response>;
}

export const bearerToken =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export class RateLimitError extends Error {
  resetAt: Date;
  constructor(resetAt: Date) {
    super(`Rate limit detected in this account. Resets at ${resetAt}`);
    this.resetAt = resetAt;
  }

  // XXX: not tested
  async waitUntilReset() {
    const deltaMs = +this.resetAt - +new Date();
    // I have seen this block for 800s (~13 *minutes*)
    await new Promise((resolve) => setTimeout(resolve, deltaMs));
  }
}

/**
 * An API result container.
 */
export type RequestApiResult<T> =
  | { success: true; value: T }
  | { success: false; err: Error };

/**
 * Used internally to send HTTP requests to the Twitter API.
 * @internal
 * @param url - The URL to send the request to.
 * @param auth - The instance of {@link TwitterAuth} that will be used to authorize this request.
 * @param method - The HTTP method used when sending this request.
 */
export async function requestApi<T>(
  url: string,
  auth: TwitterAuth,
  method: 'GET' | 'POST' = 'GET',
  platform: PlatformExtensions = new Platform(),
): Promise<RequestApiResult<T>> {
  const headers = new Headers();
  await auth.installTo(headers, url);
  await platform.randomizeCiphers();

  let res: Response;
  do {
    try {
      res = await auth.fetch(url, {
        method,
        headers,
        credentials: 'include',
      });
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }

      return {
        success: false,
        err,
      };
    }

    await updateCookieJar(auth.cookieJar(), res.headers);

    if (res.status === 429) {
      /*
      Known headers at this point:
      - x-rate-limit-limit: Maximum number of requests per time period?
      - x-rate-limit-reset: UNIX timestamp when the current rate limit will be reset.
      - x-rate-limit-remaining: Number of requests remaining in current time period?
      */
      const xRateLimitRemaining = res.headers.get('x-rate-limit-remaining');
      const xRateLimitReset = res.headers.get('x-rate-limit-reset');
      if (xRateLimitRemaining == '0' && xRateLimitReset) {
        const resetDate = new Date(parseInt(xRateLimitReset) * 1000);
        throw new RateLimitError(resetDate);
      }
    }
  } while (res.status === 429);

  if (!res.ok) {
    return {
      success: false,
      err: await ApiError.fromResponse(res, url),
    };
  }

  const value: T = await res.json();
  if (res.headers.get('x-rate-limit-incoming') == '0') {
    auth.deleteToken();
  }

  const error = await getJsonError(value);
  if (error) {
    return {
      success: false,
      err: new Error(error),
    };
  }
  return { success: true, value };
}

/** @internal */
export function addApiFeatures(o: object) {
  return {
    ...o,
    rweb_lists_timeline_redesign_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    longform_notetweets_rich_text_read_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    subscriptions_verification_info_enabled: true,
    subscriptions_verification_info_reason_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    super_follow_badge_privacy_enabled: false,
    super_follow_exclusive_tweet_notifications_enabled: false,
    super_follow_tweet_api_enabled: false,
    super_follow_user_api_enabled: false,
    android_graphql_skip_api_media_color_palette: false,
    creator_subscriptions_subscription_count_enabled: false,
    blue_business_profile_image_shape_enabled: false,
    unified_cards_ad_metadata_container_dynamic_card_content_query_enabled:
      false,
  };
}

export function addApiParams(
  params: URLSearchParams,
  includeTweetReplies: boolean,
): URLSearchParams {
  params.set('include_profile_interstitial_type', '1');
  params.set('include_blocking', '1');
  params.set('include_blocked_by', '1');
  params.set('include_followed_by', '1');
  params.set('include_want_retweets', '1');
  params.set('include_mute_edge', '1');
  params.set('include_can_dm', '1');
  params.set('include_can_media_tag', '1');
  params.set('include_ext_has_nft_avatar', '1');
  params.set('include_ext_is_blue_verified', '1');
  params.set('include_ext_verified_type', '1');
  params.set('skip_status', '1');
  params.set('cards_platform', 'Web-12');
  params.set('include_cards', '1');
  params.set('include_ext_alt_text', 'true');
  params.set('include_ext_limited_action_results', 'false');
  params.set('include_quote_count', 'true');
  params.set('include_reply_count', '1');
  params.set('tweet_mode', 'extended');
  params.set('include_ext_collab_control', 'true');
  params.set('include_ext_views', 'true');
  params.set('include_entities', 'true');
  params.set('include_user_entities', 'true');
  params.set('include_ext_media_color', 'true');
  params.set('include_ext_media_availability', 'true');
  params.set('include_ext_sensitive_media_warning', 'true');
  params.set('include_ext_trusted_friends_metadata', 'true');
  params.set('send_error_codes', 'true');
  params.set('simple_quoted_tweet', 'true');
  params.set('include_tweet_replies', `${includeTweetReplies}`);
  params.set(
    'ext',
    'mediaStats,highlightedLabel,hasNftAvatar,voiceInfo,birdwatchPivot,enrichments,superFollowMetadata,unmentionInfo,editControl,collab_control,vibe',
  );
  return params;
}

export async function getJsonError<T>(value: T): Promise<string | null> {
  if (
    'errors' in (value as any) &&
    (value as any).errors != null &&
    (value as any).errors.length > 0
  ) {
    return (value as any).errors[0].message;
  }
  return null;
}
