// Cloudflare Pages Function: GET /api/contributions?user=<name>&year=<yyyy>
// Set GITHUB_TOKEN in the Pages project's environment variables to use the
// official GraphQL API; without it the public calendar page is parsed instead.

import { handleContributionsRequest } from '../../server/contributions.js';

export async function onRequestGet({ request, env }) {
  const { status, body } = await handleContributionsRequest(new URL(request.url), {
    token: env.GITHUB_TOKEN
  });
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=600' : 'no-store'
    }
  });
}
