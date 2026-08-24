/**
 * Exact local wall-time ↔ UTC conversion using the platform IANA tz database.
 *
 * `Date` alone silently normalizes nonexistent DST times and arbitrarily picks
 * one side of repeated times. This helper enumerates the zone offsets around
 * the requested wall time, rejects gaps, and requires an explicit earlier/later
 * choice for overlaps.
 */

function zonedError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 422;
  error.details = details;
  return error;
}

function formatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw zonedError('timeZone must be a valid IANA time-zone identifier.', 'invalid_time_zone');
  }
}

function partsForInstant(instantMs, timeZone) {
  const parts = Object.fromEntries(
    formatter(timeZone).formatToParts(new Date(instantMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function parseLocal(value) {
  const match = String(value || '').match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) {
    throw zonedError(
      'Local date/time must use YYYY-MM-DDTHH:mm.',
      'invalid_local_date_time',
    );
  }
  const [, year, month, day, hour, minute, second = '00'] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  const naiveMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const roundTrip = new Date(naiveMs);
  if (roundTrip.getUTCFullYear() !== parts.year
    || roundTrip.getUTCMonth() + 1 !== parts.month
    || roundTrip.getUTCDate() !== parts.day
    || roundTrip.getUTCHours() !== parts.hour
    || roundTrip.getUTCMinutes() !== parts.minute
    || roundTrip.getUTCSeconds() !== parts.second) {
    throw zonedError('Local date/time is not a real calendar value.', 'invalid_local_date_time');
  }
  return { parts, naiveMs };
}

function sameParts(left, right) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function offsetMinutesAt(instantMs, timeZone) {
  const local = partsForInstant(instantMs, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return Math.round((asUtc - instantMs) / 60000);
}

/**
 * Resolve one local wall time into an exact UTC ISO string.
 *
 * @param {string} localDateTime YYYY-MM-DDTHH:mm[:ss]
 * @param {string} timeZone IANA identifier
 * @param {'reject'|'earlier'|'later'} [disambiguation]
 */
export function resolveZonedDateTime(localDateTime, timeZone, disambiguation = 'reject') {
  formatter(timeZone);
  if (!['reject', 'earlier', 'later'].includes(disambiguation)) {
    throw zonedError('disambiguation must be reject, earlier, or later.', 'invalid_disambiguation');
  }
  const { parts, naiveMs } = parseLocal(localDateTime);
  const offsets = new Set();
  for (let hours = -48; hours <= 48; hours += 3) {
    offsets.add(offsetMinutesAt(naiveMs + hours * 60 * 60 * 1000, timeZone));
  }
  const candidates = [...offsets]
    .map((offsetMinutes) => naiveMs - offsetMinutes * 60 * 1000)
    .filter((candidateMs) => sameParts(partsForInstant(candidateMs, timeZone), parts))
    .filter((candidateMs, index, rows) => rows.indexOf(candidateMs) === index)
    .sort((a, b) => a - b);

  if (candidates.length === 0) {
    throw zonedError(
      'This local time does not exist in the selected time zone because of a clock change.',
      'nonexistent_local_time',
      { localDateTime, timeZone },
    );
  }
  if (candidates.length > 1 && disambiguation === 'reject') {
    throw zonedError(
      'This local time occurs twice in the selected time zone. Choose the earlier or later occurrence.',
      'ambiguous_local_time',
      { localDateTime, timeZone, candidates: candidates.map((value) => new Date(value).toISOString()) },
    );
  }
  const selected = disambiguation === 'later'
    ? candidates[candidates.length - 1]
    : candidates[0];
  return new Date(selected).toISOString();
}

export function formatZonedLocalInput(isoInstant, timeZone) {
  const instantMs = Date.parse(String(isoInstant || ''));
  if (!Number.isFinite(instantMs)) return null;
  const parts = partsForInstant(instantMs, timeZone);
  const pad = (value) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
    + `T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function validateZonedRange({
  startLocal,
  endLocal,
  timeZone,
  disambiguation = 'reject',
}) {
  const startIso = resolveZonedDateTime(startLocal, timeZone, disambiguation);
  const endIso = resolveZonedDateTime(endLocal, timeZone, disambiguation);
  if (Date.parse(endIso) <= Date.parse(startIso)) {
    throw zonedError('End time must be after start time.', 'invalid_time_range');
  }
  return { startIso, endIso };
}
