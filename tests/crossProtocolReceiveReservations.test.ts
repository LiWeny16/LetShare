import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFileReceiveStorage } from "../src/app/libs/connection/fileTransferV2/storageAdmission";
import { ReceiveStorageReservationCoordinator } from "../src/app/libs/connection/receiveStorageReservationCoordinator";
import { FILE_TRANSFER_V2_BLOCK_SIZE } from "../src/app/libs/connection/fileTransferV2/protocol";
import { IndexedDbFileTransferV2Store } from "../src/app/libs/connection/fileTransferV2/store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("AC-002/003 shares one same-page capacity budget across V2, P2P, and relay admissions", async () => {
  const coordinator = new ReceiveStorageReservationCoordinator();
  const firstEstimate = deferred<{ usage: number; quota: number }>();
  let v2EstimateStarted = false;
  let p2pEstimateStarted = false;
  let relayEstimateStarted = false;
  const accepted: Array<{ key: string; lease: NonNullable<Awaited<ReturnType<typeof coordinator.tryReserve>>> }> = [];

  const attempt = async (key: string, bytes: number, estimate: Promise<{ usage: number; quota: number }>, markStarted: () => void) => {
    const lease = await coordinator.tryReserve(key, bytes, async reservedBytes => {
      markStarted();
      return evaluateFileReceiveStorage(bytes, await estimate, reservedBytes).allowed;
    });
    if (!lease) return false;
    await lease.commit();
    accepted.push({ key, lease });
    return true;
  };

  const v2 = attempt("v2:transfer-a", 40, firstEstimate.promise, () => { v2EstimateStarted = true; });
  while (!v2EstimateStarted) await new Promise(resolve => setTimeout(resolve, 0));
  const p2p = attempt("p2p:transfer-b", 40, Promise.resolve({ usage: 0, quota: 100 }), () => { p2pEstimateStarted = true; });
  const relay = attempt("relay:transfer-c", 30, Promise.resolve({ usage: 0, quota: 100 }), () => { relayEstimateStarted = true; });

  assert.equal(p2pEstimateStarted, false, "the second protocol waits while the first quota check is pending");
  assert.equal(relayEstimateStarted, false, "the third protocol waits behind the same-page admission");
  firstEstimate.resolve({ usage: 0, quota: 100 });

  assert.deepEqual(await Promise.all([v2, p2p, relay]), [true, true, false]);
  assert.equal(await coordinator.getReservedBytes(), 80, "accepted V2 and P2P receives retain their full sizes");
  assert.deepEqual(accepted.map(item => item.key).sort(), ["p2p:transfer-b", "v2:transfer-a"]);

  await Promise.all(accepted.map(item => item.lease.release()));
  assert.equal(await coordinator.getReservedBytes(), 0, "completed receives release their in-page capacity");
  await coordinator.close();
});

test("AC-002/003 serializes concurrent admissions from the same page before awaiting estimates", async () => {
  const coordinator = new ReceiveStorageReservationCoordinator();
  const firstEstimate = deferred<boolean>();
  const firstStarted = deferred<void>();
  let secondStarted = false;
  let secondReservedBytes = -1;
  const firstPromise = coordinator.tryReserve("relay:same-page-a", 30, async () => {
    firstStarted.resolve();
    return firstEstimate.promise;
  });
  await firstStarted.promise;
  const secondPromise = coordinator.tryReserve("p2p:same-page-b", 30, async reservedBytes => {
    secondStarted = true;
    secondReservedBytes = reservedBytes;
    return true;
  });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(secondStarted, false, "a same-page concurrent call waits behind the first estimate");
  firstEstimate.resolve(true);
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.ok(first);
  assert.ok(second);
  assert.equal(secondReservedBytes, 30, "the second protocol sees the first full-file reservation");
  await first.release();
  await second.release();
  await coordinator.close();
});

test("AC-002/003 failed, rejected, and cancelled admissions leave no shared reservation behind", async () => {
  const coordinator = new ReceiveStorageReservationCoordinator();

  const rejected = await coordinator.tryReserve("relay:rejected", 80, async reservedBytes => {
    return evaluateFileReceiveStorage(80, { usage: 0, quota: 60 }, reservedBytes).allowed;
  });
  assert.equal(rejected, null);
  assert.equal(await coordinator.getReservedBytes(), 0, "rejected admission does not leak capacity");

  const lease = await coordinator.tryReserve("p2p:cancelled", 40, async reservedBytes => {
    return evaluateFileReceiveStorage(40, { usage: 0, quota: 100 }, reservedBytes).allowed;
  });
  assert.ok(lease);
  await lease.commit();
  assert.equal(await coordinator.getReservedBytes(), 40);
  await lease.release();
  assert.equal(await coordinator.getReservedBytes(), 0, "cancelled receive releases capacity");
  await coordinator.close();
});

