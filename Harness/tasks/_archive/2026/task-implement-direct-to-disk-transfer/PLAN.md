# task-implement-direct-to-disk-transfer PLAN

## Goal

Allow very large P2P receives on supported desktop browsers by streaming chunks to a user-selected file sink instead of allocating a full receive buffer or assembling a Blob.

## Acceptance Criteria

- AC-001: P2P metadata for files larger than the safe in-memory receive limit chooses a direct-to-disk path when File System Access is supported.
- AC-002: Direct-to-disk receive writes each framed chunk at its byte offset and tracks received/missing chunks without retaining the full file in JS memory.
- AC-003: Direct-to-disk completion closes the writable stream, stores a lightweight received-file record, sends `file-complete`, and avoids `FileBlobStore.storeFile` / IndexedDB blob persistence for the large file.
- AC-004: Unsupported browsers keep the current memory-safe rejection instead of trying to allocate a huge buffer.
- AC-005: Focused tests prove the direct-to-disk source path exists and that the old >limit branch no longer rejects before attempting a file sink on supported desktop browsers.

## Source-Backed Constraints

- MDN: `FileSystemFileHandle.createWritable()` creates a `FileSystemWritableFileStream` and changes land after close.
- MDN: `FileSystemWritableFileStream.write()` accepts `ArrayBuffer`/`TypedArray` and supports positioned writes.
- MDN: IndexedDB/Cache/OPFS are origin storage and quota-managed; a 10GB app-managed blob store is not a safe sink.
- MDN: `RTCDataChannel.bufferedAmount` is the sender backpressure signal; keep the existing sender flow-control model.

## Non-Goals

- Android implementation.
- Cross-refresh P2P resume with persisted sender file handles.
- Silent downloads without a user picker.
- Safari-specific large-file replacement path.

## Verification

- Source/unit tests for direct-to-disk protocol branch and sink helpers.
- `npm run build`.
- Existing focused P2P tests where practical.

## Subagent Dispatch

- Controller handles implementation directly in this Codex environment; no native subagent runtime is currently exposed.
