export function offersOccurrencesFor(offeredValues, classification) {
  const offered = offeredValues.filter(Boolean);
  return (
    offered.length === classification.matches.length &&
    classification.matches.every((match) => offered.includes(match.iso))
  );
}