test("AC-002/003 stale V2 reservation tokens cannot resize or release a same-page replacement", async () => {
  const coordinator = new ReceiveStorageReservationCoordinator();
  const initial = await coordinator.tryReserve("v2:resume-race", 100, async () => true);
  assert.ok(initial);
  await initial.commit();

  const validationStarted = deferred<void>();
  const finishValidation = deferred<boolean>();
  const replacementPromise = coordinator.tryReserve("v2:resume-race", 80, async () => {
    validationStarted.resolve();
    return finishValidation.promise;
  }, { replaceExisting: true });
  await validationStarted.promise;

  await initial.resize(60);
  finishValidation.resolve(true);
  const replacement = await replacementPromise;
  assert.ok(replacement, "resume admission retains its pending replacement claim");
  await replacement.commit();

  await initial.resize(20);
  await initial.release();
  assert.equal(await coordinator.getReservedBytes(), 80, "a stale token leaves the replacement reservation untouched");
  await replacement.release();
  await coordinator.close();
});

test("AC-002/003 durable V2 task reservations are restored on demand and removed when terminal", async () => {
  let persistedV2 = [{ transferId: "resume-task", bytes: 60, status: "paused", updatedAt: 1, expiresAt: Date.now() + 60_000 }];
  const coordinator = new ReceiveStorageReservationCoordinator({ v2Reservations: async () => persistedV2 });

  const blocked = await coordinator.tryReserve("p2p:too-large", 50, async reservedBytes => {
    return evaluateFileReceiveStorage(50, { usage: 0, quota: 100 }, reservedBytes).allowed;
  });
  assert.equal(blocked, null, "legacy P2P accounts for a durable paused V2 receive");
  assert.equal(await coordinator.getReservedBytes(), 60);

  persistedV2 = [];
  const allowed = await coordinator.tryReserve("relay:after-v2-terminal", 50, async reservedBytes => {
    return evaluateFileReceiveStorage(50, { usage: 0, quota: 100 }, reservedBytes).allowed;
  });
  assert.ok(allowed, "the next admission removes the V2 reservation after its task becomes terminal");
  await allowed.release();
  await coordinator.close();
});

test("AC-002/003 a V2 Store reservation blocks a concurrent legacy relay admission and releases on cancel", async () => {
  const coordinator = new ReceiveStorageReservationCoordinator();
  const estimatePending = deferred<{ usage: number; quota: number }>();
  let estimateStarted = false;
  const store = new IndexedDbFileTransferV2Store({
    dbName: `receive-reservations-${Date.now()}-${Math.random()}-tasks`,
    estimateStorage: async () => {
      estimateStarted = true;
      return estimatePending.promise;
    },
    requestPersistence: async () => false,
    reservationCoordinator: coordinator,
  });
  coordinator.setV2ReservationsProvider(() => store.listActiveReceiveStorageReservations());
  const transferId = "v2-cross-protocol-reservation";
  const taskPromise = store.createTask({
    roomId: "room-a", localParticipantId: "receiver", peerParticipantId: "sender",
    from: "sender", to: "receiver", direction: "receive", status: "receiving",
    manifest: {
      transferId, name: "received.bin", size: 60, type: "application/octet-stream", lastModified: 1,
      blockSize: FILE_TRANSFER_V2_BLOCK_SIZE, totalBlocks: 1, fileHash: "0".repeat(64), createdAt: Date.now(),
    },
  });
  while (!estimateStarted) await new Promise(resolve => setTimeout(resolve, 0));
  let relayEstimateStarted = false;
  const relayPromise = coordinator.tryReserve("relay:concurrent-relay", 60, async reservedBytes => {
    relayEstimateStarted = true;
    return evaluateFileReceiveStorage(60, { usage: 0, quota: 100 }, reservedBytes).allowed;
  });
  assert.equal(relayEstimateStarted, false, "the relay waits behind the V2 full-file admission");

  estimatePending.resolve({ usage: 0, quota: 100 });
  const task = await taskPromise;
  const relayLease = await relayPromise;
  assert.equal(task.receiveReservedBytes, 60);
  assert.equal(relayLease, null, "the V2 receive's committed reservation prevents relay over-admission");

  await store.updateTask(transferId, { status: "cancelled" });
  const afterCancel = await coordinator.tryReserve("relay:after-v2-cancel", 60, async reservedBytes => {
    return evaluateFileReceiveStorage(60, { usage: 0, quota: 100 }, reservedBytes).allowed;
  });
  assert.ok(afterCancel, "a cancelled V2 receive releases its reservation for the next protocol");
  await afterCancel.release();
  await coordinator.close();
});

// Cross-tab legacy lease expiry, reclaim, and fencing are explicitly deferred; same-page accounting and durable V2 task recovery remain covered above.
