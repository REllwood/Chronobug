import test from "node:test";
import assert from "node:assert/strict";
import { VirtualClock } from "../src/virtual-clock.mjs";
import {
  classifyLocalTime,
  formatInZone,
  parseLocalDateTime,
  selectInstantForActivation,
  zonedParts
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

test("orders overlapping occurrences from earlier to later", () => {
  const overlap = classifyLocalTime("2026-04-05T02:30", "Australia/Melbourne");
  assert.deepEqual(
    overlap.matches.map((match) => [match.iso, match.offset]),
    [
      ["2026-04-04T15:30:00.000Z", "GMT+11"],
      ["2026-04-04T16:30:00.000Z", "GMT+10"]
    ]
  );
});

test("resolves zones whose offsets include seconds", () => {
  const noon = classifyLocalTime("1970-06-01T12:00", "Africa/Monrovia");
  assert.equal(noon.kind, "exact");
  assert.equal(noon.matches[0].iso, "1970-06-01T12:44:30.000Z");
  assert.equal(noon.matches[0].offset, "GMT-0:44:30");
});

test("resolves wall times with seconds", () => {
  const overlap = classifyLocalTime("2026-04-05T02:30:15", "Australia/Melbourne");
  assert.equal(overlap.kind, "overlap");
  assert.deepEqual(
    overlap.matches.map((match) => match.iso),
    ["2026-04-04T15:30:15.000Z", "2026-04-04T16:30:15.000Z"]
  );
  assert.equal(classifyLocalTime("2026-10-04T02:59:59", "Australia/Melbourne").kind, "gap");
  assert.equal(classifyLocalTime("2026-10-04T03:00:00", "Australia/Melbourne").kind, "exact");
});

test("classifies unusual transitions around the world", () => {
  const kind = (local, zone) => classifyLocalTime(local, zone).kind;
  assert.equal(kind("2026-10-04T02:15", "Australia/Lord_Howe"), "gap");
  assert.equal(kind("2026-10-04T02:30", "Australia/Lord_Howe"), "exact");
  assert.equal(kind("2026-04-05T01:45", "Australia/Lord_Howe"), "overlap");
  assert.equal(kind("2011-12-30T12:00", "Pacific/Apia"), "gap");
  assert.equal(kind("2011-12-29T23:59", "Pacific/Apia"), "exact");
  assert.equal(kind("2026-03-08T02:30", "America/New_York"), "gap");
  assert.equal(kind("2026-11-01T01:30", "America/New_York"), "overlap");
  const kathmandu = classifyLocalTime("2026-01-01T09:00", "Asia/Kathmandu");
  assert.equal(kathmandu.matches[0].iso, "2026-01-01T03:15:00.000Z");
});

test("formats ordinary instants and rejects impossible calendar input", () => {
  const ordinary = classifyLocalTime("2026-07-24T12:00", "Australia/Melbourne");
  assert.equal(ordinary.kind, "exact");
  assert.match(formatInZone(ordinary.matches[0].instant, "Australia/Melbourne"), /2026-07-24 12:00:00/);
  assert.throws(() => parseLocalDateTime("2026-02-31T12:00"), /impossible/);
  assert.throws(() => classifyLocalTime("2026-01-01T00:00", "Not/AZone"), /not supported/);
});

test("refuses to activate a wall time that falls in a gap", () => {
  const gap = classifyLocalTime("2026-10-04T02:30", "Australia/Melbourne");
  assert.throws(
    () => selectInstantForActivation(gap),
    /does not exist in the selected zone\. Choose another wall time before activation\./
  );
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

test("reports out-of-range instants and missing zones plainly", () => {
  assert.throws(() => zonedParts(1e20, "UTC"), /outside the range JavaScript dates can represent/);
  assert.throws(() => zonedParts(0, "Not/AZone"), /"Not\/AZone" is not supported/);
  assert.throws(() => classifyLocalTime("2026-07-24T12:00", undefined), /time zone name is required/);
  assert.throws(() => classifyLocalTime("2026-07-24T12:00", "  "), /time zone name is required/);
});

test("keeps the virtual clock inside the range JavaScript dates support", () => {
  assert.throws(() => new VirtualClock(1e20), /Start instant is outside the range/);
  const clock = new VirtualClock(8.64e15 - 1000);
  assert.throws(() => clock.setInstant(-1e20), /Instant is outside the range/);
  assert.throws(() => clock.advanceBy(2000), /Advance target is outside the range/);
  assert.throws(() => clock.schedule(() => {}, 2000, "late"), /Timer due time is outside the range/);
  clock.schedule(() => {}, 500, "edge");
  assert.throws(() => clock.setInstant(8.64e15), /Timer "edge" due time is outside the range/);
  assert.equal(clock.now(), 8.64e15 - 1000);
  assert.equal(clock.pending()[0].dueAt, 8.64e15 - 500);
  assert.equal(clock.exportScenario({ name: "Edge", zone: "UTC" }).pendingTimers.length, 1);
});

test("requires string names and zones when exporting a scenario", () => {
  const clock = new VirtualClock(0);
  assert.throws(() => clock.exportScenario({ name: 42, zone: "UTC" }), /Scenario name is required/);
  assert.throws(() => clock.exportScenario({ name: "Case", zone: null }), /Scenario zone is required/);
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
