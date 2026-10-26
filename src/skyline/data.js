const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

export async function loadContributions(username, year) {
  const params = new URLSearchParams({ user: username });
  if (year) params.set('year', String(year));

  let response;
  try {
    response = await fetch(`/api/contributions?${params}`);
  } catch {
    throw new Error('网络连接失败');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`);
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
  const count = cell.count === 0 ? '没有贡献' : `${cell.count.toLocaleString('zh-CN')} 次贡献`;
  return { date: `${cell.date} ${weekday}`, count };
}

function parseDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}
