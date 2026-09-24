export function parseDelayMinutes(raw, maxMinutes) {
  const text = String(raw ?? "").trim();
  const minutes = text === "" ? Number.NaN : Number(text);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= maxMinutes ? minutes : null;
}

export function offersOccurrencesFor(offeredValues, classification) {
  const offered = offeredValues.filter(Boolean);
  return (
    offered.length === classification.matches.length &&
    classification.matches.every((match) => offered.includes(match.iso))
  );
}
