# Relay Resume Architecture Review

Date: 2026-07-27

## Executive Summary

The current server relay is a live WebSocket pipe with in-memory transfer state.
It has useful tactical protections: transfer ids in frames, receiver ACK flow
control, duplicate chunk ignore on the receiver, missing-chunk resend while both
peers are still alive, and stale socket cleanup. It is not a resumable relay.

The best architecture for this product is a server-coordinated resumable relay
job with temporary chunk spooling:

- WebSocket remains the control plane for request, accept, progress, resume,
  cancel, and completion.
- Data chunks become idempotent records keyed by transfer/file/chunk/hash.
- The relay server owns a short-lived manifest, uploaded bitmap, delivered
  bitmap, receiver ACK bitmap, current connection leases, TTL, quota, and
  cleanup.
- Browser clients persist a transfer journal and receiver chunk bitmap locally.
- A disconnect changes a transfer to `interrupted` or `awaiting_peer`, not
  immediately to `error`, until the resume window expires.

There is also a likely short-term regression in the current stale-client fix:
removing a stale websocket through `RemoveClient` triggers the normal disconnect
callback, and `HandleClientDisconnect` marks active sessions `error`. That can
turn a stale socket cleanup into a terminal transfer even when a newer same-user
socket exists.

## Current Flow Evidence

### Frontend

- Sender session is volatile and holds a live browser `File` object:
  `src/app/libs/connection/ServerFileTransfer.ts:91-102`.
- Receiver session is volatile and holds RAM-only `buffer`,
  `receivedChunks`, and `receivedChunkIndexes`:
  `src/app/libs/connection/ServerFileTransfer.ts:104-128`.
- All active transfer maps and ACK waiters are instance fields:
  `src/app/libs/connection/ServerFileTransfer.ts:137-162`.
- `handleConnectionLost` rejects waiters, marks sessions `error`, clears
  received chunks, clears both maps, clears timeouts, and drops the current
  transfer id: `src/app/libs/connection/ServerFileTransfer.ts:749-781`.
- The sender `startSending` catch deletes the session and sends
  `file:transfer:cancel`: `src/app/libs/connection/ServerFileTransfer.ts:1155-1183`.
- Receiver `cancel` and `error` handlers clear buffers/chunks and delete
  sessions: `src/app/libs/connection/ServerFileTransfer.ts:1531-1600`.
- Missing chunk resend exists only while a live receive session still exists:
  `src/app/libs/connection/ServerFileTransfer.ts:548-584`.
- Completed received files are persisted only after final assembly through
  `FileBlobStore`; partial receiver chunks are not persisted:
  `src/app/libs/chat/FileBlobStore.ts:52-80`.

### Backend

- Server transfer sessions are only an in-memory map:
  `server/internal/service/file_transfer.go:13-25`.
- Server session metadata contains client ids, user ids, file metadata, status,
  and timestamps, but no chunk store, bitmap, or checksums:
  `server/internal/model/message.go:145-159`.
- Request records the sender client id; accept records the receiver client id:
  `server/internal/handler/websocket.go:598-610`,
  `server/internal/handler/websocket.go:653-670`.
- Binary frames carry `transfer_id`, `chunk_index`, `chunk_size`, and
  `total_chunks`, then are forwarded immediately:
  `server/internal/handler/websocket.go:521-540`,
  `server/internal/handler/websocket.go:579-585`.
- `ForwardChunkToReceiver` writes the frame to the receiver websocket and does
  not store the payload:
  `server/internal/service/file_transfer.go:233-309`.
- If forwarding fails, the handler sends `file:transfer:error`, marks the
  session `error`, and removes it after 5 seconds:
  `server/internal/handler/websocket.go:579-586`,
  `server/internal/handler/websocket.go:1113-1144`.
- If a bound client disconnects, `HandleClientDisconnect` marks active sessions
  `error`, notifies the peer, and removes after 5 seconds:
  `server/internal/service/file_transfer.go:156-219`.
- Stale sessions are timed out and deleted after 10 minutes:
  `server/internal/service/file_transfer.go:421-465`.

## Why Small Network Faults Become Terminal

