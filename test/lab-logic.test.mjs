import test from "node:test";
import assert from "node:assert/strict";
import { offersOccurrencesFor, parseDelayMinutes } from "../public/lab-logic.mjs";
import { classifyLocalTime } from "../src/zoned-time.mjs";

test("accepts whole-minute timer delays within the limit", () => {
  assert.equal(parseDelayMinutes("20", 10080), 20);
  assert.equal(parseDelayMinutes("0", 10080), 0);
  assert.equal(parseDelayMinutes(" 10080 ", 10080), 10080);
  assert.equal(parseDelayMinutes("1e3", 10080), 1000);
});

test("rejects empty, negative, fractional and oversized timer delays", () => {
  for (const raw of ["", "   ", undefined, "-1", "1.5", "10081", "abc", "Infinity"]) {
    assert.equal(parseDelayMinutes(raw, 10080), null, `expected ${JSON.stringify(raw)} to be rejected`);
  }
});

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
