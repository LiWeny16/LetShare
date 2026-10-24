import test from "node:test";
import assert from "node:assert/strict";
import { FileTransferV2Engine } from "../src/app/libs/connection/fileTransferV2/engine";
import { FileTransferV2ApplicationAdapter } from "../src/app/libs/connection/fileTransferV2/applicationAdapter";

test("engine disposal awaits aborting an active direct-disk writer", async () => {
  const engine = new FileTransferV2Engine({
    selfId: () => "receiver",
    roomId: () => "room",
    store: {} as never,
    paths: () => [],
    onUpdate: () => undefined,
    onReceived: () => undefined,
  });
  const runtime = Reflect.apply(
    Reflect.get(engine, "createRuntime"),
    engine,
    ["dispose-direct", "sender", "room", "receive", null, null, "paused", "receiver"],
  ) as { directDiskSink?: { abort(): Promise<void> } };
  const tasks = Reflect.get(engine, "tasks") as Map<string, unknown>;
  tasks.set("dispose-direct", runtime);

  let abortStarted = false;
  let abortFinished = false;
  let releaseAbort!: () => void;
  runtime.directDiskSink = {
    abort: () => {
      abortStarted = true;
      return new Promise<void>(resolve => {
        releaseAbort = () => {
          abortFinished = true;
          resolve();
        };
      });
    },
  };

  const disposing = engine.dispose();
  let disposalFinished = false;
  void disposing.then(() => { disposalFinished = true; });
  await Promise.resolve();
  assert.equal(abortStarted, true);
  assert.equal(disposalFinished, false);
  releaseAbort();
  await disposing;
  assert.equal(abortFinished, true);
  assert.equal(disposalFinished, true);
});

test("adapter releases destination leases only after engine disposal finishes", async () => {
  const events: string[] = [];
  const adapter = Object.create(FileTransferV2ApplicationAdapter.prototype) as Record<string, unknown>;
  Object.assign(adapter, {
    disposed: false,
    clearServerHelloTimer: () => undefined,
    resolveServerHelloWaiters: () => undefined,
    resolvePeerHelloWaiters: () => undefined,
    relayTaskCooldowns: new Map(),
    directDiskLeaseReleases: new Map([["transfer", () => events.push("lease-release")]]),
    engine: {
      dispose: async () => {
        events.push("engine-dispose-start");
        await Promise.resolve();
        events.push("engine-dispose-finished");
      },
    },
  });

  await (adapter as unknown as { dispose(): Promise<void> }).dispose();
  assert.deepEqual(events, ["engine-dispose-start", "engine-dispose-finished", "lease-release"]);
});