The current protocol has no stable transfer authority beyond the live
websocket session maps:

1. The sender loop waits on receiver ACK windows and reads directly from a live
   `File` object. If the websocket closes, `handleConnectionLost` clears the
   sender session and rejects completion.
2. The receiver stores partial chunks only in RAM. If its websocket closes or a
   transfer error arrives, its partial bitmap and bytes are deleted.
3. The server forwards chunks but does not retain them. Once a frame has been
   forwarded or a write fails, the server cannot replay it to a reconnected
   receiver.
4. Existing `file:transfer:resend` can only ask the original live sender to
   resend missing chunks. It is not a reconnect resume protocol.
5. The backend disconnect callback treats socket loss as transfer loss. That is
   correct for a live-pipe design, but it conflicts with resumability and may
   also conflict with stale-socket rebind.

## Immediate Hotfix Target

Before building full resume, fix the deterministic failure path:

- Split websocket cleanup reason from logical participant disconnect.
- `removeClientIfClosedWrite` should be able to remove a stale socket without
  automatically marking every bound transfer `error` when another same-user
  room client exists or a rebind is in progress.
- Add a backend test that registers `SetOnClientDisconnect`, closes the accepted
  receiver socket, keeps a newer same-user receiver socket online, calls
  `ForwardChunkToReceiver`, and asserts:
  - the chunk reaches the newer receiver,
  - `ToClientID` rebinds,
  - session status remains `transferring`, not `error`,
  - no `file:transfer:error` is emitted.

This does not provide true resume, but it should address the "必定失败" pattern
after the stale-client patch.

## Recommended Architecture

### State Ownership

Server owns the transfer job:

```text
TransferJob
  transferId
  roomName
  fromUserId
  toUserId
  status: pending | accepted | transferring | interrupted | resuming |
          awaiting_peer | completed | cancelled | error | expired
  manifest
    fileId
    fileName
    fileSize
    fileType
    chunkSize
    totalChunks
    fileHash? optional final hash
    perChunkHash? optional or rolling
  connectionLeases
    senderClientId
    receiverClientId
    senderEpoch
    receiverEpoch
    lastSeenAt
  bitmaps
    uploadedChunks
    deliveredChunks
    receiverAckedChunks
  ttl
  quotaOwner
  createdAt
  updatedAt
```

Server owns temporary chunk storage through an interface:

```text
ChunkStore
  Put(transferId, fileId, index, hash, bytes) idempotent
  Has(transferId, fileId, index, hash)
  Get(transferId, fileId, index)
  DeleteTransfer(transferId)
  CleanupExpired(now)
```

Use filesystem storage first, under a dedicated relay-spool directory with TTL
and quota. Keep an interface so object storage can replace it later.

### Protocol Messages

Keep existing messages for compatibility and add v2 messages:

```text
file:transfer:manifest
file:transfer:resume:query
file:transfer:resume:state
file:transfer:chunk:put
file:transfer:chunk:ack
file:transfer:chunk:missing
file:transfer:replay
file:transfer:pause
file:transfer:expire
```

Every message must include:

```text
transfer_id
file_id
room_name
from_user_id / to_user_id where relevant
epoch
protocol_version
```

Every chunk must include:

```text
transfer_id
file_id
chunk_index
chunk_size
total_chunks
chunk_hash
payload
```

Duplicate same-hash chunks are ACKed as already committed. Duplicate different
hash chunks fail the transfer or reject that chunk as corruption.

### Control Plane and Data Plane

Recommended first implementation:

- Control plane: current WebSocket connection.
- Data plane: current WebSocket binary frames, but store each chunk server-side
  before or while forwarding.

Recommended later optimization:

- Sender uploads chunks via HTTP range/multipart endpoint or resumable-upload
  style endpoint when WebSocket binary backpressure is unstable.
- Receiver can still get replay over WebSocket or HTTP chunk download.

Do not start with object storage or a new external protocol unless the local
filesystem spool cannot meet size/cost limits.

### Client Persistence

Sender:

- Persist transfer manifest, transfer id, chunk size, sent/acked bitmap, status,
  peer id, room id, and timestamps in IndexedDB.
