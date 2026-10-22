import test from "node:test";
import assert from "node:assert/strict";
import { LivenessMonitor } from "../src/core/transport/LivenessMonitor";
import type { Clock } from "../src/core/transport/RetrySupervisor";

const PROBE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 10_000;

interface Timer {
  id: number;
  dueAt: number;
  fn: () => void;
  cancelled: boolean;
  fired: boolean;
}

class StalledClock implements Clock {
  private current = 0;
  private nextId = 1;
  private readonly timers: Timer[] = [];

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, dueAt: this.current + Math.max(0, ms), fn, cancelled: false, fired: false });
    return id;
  }

  clearTimeout(id: number): void {
    const timer = this.timers.find((candidate) => candidate.id === id);
    if (timer) timer.cancelled = true;
  }

  advanceBy(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const timer = this.timers
        .filter((candidate) => !candidate.cancelled && !candidate.fired && candidate.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (!timer) break;
      this.current = Math.max(this.current, timer.dueAt);
      timer.fired = true;
      timer.fn();
    }
    this.current = target;
  }

  stallBy(ms: number): void {
    this.current += ms;
  }

  activeTimerIds(): number[] {
    return this.timers
      .filter((timer) => !timer.cancelled && !timer.fired)
      .map((timer) => timer.id);
  }

  deliverEvenIfCancelled(id: number): void {
    const timer = this.timers.find((candidate) => candidate.id === id);
    assert.ok(timer, `timer ${id} must exist`);
    timer.fn();
  }
}

function monitorRig(
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  probeIntervalMs = PROBE_INTERVAL_MS,
) {
  const clock = new StalledClock();
  const probes: number[] = [];
  const dead: string[] = [];
  const monitor = new LivenessMonitor({
    clock,
    probeIntervalMs,
    probeTimeoutMs,
  });
  monitor.start({
    sendProbe: (probeId) => probes.push(probeId),
    onDead: (reason) => dead.push(reason),
  });
  return { clock, dead, monitor, probes };
}

test("a substantially late deadline sends a fresh probe before declaring the link dead", () => {
  const { clock, dead, monitor, probes } = monitorRig();
  clock.advanceBy(PROBE_INTERVAL_MS);
  clock.stallBy(PROBE_TIMEOUT_MS + 5_000);

  clock.advanceBy(0);

  assert.deepEqual(probes, [1, 2]);
  assert.deepEqual(dead, []);
  assert.equal(monitor.state.phase, "awaiting");
  assert.equal(monitor.state.awaitingSince, clock.now());

  clock.advanceBy(PROBE_TIMEOUT_MS - 1);
  assert.deepEqual(dead, []);
  clock.advanceBy(1);
  assert.equal(dead.length, 1, "a silent link still times out after the fresh response window");
  assert.match(dead[0] ?? "", /probe=2, waited=10000ms/);
});

test("a queued inbound frame cancels an overdue probe and a stale callback cannot kill the next probe", () => {
  const { clock, dead, monitor, probes } = monitorRig();
  clock.advanceBy(PROBE_INTERVAL_MS);
  const firstDeadline = clock.activeTimerIds()[0];
  assert.ok(firstDeadline !== undefined);

  clock.stallBy(PROBE_TIMEOUT_MS + 5_000);
  monitor.noteInbound();
  clock.advanceBy(PROBE_INTERVAL_MS);
  assert.deepEqual(probes, [1, 2]);
  assert.equal(monitor.state.phase, "awaiting");

  clock.deliverEvenIfCancelled(firstDeadline);
  assert.deepEqual(dead, [], "a delayed callback from probe 1 must not terminate probe 2");
  assert.equal(monitor.state.phase, "awaiting");

  clock.advanceBy(PROBE_TIMEOUT_MS);
  assert.equal(dead.length, 1, "the current probe retains its own full deadline");
  assert.match(dead[0] ?? "", /probe=2, waited=10000ms/);
});

test("a stopped run's delayed deadline cannot terminate a restarted run", () => {
  const { clock, dead, monitor } = monitorRig();
  clock.advanceBy(PROBE_INTERVAL_MS);
  const staleDeadline = clock.activeTimerIds()[0];
  assert.ok(staleDeadline !== undefined);

  clock.stallBy(PROBE_TIMEOUT_MS + 5_000);
  monitor.stop("test-stop");
  monitor.start({
    sendProbe: () => undefined,
    onDead: (reason) => dead.push(`restarted:${reason}`),
  });
  clock.deliverEvenIfCancelled(staleDeadline);

  assert.deepEqual(dead, []);
  clock.advanceBy(PROBE_INTERVAL_MS);
  clock.advanceBy(PROBE_TIMEOUT_MS);
  assert.equal(dead.length, 1);
  assert.match(dead[0] ?? "", /^restarted:liveness-timeout \(probe=1, waited=10000ms\)/);
});

test("a normally scheduled half-open deadline still fires at the configured timeout", () => {
  const { clock, dead } = monitorRig();
  clock.advanceBy(PROBE_INTERVAL_MS);
  clock.advanceBy(PROBE_TIMEOUT_MS - 1);
  assert.deepEqual(dead, []);
  clock.advanceBy(1);
  assert.equal(dead.length, 1);
  assert.match(dead[0] ?? "", /probe=1, waited=10000ms/);
});

test("exactly 1000ms late expires the production probe; one millisecond more refreshes it", () => {
  const atBoundary = monitorRig();
  atBoundary.clock.advanceBy(PROBE_INTERVAL_MS);
  atBoundary.clock.stallBy(PROBE_TIMEOUT_MS + 1_000);
  atBoundary.clock.advanceBy(0);

  assert.deepEqual(atBoundary.probes, [1]);
  assert.equal(atBoundary.dead.length, 1);
  assert.match(atBoundary.dead[0] ?? "", /probe=1, waited=11000ms/);

  const beyondBoundary = monitorRig();
  beyondBoundary.clock.advanceBy(PROBE_INTERVAL_MS);
  beyondBoundary.clock.stallBy(PROBE_TIMEOUT_MS + 1_001);
  beyondBoundary.clock.advanceBy(0);

  assert.deepEqual(beyondBoundary.probes, [1, 2]);
  assert.deepEqual(beyondBoundary.dead, []);
  beyondBoundary.clock.advanceBy(PROBE_TIMEOUT_MS);
  assert.equal(beyondBoundary.dead.length, 1, "the refreshed probe retains its full timeout");
  assert.match(beyondBoundary.dead[0] ?? "", /probe=2, waited=10000ms/);
});

test("short probe timeouts use a proportional late tolerance", () => {
  const { clock, dead, probes } = monitorRig(100, 100);
  clock.advanceBy(100);
  clock.stallBy(151); // 51ms late exceeds half of this 100ms timeout.
  clock.advanceBy(0);

  assert.deepEqual(probes, [1, 2]);
  assert.deepEqual(dead, []);
  clock.advanceBy(99);
  assert.deepEqual(dead, []);
  clock.advanceBy(1);
  assert.equal(dead.length, 1);
  assert.match(dead[0] ?? "", /probe=2, waited=100ms/);
});
