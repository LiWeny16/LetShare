---
name: file-message-support
description: Chat panel now supports file messages - send, receive, persist, download, and batch delete
metadata:
  type: project
---

# File Message Support in Chat Panel

## What was built
Added complete file message support to the chat panel, unifying the previously separate file transfer system with chat messaging. Users can now send files directly from the chat panel, see file bubbles with progress bars, download received files, and manage files in the Download panel.

## Key files changed/created

### New files:
- `src/app/libs/chat/FileBlobStore.ts` — IndexedDB blob storage, uses ChatHistoryManager's shared DB
- `src/components/Chat/FileBubble.tsx` — File message bubble (icon + name + size + progress + download)
- `src/components/Chat/ImageBubble.tsx` — Image message bubble (thumbnail preview + fullscreen viewer)

### Modified files:
- `src/app/libs/chat/ChatHistoryManager.ts` — Extended ChatMessage to discriminated union (TextChatMessage | FileChatMessage), added addFileMessage(), updateFileMessageProgress(), deleteMessage(), getAllFileMessages(). DB version bumped to 2.
- `src/app/libs/chat/ChatIntegration.ts` — Added file message bridge: sendFileMessage(), handleFileSent(), handleFileReceived(). Listens to file-sent/file-received events from colabLib.
- `src/components/Chat/ChatPanel.tsx` — Completed handleFileSelect (was TODO stub), added type-based message rendering (FileBubble/ImageBubble for file messages), added paste-to-send-file support.
- `src/app/libs/connection/colabLib.ts` — Extended ColabEvents type with file-sent and file-received events. Emits them on P2P and server transfer completion.
- `src/components/Download.tsx` — Added per-user file grouping, collapsible sections, batch select/delete, select-all, clear-all.
- `src/app/libs/i18n/translation.ts` — Added 14 new i18n keys across en/zh/ms/id.
- `src/types/index.d.ts` — Added FileCategory and FileTransferStatus types.
- `vite.config.ts` — SW cache bumped to v9.

## Architecture decisions
- File blobs stored in IndexedDB (same DB as chat history, shared connection via ChatHistoryManager.getDB())
- ChatMessage is now a discriminated union: TextChatMessage | FileChatMessage
- File messages have a FileMetadata sub-object with transferStatus tracking
- DB version centralized in ChatHistoryManager (single onupgradeneeded creates both stores)
- File transfer events (file-sent/file-received) bridge the gap between transfer system and chat system

## Known limitations
- Sent files not re-downloadable by sender (no blob storage for outgoing files)
- No retry mechanism for failed uploads (original File object not preserved)
- Progress updates not yet hooked from transfer system to chat bubbles (placeholder created, completed event updates)

## Related
See documents/PRD-file-message-support.md and documents/IMPLEMENTATION-PLAN-file-messages.md
