# Large File and Resumable Relay Architecture

## Current Findings

Relay is still a live WebSocket pipe. The server owns transfer metadata in memory, but it does not own chunk bytes, chunk hashes, a received bitmap, or a durable sender/receiver journal. Because of that, when a chunk write fails and no same-user websocket can be rebound immediately, the current protocol can only fail the session. True relay resume needs server-side chunk state.

P2P is not intrinsically limited to 3GB or 10GB. The current browser receive path is limited:

- `src/app/libs/connection/transferReliability.ts:1459` allocates `new Uint8Array(options.fileSize)`.
- `src/app/libs/connection/colabLib.ts:1417` constructs that full receive buffer immediately after metadata.
- `src/app/libs/connection/colabLib.ts:1634` constructs a completed `File` from the full buffer.
- `src/app/libs/chat/FileBlobStore.ts:59` calls `file.arrayBuffer()` before writing to IndexedDB, copying completed files into browser-managed storage again.

So a 10GB P2P receive fails because the app tries to reserve and retain a 10GB browser buffer/blob, not because WebRTC data channels cannot stream 10GB.

## Source-Backed Browser Constraints

- `RTCDataChannel.bufferedAmount` is the browser-exposed backpressure signal for queued data; the sender already uses this pattern.
- `FileSystemWritableFileStream.write()` can write chunks to a file stream, and file handles can create writable streams.
- OPFS is origin-private browser storage; it helps as a browser-managed spool but is still governed by storage quota and eviction rules.
- Browser storage quotas apply to IndexedDB/Cache/OPFS and vary by browser/device, so IndexedDB is not a safe 10GB file sink.
- User-visible save file handles require explicit user interaction in practical browser implementations, so direct-to-download-folder cannot be silently started from an incoming data-channel message.

References:

- MDN FileSystemWritableFileStream.write: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemWritableFileStream/write
- MDN FileSystemFileHandle.createWritable: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable
- MDN File System API / OPFS: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- MDN Storage quotas and eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN RTCDataChannel.bufferedAmount: https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount
- web.dev File System Access API: https://web.dev/file-system-access/

## Implemented Now

- Closed-socket write cleanup now removes only the stale websocket lease. It no longer triggers file-transfer disconnect cleanup, so same-user rebind can keep a relay session alive.
- Server relay/file-transfer failure paths now emit error-level logs with operation, transfer, chunk, role, client/user, room, and low-level write/rebind error fields.
- `logs/errors.log` now receives only `level:error` entries and cleanup retains only the last 7 days.
- Frontend safe receive/download/cache/zip/thumbnail guards now protect the current memory/Blob path instead of returning `Infinity`.

## Target Relay Architecture

### Phase 1: Resumable Relay Job

Server creates a transfer job:

- `transfer_id`
- sender/receiver user IDs
- file manifest: name, size, chunk size, total chunks
- chunk hash algorithm and optional full-file hash
- status: pending, accepted, transferring, interrupted, completing, completed, failed
- sender and receiver connection leases with last-seen timestamps
- received chunk bitmap
- highest contiguous committed chunk
- expiry and quota metadata

Server stores chunks temporarily:

- chunk spool path keyed by `transfer_id/chunk_index`
- per-chunk length/hash verification
- atomic write then commit bitmap
- TTL cleanup for unfinished jobs
- quota limits by user/server

Protocol messages:

- `file:transfer:resume-query`: client asks server for session state and missing bitmap.
- `file:transfer:resume-state`: server returns accepted manifest, committed chunks, next contiguous offset, and missing windows.
- `file:transfer:chunk`: sender uploads chunks with index/hash.
- `file:transfer:chunk-ack`: server acknowledges committed chunks, not just forwarded bytes.
- `file:transfer:receiver-pull` or `file:transfer:chunk-available`: receiver downloads/retries missing chunks.
- `file:transfer:complete`: sent only after server has all chunks and receiver confirms final write.

This converts relay from a fragile live pipe into a resumable job queue.

### Phase 2: Browser Direct-To-Disk Receive

For files above `getSafeReceiveSizeLimit(device)`:

1. Receiver must explicitly accept and choose a save target.
2. Browser supports File System Access:
   - create `FileSystemWritableFileStream`
   - write each chunk by offset
   - persist received bitmap in IndexedDB/OPFS
   - close stream only after all chunks verified
3. Browser lacks File System Access:
   - use OPFS as temporary spool when quota estimate is sufficient
   - otherwise reject with a direct message that the current browser cannot receive this file size safely

Small files can keep the existing in-memory `TransferReceiveBuffer` path.

### Phase 3: P2P Resume

P2P resume needs both peers to keep a transfer journal:

- Sender persists enough metadata to re-open or re-request the original file. Browser security means original `File` handles do not survive refresh unless obtained through File System Access or the user reselects the file.
- Receiver persists bitmap and partial direct-to-disk/OPFS state.
- On reconnect, receiver sends missing chunk windows; sender resends only missing chunks.

Without persistent sender file access or user reselection, P2P resume can only recover within the same page lifetime.

## Recommendation

Do not raise file limits by returning `Infinity`. That hides the real failure and makes 10GB transfers crash later. Keep current guards for the memory path, then implement direct-to-disk receive as a separate explicit mode. For relay, implement server-owned resumable jobs before claiming network-interruption resume support.
