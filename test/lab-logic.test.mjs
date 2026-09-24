import test from "node:test";
import assert from "node:assert/strict";
import {
  createOperationGate,
  offersOccurrencesFor,
  parseDelayMinutes,
  wait
} from "../public/lab-logic.mjs";
import { classifyLocalTime } from "../src/zoned-time.mjs";

test("a new operation supersedes the one in flight", () => {
  const operations = createOperationGate();
  const first = operations.begin();
  const second = operations.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  first.finish();
  assert.equal(second.isCurrent(), true, "a superseded operation must not release the newer one");
  second.finish();
  assert.equal(second.isCurrent(), false);
});

test("cancelling aborts the current operation but leaves it in charge of cleanup", () => {
  const operations = createOperationGate();
  operations.cancel();
  const operation = operations.begin();
  operations.cancel();
  assert.equal(operation.signal.aborted, true);
  assert.equal(operation.isCurrent(), true);
  operation.finish();
  const next = operations.begin();
  assert.equal(next.signal.aborted, false);
});

test("waits for the duration unless the operation is aborted", async () => {
  const finished = new AbortController();
  let removed = false;
  const signal = finished.signal;
  const original = signal.removeEventListener.bind(signal);
  signal.removeEventListener = (...args) => {
    removed = true;
    return original(...args);
  };
  await wait(signal, 5);
  assert.equal(removed, true, "the abort listener is removed once the wait ends");

  const aborted = new AbortController();
  const pending = wait(aborted.signal, 10_000);
  aborted.abort();
  await assert.rejects(pending, { name: "AbortError" });

  await assert.rejects(wait(aborted.signal, 5), { name: "AbortError" });
});

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
