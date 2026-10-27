const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-26" -> "Oct 26". */
export function shortDate(iso) {
  const date = parseDate(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "1 contribution", "1,204 contributions". */
export const countOf = (n, noun) => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

export async function loadContributions(username, year) {
  const params = new URLSearchParams({ user: username });
  if (year) params.set('year', String(year));

  let response;
  try {
    response = await fetch(`/api/contributions?${params}`);
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

/**
 * Lays the days out like GitHub's calendar: one column per week (x), one row
 * per weekday starting on Sunday (z).
 */
export function buildGrid(days) {
  const firstWeekday = parseDate(days[0].date).getUTCDay();
  const cells = days.map((day, index) => {
    const slot = index + firstWeekday;
    const date = parseDate(day.date);
    return {
      ...day,
      week: Math.floor(slot / 7),
      weekday: date.getUTCDay(),
      month: date.getUTCMonth(),
      dayOfMonth: date.getUTCDate()
    };
  });
  const weeks = cells[cells.length - 1].week + 1;
  const maxCount = cells.reduce((max, cell) => Math.max(max, cell.count), 0);

  // Month labels sit above the first week that contains the 1st of a month
  // (or the very first column), like GitHub's own header row.
  const monthLabels = [];
  for (const cell of cells) {
    const isFirstColumn = cell.week === 0 && monthLabels.length === 0;
    if ((cell.dayOfMonth === 1 || isFirstColumn) && !monthLabels.some((label) => label.week === cell.week)) {
      monthLabels.push({ week: cell.week, text: MONTHS[cell.month] });
    }
  }

  return { cells, weeks, maxCount, monthLabels };
}

export function summarize(days) {
  let total = 0;
  let activeDays = 0;
  let best = days[0];
  let longest = 0;
  let run = 0;

  for (const day of days) {
    total += day.count;
    if (day.count > best.count) best = day;
    if (day.count > 0) {
      activeDays += 1;
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return { total, activeDays, best, longestStreak: longest };
}

export function describeDay(cell) {
  const weekday = WEEKDAYS[cell.weekday];
  const count = cell.count === 0 ? 'No contributions' : countOf(cell.count, 'contribution');
  return { date: `${weekday} ${cell.date}`, count };
}

function parseDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}
