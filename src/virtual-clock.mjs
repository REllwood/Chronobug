function validateMillis(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
  return value;
}

export class VirtualClock {
  #now;
  #sequence = 0;
  #timers = new Map();
  #advancing = false;

  constructor(startInstant = Date.now()) {
    this.#now = validateMillis(startInstant, "Start instant");
  }

  #assertNotAdvancing(method) {
    if (this.#advancing) {
      throw new Error(`${method}() cannot be called from inside a timer callback.`);
    }
  }

  now() {
    return this.#now;
  }

  // Like setTimeout across a system clock change, pending timers keep their remaining delay.
  setInstant(instant) {
    this.#assertNotAdvancing("setInstant");
    validateMillis(instant, "Instant");
    const shift = instant - this.#now;
    for (const timer of this.#timers.values()) timer.dueAt += shift;
    this.#now = instant;
    return this.#now;
  }

  schedule(callback, delay, label = "unnamed timer") {
    if (typeof callback !== "function") throw new TypeError("Timer callback must be a function.");
    validateMillis(delay, "Delay");
    if (delay < 0) throw new RangeError("Delay cannot be negative.");
    const id = `timer-${++this.#sequence}`;
    this.#timers.set(id, {
      id,
      label: String(label),
      dueAt: this.#now + delay,
      sequence: this.#sequence,
      callback
    });
    return id;
  }

  cancel(id) {
    return this.#timers.delete(id);
  }

  pending() {
    return [...this.#timers.values()]
      .sort((first, second) => first.dueAt - second.dueAt || first.sequence - second.sequence)
      .map(({ callback: _callback, ...timer }) => ({ ...timer }));
  }

  advanceBy(duration, { maxCallbacks = 1000 } = {}) {
    this.#assertNotAdvancing("advanceBy");
    validateMillis(duration, "Advance duration");
    if (duration < 0) throw new RangeError("Virtual time cannot advance by a negative duration.");
    if (!Number.isInteger(maxCallbacks) || maxCallbacks < 1) {
      throw new RangeError("maxCallbacks must be a positive integer.");
    }
    const target = this.#now + duration;
    const events = [];
    let callbacks = 0;

    this.#advancing = true;
    try {
      while (true) {
        const next = this.pending().find((timer) => timer.dueAt <= target);
        if (!next) break;
        if (callbacks >= maxCallbacks) {
          return {
            completed: false,
            now: this.#now,
            target,
            events,
            pending: this.pending(),
            reason: `Stopped after ${maxCallbacks} callbacks to prevent a runaway timer loop.`
          };
        }
        const timer = this.#timers.get(next.id);
        this.#timers.delete(next.id);
        this.#now = timer.dueAt;
        callbacks += 1;
        try {
          timer.callback({ clock: this, timerId: timer.id, dueAt: timer.dueAt });
          events.push({
            id: timer.id,
            label: timer.label,
            at: timer.dueAt,
            outcome: "completed"
          });
        } catch (error) {
          events.push({
            id: timer.id,
            label: timer.label,
            at: timer.dueAt,
            outcome: "failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } finally {
      this.#advancing = false;
    }
    this.#now = target;
    return {
      completed: true,
      now: this.#now,
      target,
      events,
      pending: this.pending(),
      reason: null
    };
  }

  exportScenario({ name, zone, resolution = "exact" }) {
    if (!name?.trim()) throw new TypeError("Scenario name is required.");
    if (!zone?.trim()) throw new TypeError("Scenario zone is required.");
    return {
      version: 1,
      name: name.trim(),
      instant: new Date(this.#now).toISOString(),
      zone,
      resolution,
      pendingTimers: this.pending().map(({ id, label, dueAt }) => ({
        id,
        label,
        dueAt: new Date(dueAt).toISOString()
      }))
    };
  }
}
