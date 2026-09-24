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

test("keeps each timer's remaining delay when the instant is set", () => {
  const clock = new VirtualClock(0);
  const seen = [];
  clock.schedule(({ clock: current }) => seen.push(current.now()), 500, "half-second");
  clock.setInstant(1000);
  assert.equal(clock.pending()[0].dueAt, 1500);
  clock.advanceBy(10);
  assert.deepEqual(seen, []);
  clock.advanceBy(490);
  assert.deepEqual(seen, [1500]);
  clock.schedule(() => {}, 100, "rewound");
  clock.setInstant(0);
  assert.equal(clock.pending()[0].dueAt, 100);
});

test("rejects clock changes from inside a timer callback", () => {
  const clock = new VirtualClock(0);
  clock.schedule(({ clock: current }) => current.advanceBy(1000), 10, "nested advance");
  clock.schedule(({ clock: current }) => current.setInstant(5000), 20, "nested jump");
  const result = clock.advanceBy(100);
  assert.equal(result.completed, true);
  assert.deepEqual(
    result.events.map((event) => [event.label, event.outcome]),
    [["nested advance", "failed"], ["nested jump", "failed"]]
  );
  assert.match(result.events[0].message, /advanceBy\(\) cannot be called from inside a timer callback/);
  assert.match(result.events[1].message, /setInstant\(\) cannot be called from inside a timer callback/);
  assert.equal(clock.now(), 100);
  assert.equal(clock.advanceBy(1).completed, true);
});

test("never moves virtual time backwards while advancing", () => {
  const clock = new VirtualClock(0);
  const observed = [];
  const record = ({ clock: current }) => observed.push(current.now());
  clock.schedule(record, 300, "c");
  clock.schedule(record, 100, "a");
  clock.setInstant(250);
  clock.schedule(record, 0, "b");
  observed.push(clock.now());
  clock.advanceBy(1000);
  assert.deepEqual(observed, [...observed].sort((first, second) => first - second));
  assert.equal(observed.length, 4);
  assert.equal(clock.now(), 1250);
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
