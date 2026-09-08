import test from "node:test";
import assert from "node:assert/strict";

import { decidePresenceProbe } from "../src/app/libs/connection/presenceProbe";

test("presence probe gives a new ping a timeout window before counting failure", () => {
  const first = decidePresenceProbe(5_000, { lastPongAt: 0, lastProbeAt: 0, failures: 0 });
  assert.deepEqual(first, { shouldProbe: true, failures: 1, shouldRemove: false });

  const stillWaiting = decidePresenceProbe(10_000, { lastPongAt: 0, lastProbeAt: 5_000, failures: 1 });
  assert.deepEqual(stillWaiting, { shouldProbe: false, failures: 1, shouldRemove: false });
});

test("presence probe resets failures after a recent pong and removes only after completed timeouts", () => {
  const healthy = decidePresenceProbe(12_000, { lastPongAt: 10_000, lastProbeAt: 5_000, failures: 2 });
  assert.deepEqual(healthy, { shouldProbe: true, failures: 0, shouldRemove: false });

  const secondTimeout = decidePresenceProbe(35_000, { lastPongAt: 0, lastProbeAt: 20_000, failures: 2 });
  assert.deepEqual(secondTimeout, { shouldProbe: true, failures: 3, shouldRemove: true });
});
