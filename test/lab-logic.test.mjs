import test from "node:test";
import assert from "node:assert/strict";
import { offersOccurrencesFor } from "../public/lab-logic.mjs";
import { classifyLocalTime } from "../src/zoned-time.mjs";

test("recognises when the offered occurrences belong to the current overlap", () => {
  const overlap = classifyLocalTime("2026-04-05T02:30", "Australia/Melbourne");
  const offered = ["", ...overlap.matches.map((match) => match.iso)];
  assert.equal(offersOccurrencesFor(offered, overlap), true);
  assert.equal(offersOccurrencesFor([], overlap), false);
  assert.equal(offersOccurrencesFor([""], overlap), false);
});

test("treats occurrences left over from another wall time as stale", () => {
  const earlier = classifyLocalTime("2026-04-05T02:15", "Australia/Melbourne");
  const current = classifyLocalTime("2026-04-05T02:30", "Australia/Melbourne");
  const stale = ["", ...earlier.matches.map((match) => match.iso)];
  assert.equal(offersOccurrencesFor(stale, current), false);
});
