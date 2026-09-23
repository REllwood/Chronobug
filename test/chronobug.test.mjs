import test from "node:test";
import assert from "node:assert/strict";
import { VirtualClock } from "../src/virtual-clock.mjs";
import {
  classifyLocalTime,
  formatInZone,
  parseLocalDateTime,
  selectInstantForActivation
} from "../src/zoned-time.mjs";

test("fires timers in deterministic due-time and insertion order", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const clock = new VirtualClock(start);
  const fired = [];
  clock.schedule(() => fired.push("later"), 2000, "later");
  clock.schedule(() => fired.push("first"), 1000, "first");
  clock.schedule(() => fired.push("second"), 1000, "second");
  const result = clock.advanceBy(2500);
  assert.equal(result.completed, true);
  assert.deepEqual(fired, ["first", "second", "later"]);
  assert.equal(clock.now(), start + 2500);
});

test("supports callback scheduling and stops runaway loops", () => {
  const clock = new VirtualClock(0);
  const repeat = () => clock.schedule(repeat, 0, "repeat");
  clock.schedule(repeat, 0, "repeat");
  const result = clock.advanceBy(1, { maxCallbacks: 5 });
  assert.equal(result.completed, false);
  assert.equal(result.events.length, 5);
  assert.equal(result.pending.length, 1);
  assert.match(result.reason, /runaway/);
});

test("isolates failed callbacks and continues advancing", () => {
  const clock = new VirtualClock(0);
  clock.schedule(() => {
    throw new Error("fixture failure");
  }, 1, "broken");
  const result = clock.advanceBy(2);
  assert.equal(result.completed, true);
  assert.equal(result.events[0].outcome, "failed");
  assert.equal(result.events[0].message, "fixture failure");
});

test("classifies Melbourne daylight-saving gap and overlap", () => {
  const gap = classifyLocalTime("2026-10-04T02:30", "Australia/Melbourne");
  const overlap = classifyLocalTime("2026-04-05T02:30", "Australia/Melbourne");
  assert.equal(gap.kind, "gap");
  assert.equal(gap.matches.length, 0);
  assert.equal(overlap.kind, "overlap");
  assert.equal(overlap.matches.length, 2);
  assert.notEqual(overlap.matches[0].offset, overlap.matches[1].offset);
});

test("formats ordinary instants and rejects impossible calendar input", () => {
  const ordinary = classifyLocalTime("2026-07-24T12:00", "Australia/Melbourne");
  assert.equal(ordinary.kind, "exact");
  assert.match(formatInZone(ordinary.matches[0].instant, "Australia/Melbourne"), /2026-07-24 12:00:00/);
  assert.throws(() => parseLocalDateTime("2026-02-31T12:00"), /impossible/);
  assert.throws(() => classifyLocalTime("2026-01-01T00:00", "Not/AZone"), /not supported/);
});

test("requires a deliberate, exact choice for overlapping wall times", () => {
  const overlap = classifyLocalTime("2026-04-05T02:30", "Australia/Melbourne");
  assert.throws(
    () => selectInstantForActivation(overlap),
    /Choose the earlier or later occurrence/
  );
  assert.throws(
    () => selectInstantForActivation(overlap, "2026-04-05T00:00:00.000Z"),
    /does not belong/
  );
  assert.equal(
    selectInstantForActivation(overlap, overlap.matches[1].iso).iso,
    overlap.matches[1].iso
  );
});

test("exports readable scenario metadata without callback values", () => {
  const clock = new VirtualClock(Date.parse("2026-01-01T00:00:00.000Z"));
  clock.schedule(() => {}, 1000, "expiry");
  const scenario = clock.exportScenario({
    name: "Expiry boundary",
    zone: "Australia/Melbourne"
  });
  assert.equal(scenario.name, "Expiry boundary");
  assert.equal(scenario.pendingTimers[0].label, "expiry");
  assert.equal("callback" in scenario.pendingTimers[0], false);
});
