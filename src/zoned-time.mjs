const formatterCache = new Map();
const SEARCH_WINDOW = 16 * 60 * 60 * 1000;
const OFFSET_SAMPLE_STEP = 15 * 60 * 1000;

function formatterFor(zone) {
  if (!formatterCache.has(zone)) {
    formatterCache.set(
      zone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZoneName: "shortOffset"
      })
    );
  }
  return formatterCache.get(zone);
}

export function zonedParts(instant, zone) {
  if (typeof zone !== "string" || !zone.trim()) {
    throw new TypeError("A time zone name is required.");
  }
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Instant is outside the range JavaScript dates can represent.");
  }
  let formatter;
  try {
    formatter = formatterFor(zone);
  } catch {
    throw new RangeError(`Time zone "${zone}" is not supported by this runtime.`);
  }
  const parts = formatter.formatToParts(date);
  const result = {};
  for (const part of parts) {
    if (part.type !== "literal") result[part.type] = part.value;
  }
  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second),
    offset: result.timeZoneName ?? null
  };
}

export function parseLocalDateTime(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) {
    throw new TypeError("Local time must use YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    throw new RangeError("Local time contains an impossible calendar date.");
  }
  return { year, month, day, hour, minute, second };
}

function wallClockMillis(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

// Every instant showing the target wall time is `naive - offset` for an offset the zone
// uses within the search window, so sample the window for offsets and test each candidate.
export function possibleInstantsForLocal(localValue, zone) {
  const target = parseLocalDateTime(localValue);
  const naive = wallClockMillis(target);
  const offsets = new Set();
  const start = naive - SEARCH_WINDOW - OFFSET_SAMPLE_STEP;
  const end = naive + SEARCH_WINDOW + OFFSET_SAMPLE_STEP;
  for (let instant = start; instant <= end; instant += OFFSET_SAMPLE_STEP) {
    offsets.add(wallClockMillis(zonedParts(instant, zone)) - instant);
  }
  const matches = [];
  for (const offset of offsets) {
    const instant = naive - offset;
    const parts = zonedParts(instant, zone);
    if (wallClockMillis(parts) === naive) {
      matches.push({ instant, iso: new Date(instant).toISOString(), offset: parts.offset });
    }
  }
  return matches.sort((first, second) => first.instant - second.instant);
}

export function classifyLocalTime(localValue, zone) {
  const matches = possibleInstantsForLocal(localValue, zone);
  return {
    localValue,
    zone,
    kind: matches.length === 0 ? "gap" : matches.length === 1 ? "exact" : "overlap",
    matches
  };
}

export function selectInstantForActivation(classification, selectedIso = "") {
  if (!classification || !Array.isArray(classification.matches)) {
    throw new TypeError("A valid time classification is required.");
  }
  if (classification.kind === "gap" || classification.matches.length === 0) {
    throw new RangeError(
      "This local wall time does not exist in the selected zone. Choose another wall time before activation."
    );
  }
  if (classification.kind === "overlap") {
    if (!selectedIso) {
      throw new RangeError("Choose the earlier or later occurrence before activation.");
    }
    const selected = classification.matches.find((match) => match.iso === selectedIso);
    if (!selected) {
      throw new RangeError("The selected occurrence does not belong to this wall-time scenario.");
    }
    return selected;
  }
  if (classification.kind !== "exact" || classification.matches.length !== 1) {
    throw new RangeError("The wall-time classification is incomplete.");
  }
  return classification.matches[0];
}

export function formatInZone(instant, zone) {
  const parts = zonedParts(instant, zone);
  const pad = (value) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ${parts.offset ?? zone}`;
}
