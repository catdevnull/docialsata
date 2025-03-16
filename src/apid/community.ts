import { z } from 'zod';
import type { TimelineV2 } from '../timeline-v2.js';
import { requestApi } from '../api.js';
import { ApiError } from '../errors.js';
import { Hono } from 'hono';
import { accountManager } from '../account-manager.js';

export const router = new Hono();

const CommunityMembersSliceTimelineResponse = z.object({
  data: z.object({
    communityResults: z.object({
      result: z.object({
        __typename: z.string(),
        members_slice: z.object({
          items_results: z.array(
            z.object({
              result: z.object({
                __typename: z.string(),
                id: z.string(),
                community_role: z.string(),
                legacy: z.object({
                  id_str: z.string(),
                  screen_name: z.string(),
                  name: z.string(),
                  follow_request_sent: z.boolean(),
                  protected: z.boolean(),
                  following: z.boolean(),
                  followed_by: z.boolean(),
                  blocking: z.boolean(),
                  profile_image_url_https: z.string(),
                  verified: z.boolean(),
                }),
                rest_id: z.string(),
                super_following: z.boolean(),
                super_follow_eligible: z.boolean(),
                super_followed_by: z.boolean(),
                affiliates_highlighted_label: z.object({}),
                is_blue_verified: z.boolean(),
                identity_profile_labels_highlighted_label: z.object({}),
              }),
              id: z.string(),
            }),
          ),
          slice_info: z.object({ next_cursor: z.string().optional() }),
        }),
        id: z.string(),
      }),
      id: z.string(),
    }),
  }),
});
router.get('/:id/members', async (c) => {
  let until: number = 20;
  const untilStr = c.req.query('until');
  if (untilStr) {
    until = Number(untilStr);
  }

  const BASE_URL = `https://x.com/i/api/graphql/V7OdnMvujMPsCctT_daznQ/membersSliceTimeline_Query?variables=%7B%22communityId%22%3A%22${c.req.param(
    'id',
  )}%22%2C%22cursor%22%3Anull%7D&features=%7B%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%7D`;
  const url = new URL(BASE_URL);
  url.searchParams.set(
    'variables',
    JSON.stringify({ communityId: c.req.param('id'), cursor: null }),
  );
  let results = [];
  try {
    while (results.length < until) {
      const res = await requestApi<TimelineV2>(
        url.toString(),
        accountManager.createAuthInstance(),
      );
      if (!res.success) {
        throw res.err;
      }
      const parsed = CommunityMembersSliceTimelineResponse.parse(res.value);

      results.push(
        ...parsed.data.communityResults.result.members_slice.items_results,
      );
      if (
        !parsed.data.communityResults.result.members_slice.slice_info
          .next_cursor
      ) {
        break;
      }
      url.searchParams.set(
        'variables',
        JSON.stringify({
          communityId: c.req.param('id'),
          cursor:
            parsed.data.communityResults.result.members_slice.slice_info
              .next_cursor,
        }),
      );
    }

    return c.json(results);
  } catch (error) {
    if (error instanceof ApiError) {
      return c.json({ error: error.message }, 500);
    } else {
      throw error;
    }
  }
});
