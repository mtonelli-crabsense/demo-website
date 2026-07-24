export function formatGaDate(rawDate: string): string {
  return `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
}

export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

export type DateRangeParams = {
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
};

// Resolves start/end query params into a validated range (defaulting to the
// last 7 days) plus an equal-length immediately-preceding previous range,
// used by every GA4 route to build the two-dateRanges comparison call.
export function resolveDateRange(
  startParam: string | null,
  endParam: string | null
): DateRangeParams | { error: string } {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  let start = startParam ? parseIsoDate(startParam) : null;
  let end = endParam ? parseIsoDate(endParam) : null;

  if (!start || !end) {
    end = today;
    start = addDays(today, -6);
  }

  if (end.getTime() > today.getTime()) {
    end = today;
  }

  if (start.getTime() > end.getTime()) {
    return { error: "La fecha 'Desde' no puede ser posterior a la fecha 'Hasta'" };
  }

  const periodLengthDays =
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(periodLengthDays - 1));

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
    previousStartDate: formatDate(previousStart),
    previousEndDate: formatDate(previousEnd),
  };
}
