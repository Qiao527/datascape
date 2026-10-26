// Fetches a GitHub user's contribution calendar.
//
// Uses the official GraphQL API when a GITHUB_TOKEN is available, otherwise
// falls back to parsing the public calendar fragment that github.com serves at
// /users/<name>/contributions (no token needed, but the HTML format may change).
//
// This module only depends on the standard fetch API, so it runs both in Node
// (Vite dev/preview middleware) and in Cloudflare Workers / Pages Functions.

const USERNAME_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const FIRST_YEAR = 2008;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const LEVEL_FROM_GRAPHQL = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function parseQuery(searchParams) {
  const username = (searchParams.get('user') ?? '').trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(400, '用户名格式不正确');
  }

  const rawYear = searchParams.get('year');
  let year = null;
  if (rawYear) {
    year = Number(rawYear);
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < FIRST_YEAR || year > currentYear) {
      throw new HttpError(400, `年份必须在 ${FIRST_YEAR}–${currentYear} 之间`);
    }
  }
  return { username, year };
}

export async function fetchContributions({ username, year }, { token } = {}) {
  const key = `${username.toLowerCase()}:${year ?? 'last'}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const range = year
    ? { from: `${year}-01-01`, to: `${year}-12-31` }
    : null;
  const days = token
    ? await fetchViaGraphQL(username, range, token)
    : await fetchViaProfilePage(username, range);

  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  const value = {
    username,
    year,
    from: days[0]?.date ?? null,
    to: days[days.length - 1]?.date ?? null,
    days
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Framework-neutral request handler. Returns { status, body } so each runtime
 * adapter only has to serialize it.
 */
export async function handleContributionsRequest(url, { token } = {}) {
  try {
    const query = parseQuery(url.searchParams);
    const body = await fetchContributions(query, { token });
    return { status: 200, body };
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502;
    const message = error instanceof HttpError ? error.message : '获取 GitHub 数据失败';
    if (!(error instanceof HttpError)) console.error('[contributions]', error);
    return { status, body: { error: message } };
  }
}

/** Connect-style middleware for the Vite dev and preview servers. */
export function contributionsMiddleware(req, res) {
  const url = new URL(req.url, 'http://localhost');
  handleContributionsRequest(url, { token: process.env.GITHUB_TOKEN }).then(({ status, body }) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', status === 200 ? 'public, max-age=600' : 'no-store');
    res.end(JSON.stringify(body));
  });
}

async function fetchViaProfilePage(username, range) {
  const url = new URL(`https://github.com/users/${encodeURIComponent(username)}/contributions`);
  if (range) {
    url.searchParams.set('from', range.from);
    url.searchParams.set('to', range.to);
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'datascape-contribution-city', Accept: 'text/html' }
  });
  if (response.status === 404) throw new HttpError(404, `找不到 GitHub 用户 ${username}`);
  if (response.status === 429) throw new HttpError(429, 'GitHub 请求太频繁，请稍后再试');
  if (!response.ok) throw new HttpError(502, `GitHub 返回了 ${response.status}`);

  return parseCalendarHtml(await response.text());
}

export function parseCalendarHtml(html) {
  // Tooltips carry the exact count: "12 contributions on March 3rd." / "No contributions on ...".
  const counts = new Map();
  for (const match of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const numberMatch = match[2].match(/^\s*([\d,]+)\s+contribution/);
    counts.set(match[1], numberMatch ? Number(numberMatch[1].replace(/,/g, '')) : 0);
  }

  const days = [];
  for (const match of html.matchAll(/<td\b[^>]*\bContributionCalendar-day\b[^>]*>/g)) {
    const tag = match[0];
    const date = tag.match(/\bdata-date="(\d{4}-\d{2}-\d{2})"/)?.[1];
    if (!date) continue;
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const level = Number(tag.match(/\bdata-level="(\d)"/)?.[1] ?? 0);
    days.push({ date, count: counts.get(id) ?? 0, level });
  }

  if (!days.length) throw new Error('Contribution calendar markup not found');
  return days;
}

async function fetchViaGraphQL(username, range, token) {
  const query = `
    query($login: String!, $from: DateTime, $to: DateTime) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks { contributionDays { date contributionCount contributionLevel } }
          }
        }
      }
    }`;
  const variables = {
    login: username,
    from: range ? `${range.from}T00:00:00Z` : null,
    to: range ? `${range.to}T23:59:59Z` : null
  };

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'datascape-contribution-city'
    },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new HttpError(502, `GitHub API 返回了 ${response.status}`);

  const payload = await response.json();
  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new HttpError(404, `找不到 GitHub 用户 ${username}`);

  return calendar.weeks.flatMap((week) => week.contributionDays.map((day) => ({
    date: day.date,
    count: day.contributionCount,
    level: LEVEL_FROM_GRAPHQL[day.contributionLevel] ?? 0
  })));
}
