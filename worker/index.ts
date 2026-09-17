// Tap Watch API. Static pages are served by Cloudflare before this runs;
// wrangler.jsonc sends only /api/* requests here.

import { ApiError, jsonText, json } from './http';
import { housekeeping } from './housekeeping';
import { issueFormToken } from './security';
import { getSnapshotJson, isAreaId } from './snapshot';
import { handleVote } from './vote';

const methodNotAllowed = (allow: string) =>
  new ApiError(405, 'method_not_allowed', `Use ${allow} for this address.`);

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const now = Date.now();

  switch (url.pathname) {
    case '/api/snapshot': {
      if (request.method !== 'GET') throw methodNotAllowed('GET');
      const area = url.searchParams.get('area');
      if (!isAreaId(area)) throw new ApiError(400, 'bad_request', 'Choose an area, for example ?area=e17.');
      const snapshot = await getSnapshotJson(env.DB, area, now);
      if (!snapshot) throw new ApiError(404, 'not_found', "We don't cover that area yet.");
      return jsonText(snapshot, 200, { 'X-Form-Token': await issueFormToken(env.APP_SECRET, now) });
    }

    case '/api/vote':
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return handleVote(request, env, now);

    default:
      throw new ApiError(404, 'not_found', "There's nothing at this address.");
  }
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof ApiError) return error.toResponse();
      // Log the problem, never the request (it would include the visitor's IP address).
      console.error('API error:', error instanceof Error ? error.message : String(error));
      return json(
        { error: 'server_error', message: 'Something went wrong on our side. Please try again in a minute.' },
        500,
      );
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(housekeeping(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;
