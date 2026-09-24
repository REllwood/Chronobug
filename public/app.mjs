import { VirtualClock } from "/virtual-clock-core.mjs";
import {
  classifyLocalTime,
  formatInZone,
  selectInstantForActivation
} from "/zoned-time-core.mjs";
import { offersOccurrencesFor, parseDelayMinutes } from "/lab-logic.mjs";

const scenarioForm = document.querySelector("#scenario-form");
const zoneInput = document.querySelector("#zone");
const localTimeInput = document.querySelector("#local-time");
const resolutionLabel = document.querySelector("#resolution-label");
const resolutionInput = document.querySelector("#resolution");
const activateButton = document.querySelector("#activate");
const cancelButton = document.querySelector("#cancel");
const status = document.querySelector("#status");
const error = document.querySelector("#error");
const virtualTime = document.querySelector("#virtual-time");
const realTime = document.querySelector("#real-time");
const activeZone = document.querySelector("#active-zone");
const pendingCount = document.querySelector("#pending-count");
const timerForm = document.querySelector("#timer-form");
const timerLabel = document.querySelector("#timer-label");
const timerDelay = document.querySelector("#timer-delay");
const timeline = document.querySelector("#timeline");
const presetButtons = [...document.querySelectorAll("[data-preset]")];
const advanceButtons = [...document.querySelectorAll("[data-advance]")];
const operationControls = [
  activateButton,
  zoneInput,
  localTimeInput,
  resolutionInput,
  ...presetButtons,
  ...timerForm.elements,
  ...advanceButtons
];
let clock = null;
let activatedZone = null;
let controller = null;

function setBusy(busy, message = "") {
  scenarioForm.setAttribute("aria-busy", String(busy));
  status.dataset.loading = String(busy);
  status.textContent = message;
  operationControls.forEach((control) => {
    control.disabled = busy;
  });
  cancelButton.hidden = !busy;
}

function wait(signal, duration = 160) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, duration);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true }
    );
  });
}

function resetResolution() {
  resolutionLabel.hidden = true;
  resolutionInput.replaceChildren();
}

function updateReadout() {
  if (!clock) {
    virtualTime.textContent = "Not activated";
    activeZone.textContent = "Not activated";
    pendingCount.textContent = "0";
    return;
  }
  virtualTime.textContent = formatInZone(clock.now(), activatedZone);
  activeZone.textContent = activatedZone;
  pendingCount.textContent = String(clock.pending().length);
}

function addEvent(at, label, outcome) {
  if (timeline.querySelector(".empty")) timeline.replaceChildren();
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.dateTime = new Date(at).toISOString();
  time.textContent =
    clock && activatedZone ? formatInZone(at, activatedZone) : new Date(at).toISOString();
  const message = document.createElement("span");
  message.textContent = `${label} — ${outcome}`;
  item.append(time, message);
  timeline.prepend(item);
}

setInterval(() => {
  realTime.textContent = new Date().toLocaleString("en-AU", { hour12: false });
}, 1000);
realTime.textContent = new Date().toLocaleString("en-AU", { hour12: false });

for (const preset of presetButtons) {
  preset.addEventListener("click", () => {
    localTimeInput.value = preset.dataset.preset;
    resetResolution();
    status.textContent = `${preset.textContent} loaded. Resolve it to inspect the mapping.`;
  });
}

scenarioForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  controller?.abort();
  const operationController = new AbortController();
  controller = operationController;
  error.hidden = true;
  error.textContent = "";
  setBusy(true, "Searching the zone timeline for matching instants…");
  try {
    await wait(operationController.signal);
    if (controller !== operationController) {
      throw new DOMException("Superseded", "AbortError");
    }
    const classification = classifyLocalTime(localTimeInput.value, zoneInput.value);
    if (classification.kind === "gap") {
      resolutionLabel.hidden = true;
      throw new Error("This local wall time does not exist in the selected zone. Choose an explicit instant before activation.");
    }
    const offered = [...resolutionInput.options].map((option) => option.value);
    if (classification.kind === "overlap" && !offersOccurrencesFor(offered, classification)) {
      resolutionInput.replaceChildren();
      const prompt = document.createElement("option");
      prompt.value = "";
      prompt.textContent = "Choose an occurrence";
      prompt.disabled = true;
      prompt.selected = true;
      resolutionInput.append(prompt);
      classification.matches.forEach((match, index) => {
        const option = document.createElement("option");
        option.value = match.iso;
        option.textContent = `${index === 0 ? "Earlier" : "Later"} occurrence — ${match.iso} (${match.offset})`;
        resolutionInput.append(option);
      });
      resolutionLabel.hidden = false;
      setBusy(false, "This wall time occurs twice. Choose the earlier or later instant, then activate again.");
      return;
    }
    const selected = selectInstantForActivation(classification, resolutionInput.value);
    const discarded = clock?.pending() ?? [];
    if (discarded.length > 0) {
      const labels = discarded.map((timer) => timer.label).join(", ");
      addEvent(
        clock.now(),
        `Discarded ${discarded.length} pending timer${discarded.length === 1 ? "" : "s"} (${labels})`,
        "cleared"
      );
    }
    clock = new VirtualClock(selected.instant);
    activatedZone = classification.zone;
    resolutionLabel.hidden = classification.kind !== "overlap";
    updateReadout();
    addEvent(clock.now(), `Scenario activated (${classification.kind})`, "ready");
    const discardNote =
      discarded.length === 0
        ? ""
        : ` ${discarded.length} pending timer${discarded.length === 1 ? " was" : "s were"} discarded.`;
    setBusy(false, `Virtual application clock activated at ${selected.iso}.${discardNote}`);
  } catch (caught) {
    if (controller !== operationController) return;
    setBusy(false);
    if (caught.name === "AbortError") {
      status.textContent = "Scenario activation cancelled. The previous clock remains active.";
    } else {
      error.hidden = false;
      error.textContent = caught instanceof Error ? caught.message : "Scenario activation failed.";
      status.textContent = "Scenario was not activated.";
    }
  } finally {
    if (controller === operationController) controller = null;
  }
});

cancelButton.addEventListener("click", () => controller?.abort());

localTimeInput.addEventListener("input", resetResolution);
zoneInput.addEventListener("input", resetResolution);

timerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!clock) {
    error.hidden = false;
    error.textContent = "Activate a valid scenario before scheduling a timer.";
    return;
  }
  error.hidden = true;
  const maxMinutes = Number(timerDelay.max);
  const minutes = parseDelayMinutes(timerDelay.value, maxMinutes);
  const label = timerLabel.value.trim();
  if (!label) {
    error.hidden = false;
    error.textContent = "Provide a timer label.";
    return;
  }
  if (minutes === null) {
    error.hidden = false;
    error.textContent = `Provide a delay in whole minutes from 0 to ${maxMinutes}.`;
    return;
  }
  clock.schedule(() => {}, minutes * 60_000, label);
  addEvent(clock.now(), `${label} scheduled for ${minutes} minute${minutes === 1 ? "" : "s"}`, "pending");
  updateReadout();
});

for (const advanceButton of advanceButtons) {
  advanceButton.addEventListener("click", async () => {
    if (!clock) {
      error.hidden = false;
      error.textContent = "Activate a valid scenario before advancing time.";
      return;
    }
    controller?.abort();
    const operationController = new AbortController();
    controller = operationController;
    const minutes = Number(advanceButton.dataset.advance);
    error.hidden = true;
    setBusy(true, `Advancing ${minutes} virtual minute${minutes === 1 ? "" : "s"}…`);
    try {
      await wait(operationController.signal, minutes >= 1440 ? 260 : 120);
      if (controller !== operationController) {
        throw new DOMException("Superseded", "AbortError");
      }
      const result = clock.advanceBy(minutes * 60_000, { maxCallbacks: 250 });
      result.events.forEach((entry) => addEvent(entry.at, entry.label, entry.outcome));
      updateReadout();
      if (!result.completed) {
        error.hidden = false;
        error.textContent = result.reason;
        setBusy(false, "Advance stopped at the timer safety guard.");
      } else {
        addEvent(clock.now(), `Advanced ${minutes} minutes`, "complete");
        setBusy(false, `${result.events.length} timer${result.events.length === 1 ? "" : "s"} fired.`);
      }
    } catch (caught) {
      if (controller !== operationController) return;
      setBusy(false);
      status.textContent =
        caught.name === "AbortError"
          ? "Advance cancelled. Virtual time was not changed."
          : "Advance failed.";
      if (caught.name !== "AbortError") {
        error.hidden = false;
        error.textContent = caught instanceof Error ? caught.message : "Advance failed.";
      }
    } finally {
      if (controller === operationController) controller = null;
    }
  });
}

updateReadout();
