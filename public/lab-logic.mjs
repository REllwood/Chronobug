// Starting an operation aborts the one before it; only the newest may update the interface.
export function createOperationGate() {
  let current = null;
  return {
    begin() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return {
        signal: controller.signal,
        isCurrent: () => current === controller,
        finish() {
          if (current === controller) current = null;
        }
      };
    },
    cancel() {
      current?.abort();
    }
  };
}

export function wait(signal, duration) {
  return new Promise((resolve, reject) => {
    const cancelled = () => new DOMException("Cancelled", "AbortError");
    if (signal.aborted) {
      reject(cancelled());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, duration);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function parseDelayMinutes(raw, maxMinutes) {
  const text = String(raw ?? "").trim();
  const minutes = text === "" ? Number.NaN : Number(text);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= maxMinutes ? minutes : null;
}

export function offersOccurrencesFor(offeredValues, classification) {
  const offered = offeredValues.filter(Boolean);
  return (
    offered.length === classification.matches.length &&
    classification.matches.every((match) => offered.includes(match.iso))
  );
}
