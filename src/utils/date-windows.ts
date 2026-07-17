export interface TimeWindow {
    since: string; // ISO 8601, inclusive start
    until: string; // ISO 8601, inclusive end
}

/**
 * Split an arbitrary [since, until] range into non-overlapping calendar-month
 * windows. GitHub's GraphQL gateway times out (502/504) when asked to aggregate
 * a full year of contributions for very active accounts, so callers fetch the
 * data one month at a time and merge the results. Scalar totals sum exactly
 * because the windows never overlap; calendar days are deduped by date.
 */
export function getMonthlyWindows(since: Date, until: Date): TimeWindow[] {
    const windows: TimeWindow[] = [];
    if (since.getTime() > until.getTime()) {
        return windows;
    }

    // Walk month by month in UTC so windows align to calendar months.
    let cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1, 0, 0, 0, 0));

    while (cursor.getTime() <= until.getTime()) {
        const monthStart = new Date(
            Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1, 0, 0, 0, 0)
        );
        const monthEnd = new Date(
            Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0, 23, 59, 59, 0)
        );

        // Clamp the first and last windows to the requested range.
        const windowStart = monthStart.getTime() < since.getTime() ? since : monthStart;
        const windowEnd = monthEnd.getTime() > until.getTime() ? until : monthEnd;

        windows.push({since: windowStart.toISOString(), until: windowEnd.toISOString()});

        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    }

    return windows;
}

/**
 * Monthly windows covering a single calendar year, never extending past
 * `notAfter` (defaults to now) so we don't query future months.
 */
export function getYearMonthlyWindows(year: number, notAfter: Date = new Date()): TimeWindow[] {
    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 0));
    const until = yearEnd.getTime() > notAfter.getTime() ? notAfter : yearEnd;
    if (yearStart.getTime() > until.getTime()) {
        return [];
    }
    return getMonthlyWindows(yearStart, until);
}
