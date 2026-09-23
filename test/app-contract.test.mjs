import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../public/app.mjs", import.meta.url), "utf8");

test("clock mutations are disabled while an async operation owns the interface", () => {
  assert.match(appSource, /const operationControls = \[/);
  assert.match(appSource, /\.\.\.advanceButtons/);
  assert.match(appSource, /\.\.\.timerForm\.elements/);
  assert.match(
    appSource,
    /operationControls\.forEach\(\(control\) => \{[\s\S]*?control\.disabled = busy/
  );
});

test("superseded operations cannot clear the active controller or busy state", () => {
  const ownershipChecks = appSource.match(/controller !== operationController/g) ?? [];
  const guardedCleanup = appSource.match(
    /if \(controller === operationController\) controller = null/g
  ) ?? [];
  assert.ok(ownershipChecks.length >= 4);
  assert.equal(guardedCleanup.length, 2);
});
