import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const playwright = await import("playwright").catch(() => null);
const browser = playwright ? await playwright.chromium.launch().catch(() => null) : null;
const skip = !playwright
  ? "Playwright is not installed"
  : !browser
    ? "Playwright could not launch Chromium"
    : false;
const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));
const clockControls =
  "#zone, #local-time, #resolution, #activate, [data-preset], #timer-form input, #timer-form button, [data-advance]";

describe("browser lab", { skip }, () => {
  let server;
  let baseUrl;

  before(async () => {
    server = spawn(process.execPath, [serverPath, "--port=0"], { stdio: ["ignore", "pipe", "inherit"] });
    baseUrl = await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.stdout.once("data", (chunk) => resolve(String(chunk).match(/http:\/\/\S+/)[0]));
    });
  });

  after(async () => {
    await browser.close();
    server.kill();
  });

  async function openLab(t, viewport = { width: 1280, height: 900 }) {
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    page.on("pageerror", (caught) => pageErrors.push(caught.message));
    t.after(async () => {
      await page.close();
      assert.deepEqual(pageErrors, []);
    });
    await page.goto(baseUrl);
    return page;
  }

  const settle = (page) =>
    page.waitForFunction(() => document.querySelector("#status").dataset.loading === "false");
  const read = (page, selector) => page.locator(selector).textContent();
  const pressWithoutWaiting = (page, selector) =>
    page.evaluate((target) => document.querySelector(target).click(), selector);

  async function activate(page, localTime, zone = "Australia/Melbourne") {
    await page.fill("#zone", zone);
    await page.fill("#local-time", localTime);
    await page.click("#activate");
    await settle(page);
  }

  test("disables clock controls while an operation is in flight", async (t) => {
    const page = await openLab(t);
    await pressWithoutWaiting(page, "#activate");
    const during = await page.evaluate((selector) => ({
      allDisabled: [...document.querySelectorAll(selector)].every((control) => control.disabled),
      cancel: document.querySelector("#cancel").hidden ? null : document.querySelector("#cancel").textContent
    }), clockControls);
    assert.deepEqual(during, { allDisabled: true, cancel: "Cancel activation" });
    await settle(page);
    const afterwards = await page.evaluate((selector) => ({
      anyDisabled: [...document.querySelectorAll(selector)].some((control) => control.disabled),
      cancelHidden: document.querySelector("#cancel").hidden
    }), clockControls);
    assert.deepEqual(afterwards, { anyDisabled: false, cancelHidden: true });
  });

  test("cancelling an advance leaves virtual time unchanged", async (t) => {
    const page = await openLab(t);
    await activate(page, "2026-07-24T12:00");
    const before = await read(page, "#virtual-time");
    await pressWithoutWaiting(page, "[data-advance='30']");
    assert.equal(await read(page, "#cancel"), "Cancel advance");
    await page.click("#cancel");
    await settle(page);
    assert.equal(await read(page, "#status"), "Advance cancelled. Virtual time was not changed.");
    assert.equal(await read(page, "#virtual-time"), before);
  });

  test("activates the chosen overlap occurrence and advances across the transition", async (t) => {
    const page = await openLab(t);
    await page.click("text=Melbourne autumn overlap");
    await page.click("#activate");
    await settle(page);
    assert.equal(await page.isVisible("#resolution"), true);
    await page.selectOption("#resolution", "2026-04-04T15:30:00.000Z");
    await page.click("#activate");
    await settle(page);
    assert.equal(await read(page, "#virtual-time"), "2026-04-05 02:30:00 GMT+11");
    await page.click("text=Advance 30 minutes");
    await settle(page);
    assert.equal(await read(page, "#virtual-time"), "2026-04-05 02:00:00 GMT+10");
  });

  test("rebuilds overlap choices when a preset changes the wall time", async (t) => {
    const page = await openLab(t);
    await activate(page, "2026-04-05T02:15");
    await page.click("text=Melbourne autumn overlap");
    assert.equal(await page.isVisible("#resolution"), false);
    await page.click("#activate");
    await settle(page);
    await page.selectOption("#resolution", "2026-04-04T16:30:00.000Z");
    await page.click("#activate");
    await settle(page);
    assert.equal(await read(page, "#virtual-time"), "2026-04-05 02:30:00 GMT+10");
  });

  test("explains that a wall time in a gap cannot be activated", async (t) => {
    const page = await openLab(t);
    await activate(page, "2026-10-04T02:30");
    assert.equal(
      await read(page, "#error"),
      "This local wall time does not exist in the selected zone. Choose another wall time before activation."
    );
    assert.equal(await read(page, "#virtual-time"), "Not activated");
    assert.equal(await page.isVisible("#resolution-label"), false);
  });

  test("reports timers discarded by a new activation", async (t) => {
    const page = await openLab(t);
    await activate(page, "2026-07-24T12:00");
    await page.fill("#timer-label", "Session timeout");
    await page.fill("#timer-delay", "90");
    await page.click("#timer-form button");
    await page.click("#activate");
    await settle(page);
    assert.match(await read(page, "#status"), /1 pending timer was discarded\.$/);
    assert.match(await read(page, "#timeline li:nth-child(2)"), /Discarded 1 pending timer \(Session timeout\) — cleared/);
    assert.equal(await read(page, "#pending-count"), "0");
  });

  test("refuses to schedule a timer without a delay", async (t) => {
    const page = await openLab(t);
    await activate(page, "2026-07-24T12:00");
    await page.fill("#timer-delay", "");
    await page.click("#timer-form button");
    await page.evaluate(() =>
      document.querySelector("#timer-form").dispatchEvent(new Event("submit", { cancelable: true }))
    );
    assert.equal(await read(page, "#pending-count"), "0");
    assert.equal(await read(page, "#error"), "Provide a delay in whole minutes from 0 to 10080.");
  });

  test("fits a phone screen with the overlap choice open", async (t) => {
    const page = await openLab(t, { width: 320, height: 800 });
    await activate(page, "2026-04-05T01:45", "Australia/Lord_Howe");
    assert.equal(await page.isVisible("#resolution"), true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert.equal(overflow, 0);
  });
});
