import { requestApi } from './api';
import { TwitterAuth } from './auth';
import { Profile } from './profile';
import { QueryProfilesResponse, QueryTweetsResponse } from './timeline-v1';
import { getTweetTimeline, getUserTimeline } from './timeline-async';
import { Tweet } from './tweets';
import {
  SearchTimeline,
  parseSearchTimelineTweets,
  parseSearchTimelineUsers,
} from './timeline-search';
import { apiRequestFactory } from './api-data';

/**
 * The categories that can be used in Twitter searches.
 */
export enum SearchMode {
  Top,
  Latest,
  Photos,
  Videos,
  Users,
}

export function searchTweets(
  query: string,
  maxTweets: number,
  searchMode: SearchMode,
  auth: TwitterAuth,
): AsyncGenerator<Tweet, void> {
  return getTweetTimeline(query, maxTweets, (q, mt, c) => {
    return fetchSearchTweets(q, mt, searchMode, auth, c);
  });
}

export function searchProfiles(
  query: string,
  maxProfiles: number,
  auth: TwitterAuth,
): AsyncGenerator<Profile, void> {
  return getUserTimeline(query, maxProfiles, (q, mt, c) => {
    return fetchSearchProfiles(q, mt, auth, c);
  });
}

export async function fetchSearchTweets(
  query: string,
  maxTweets: number,
  searchMode: SearchMode,
  auth: TwitterAuth,
  cursor?: string,
): Promise<QueryTweetsResponse> {
  const timeline = await getSearchTimeline(
    query,
    maxTweets,
    searchMode,
    auth,
    cursor,
  );

  return parseSearchTimelineTweets(timeline);
}

export async function fetchSearchProfiles(
  query: string,
  maxProfiles: number,
  auth: TwitterAuth,
  cursor?: string,
): Promise<QueryProfilesResponse> {
  const timeline = await getSearchTimeline(
    query,
    maxProfiles,
    SearchMode.Users,
    auth,
    cursor,
  );

  return parseSearchTimelineUsers(timeline);
}

/**
 * Returns an iterator of all tweets (posts and replies, no reposts) for a username.
 * It uses the search endpoint, so it doesn't find reposts.
 * Newest to oldest.
 */
export async function* getAllTweetsEver(auth: TwitterAuth, username: string) {
  let seenIds = new Set<string>();

  // https://socialdata.gitbook.io/docs/twitter-tweets/retrieve-search-results-by-keyword#retrieving-large-datasets
  let max_id: null | string = '';
  while (true) {
    const query = `from:${username}` + (max_id ? ` max_id:${max_id}` : '');
    const search = searchTweets(query, Infinity, SearchMode.Latest, auth);
    let lowest: null | bigint = null;
    for await (const result of search) {
      if (seenIds.has(result.id!)) {
        continue;
      }
      if (!lowest || BigInt(result.id!) < lowest) {
        lowest = BigInt(result.id!);
      }
      seenIds.add(result.id!);
      yield result;
    }
    if (!lowest) {
      break;
    } else {
      max_id = lowest.toString();
    }
  }
}

async function getSearchTimeline(
  query: string,
  maxItems: number,
  searchMode: SearchMode,
  auth: TwitterAuth,
  cursor?: string,
): Promise<SearchTimeline> {
  if (!auth.isLoggedIn()) {
    throw new Error('Scraper is not logged-in for search.');
  }

  if (maxItems > 50) {
    maxItems = 50;
  }

  const searchTimelineRequest = apiRequestFactory.createSearchTimelineRequest();
  searchTimelineRequest.variables.rawQuery = query;
  searchTimelineRequest.variables.count = maxItems;
  searchTimelineRequest.variables.querySource = 'typed_query';
  searchTimelineRequest.variables.product = 'Top';

  if (cursor != null && cursor != '') {
    searchTimelineRequest.variables['cursor'] = cursor;
  }

  switch (searchMode) {
    case SearchMode.Latest:
      searchTimelineRequest.variables.product = 'Latest';
      break;
    case SearchMode.Photos:
      searchTimelineRequest.variables.product = 'Photos';
      break;
    case SearchMode.Videos:
      searchTimelineRequest.variables.product = 'Videos';
      break;
    case SearchMode.Users:
      searchTimelineRequest.variables.product = 'People';
      break;
    default:
      break;
  }

  const res = await requestApi<SearchTimeline>(
    searchTimelineRequest.toRequestUrl(),
    auth,
  );

  if (!res.success) {
    throw res.err;
  }

  return res.value;
}