- Browser refresh cannot recover the original `File` object automatically.
  Choose one:
  - copy the source file into OPFS/IndexedDB before sending, which costs local
    storage and time; or
  - after refresh, ask the user to reselect the same file and verify name, size,
    lastModified, and optional hash before resume.

Receiver:

- Persist partial chunks or a sparse file into OPFS/IndexedDB.
- Persist received bitmap and manifest.
- On reconnect, send `resume:query` and reconcile local bitmap with server
  `uploadedChunks` / `deliveredChunks`.

Chat/UI:

- Store `transferId` and a resumable status in chat file metadata:
  `pending`, `transferring`, `interrupted`, `resumable`, `completed`,
  `expired`, `failed`.
- Failed upload placeholders should be updated to failed/interrupted instead
  of leaving a silent placeholder after `sendFileMessage` catch.

## Migration Plan

### Phase 0: Stop deterministic terminalization

- Add disconnect reason / stale cleanup distinction on the backend.
- Fix `ConnectionManager.onDisconnected` to support multiple listeners or an
  event emitter, because it is currently a single callback slot.
- Add the hotfix test described above.

### Phase 1: Logical transfer job without payload spool

- Add `interrupted` / `awaiting_peer` status.
- Separate `TransferJob` from current websocket `clientID`.
- Add epochs for sender/receiver reconnect.
- Add resume query/state messages and bitmaps, still asking the live sender for
  missing chunks.
- This supports short reconnects while the sender tab is still alive.

### Phase 2: Temporary server chunk spool

- Add `ChunkStore`.
- Store chunks idempotently before forwarding.
- Receiver resume can request replay from server without requiring the sender
  to be continuously online after upload.
- Add TTL cleanup and quota.

### Phase 3: Refresh-safe and large-file hardening

- Add OPFS/IndexedDB sender source copy or verified file reselection.
- Consider HTTP chunk upload for sender-to-server data plane.
- Add final file hash validation and background cleanup.

## Test Plan

Backend RED tests:

- `TestRelayHotfix_RebindStaleReceiverDoesNotErrorSession_AC001`
- `TestRelayResume_ReceiverReconnectRequestsMissingChunks_AC003`
- `TestRelayResume_SenderReconnectContinuesSameTransfer_AC003`
- `TestRelaySpool_DuplicateSameHashIsNoop_AC003`
- `TestRelaySpool_DuplicateDifferentHashFails_AC003`
- `TestRelaySpool_TTLCleanupRemovesBytesAndManifest_AC003`

Frontend tests:

- `tests/transferResumePersistence.test.ts`: transfer journal persists manifest,
  bitmap, peer ids, and interrupted/resumable status.
- `tests/serverRelayDisconnectListeners.test.ts`: multiple disconnect listeners
  are called.
- `tests/publicRelayResume.cdp.test.mjs`: real browser transfer, forced
  websocket close, reconnect, resume messages, no new transfer id, completion.

Current verification during this review:

- PASS: `C:\Program Files\Go\bin\go.exe test ./internal/service -run TestForwardChunkToReceiverRebindsClosedAcceptedClient -count=1 -v`
- PASS: `C:\Program Files\Go\bin\go.exe test ./internal/handler -run TestNotifyTransferErrorBypassesGenericRateLimiter -count=1 -v`
- FAIL, pre-existing/source-inspection drift: `node --import tsx --test tests/serverRelaySendCompletion.test.ts`
  - `server relay send promise resolves only after receiver completion ack`
  - `server relay request-stage errors include transfer id so sender can leave waiting state`

## Review Verdict

Architecture recommendation: adopt a resumable relay job with temporary server
chunk spooling, not only client-side resend. Client-only resume cannot recover
receiver disconnect once server has already discarded forwarded chunks, and
server-only resume cannot recover sender refresh without a durable sender source
or verified reselection.

Implementation readiness: start with Phase 0 and Phase 1 tests. Full Phase 2
requires explicit product choices for TTL, disk quota, max resumable file size,
and whether sender refresh should require file reselection or OPFS copy.
