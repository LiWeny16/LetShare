# PRD: Chat Panel File Message Support

## 1. Executive Summary

The LetShare chat panel currently only supports **plain text messages**. The `ChatMessage` data model has a `type` field (`'text' | 'file' | 'image'`) but only `'text'` is used. A separate file transfer system exists (P2P + server relay via `colabLib.ts`) that is **completely disconnected** from the chat messaging system. This PRD defines how to unify chat messages with file transfers, benchmarked against WeChat's file messaging UX.

**Goal:** Make the chat panel a complete communication tool where users can send, receive, view, download, and manage files within the chat context.

---

## 2. Current State Audit

### 2.1 What Works
| Component | Status | Details |
|-----------|--------|---------|
| Text chat messages | ✅ Complete | Send, receive, persist to IndexedDB, render, search, delete |
| P2P file transfer | ✅ Complete | WebRTC DataChannel, chunked, resend, multi-file ZIP |
| Server file relay | ✅ Complete | Via WebSocket, 50MB basic / 500MB PRO limit, 64KB chunks |
| Download management UI | ✅ Complete | Download.tsx: progress bars, received/sent lists, download, ZIP bundle, preview |
| File attach button (chat) | ⚠️ Stub | UI exists in ChatPanel, `handleFileSelect` is TODO |
| ChatMessage.type field | ⚠️ Defined | `'text' \| 'file' \| 'image'` defined but only `'text'` used |
| ChatHistoryManager.addMessage | ⚠️ Ready | Accepts `type` param, but callers always pass `'text'` |

### 2.2 What's Missing
| Gap | Impact |
|-----|--------|
| No file metadata in ChatMessage | Can't store fileName, fileSize, mimeType, fileRef |
| renderMessage ignores message.type | File messages render as garbled text |
| ChatIntegration hardcodes `type: 'text'` | File send/receive not integrated with chat history |
| Transport layer sends `{type: "text"}` only | No file type in wire protocol |
| receivedFiles is in-memory only | Files lost on page refresh, no persistence |
| No file message UI components | No file cards, image bubbles, download buttons in chat |
| Chat file attach button is dead | Clicking it only logs to console |
| No file-in-chat deletion UX | Can only delete entire chat history, not individual files |

---

## 3. Requirements

### 3.1 Functional Requirements

#### F1: File Message Data Model Extension
- **F1.1** Extend `ChatMessage` to support file metadata (fileName, fileSize, mimeType, fileCategory, fileRef/objectURL)
- **F1.2** Support message types: `text`, `file`, `image` with distinct data shapes
- **F1.3** File messages reference stored files by a persistent key (not object URL)

#### F2: Send File from Chat Panel
- **F2.1** File attach button in ChatPanel triggers native file picker
- **F2.2** Support all file types (no extension restrictions)
- **F2.3** File sent via existing `realTimeColab.sendFileToUser()` (P2P preferred, server fallback)
- **F2.4** After file transfer completes, a file message is created in chat history
- **F2.5** Show sending progress inline in the chat message bubble
- **F2.6** Support sending images with inline preview (thumbnail in bubble)
- **F2.7** Support paste-to-send-file (Ctrl+V in chat input)

#### F3: Receive File Messages
- **F3.1** Incoming file transfers create file messages in chat history
- **F3.2** Auto-accept files from users with active chat history
- **F3.3** Show receiving progress inline in chat bubble
- **F3.4** Completed files show download/action buttons in bubble
- **F3.5** Image files show inline preview/thumbnail

#### F4: File Rendering in Chat (微信对标)
- **F4.1** File bubbles show: icon (by type), fileName, fileSize, timestamp
- **F4.2** Image bubbles show thumbnail preview with click-to-enlarge
- **F4.3** Sent files align right (like text), received files align left
- **F4.4** Progress bar during transfer (determinate, with percentage)
- **F4.5** Completed files show download button / save indicator
- **F4.6** Failed transfers show retry button with error message

#### F5: File Storage & Persistence
- **F5.1** Received files persist to IndexedDB (alongside chat history)
- **F5.2** File storage is per-chat (associated with the other user)
- **F5.3** No artificial file count/size limit (user's disk is the limit)
- **F5.4** Files survive page refresh (loaded from IndexedDB)
- **F5.5** `ChatHistoryManager` stores file metadata; actual blobs in separate IndexedDB store
- **F5.6** Duplicate file detection (by name+size hash, skip re-storage)

#### F6: Download Management
- **F6.1** Download panel (existing Download.tsx) shows all received files across all chats
- **F6.2** Files grouped by sender user
- **F6.3** Individual file download (save to local disk)
- **F6.4** Download all as ZIP (existing functionality)
- **F6.5** Show file source (which chat/date)

#### F7: File Deletion
- **F7.1** Delete single file message (from chat history + storage)
- **F7.2** Delete all files from a specific user/chat
- **F7.3** Select-all + batch delete in download panel
- **F7.4** Delete confirmation dialog with file count
- **F7.5** Deletion removes both chat message record AND stored blob

#### F8: Transport Protocol
- **F8.1** Extend wire protocol to send `type: "file"` with file metadata
- **F8.2** File metadata sent as JSON before binary transfer begins
- **F8.3** ChatIntegration handles `message-sent`/`message-received` with file type
- **F8.4** Backward compatible: text messages unchanged

### 3.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NF1 | Performance | File message render < 100ms (excluding thumbnail gen) |
| NF2 | Storage efficiency | Deduplicate identical files |
| NF3 | UX consistency | File bubbles match text bubble visual style |
| NF4 | Responsiveness | Chat remains scrollable during file transfer |
| NF5 | Error handling | All transfer errors surface with user-friendly i18n messages |
| NF6 | i18n | All new strings in en, zh, ms, id |

---

## 4. UX Flow (WeChat Benchmark)

### 4.1 Sending a File
```
User opens chat → taps 📎 → file picker opens → selects file →
file bubble appears immediately (gray/loading state) →
progress bar fills (0→100%) →
bubble transitions to "sent" state (checkmark, file icon + name + size) →
file stored in receiver's download panel
```

### 4.2 Receiving a File
```
File message arrives in chat → auto-accept →
bubble shows with progress bar (0→100%) →
completed: bubble shows file icon + name + size + [Download] button →
file added to Download panel →
user can tap bubble to download, or use Download panel
```

### 4.3 File Bubble States
```
[Uploading... ████████░░ 75%]           ← sending progress
[📄 report.pdf  2.3MB ✓]                ← sent complete
[📄 report.pdf  2.3MB ⬇ Download]       ← received, not saved
[📄 report.pdf  2.3MB ✓ Saved]          ← received, saved to disk
[🖼 photo.jpg  1.2MB] [thumbnail]       ← image preview
```

---

## 5. Data Model Changes

### 5.1 Extended ChatMessage (TypeScript)
```typescript
interface ChatMessageBase {
  id: string;
  senderId: string;
  receiverId: string;
  timestamp: number;
  isRead: boolean;
}

interface TextMessage extends ChatMessageBase {
  type: 'text';
  content: string;
}

interface FileMessage extends ChatMessageBase {
  type: 'file' | 'image';
  content: string; // file name (backward compat)
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileCategory: FileCategory; // 'image'|'video'|'archive'|'pdf'|'document'|'code'|'other'
  fileKey: string; // IndexedDB key for blob retrieval
  transferStatus: 'uploading' | 'downloading' | 'completed' | 'failed';
  transferProgress: number; // 0-100
  thumbnailUrl?: string; // object URL for image thumbnails
}

type ChatMessage = TextMessage | FileMessage;
```

### 5.2 IndexedDB Schema
```
Database: letshare_chat_db
  Store: chat_histories (existing, add file fields)
  Store: file_blobs (NEW) — keyed by fileKey, stores ArrayBuffer + metadata
```

---

## 6. Component Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/app/libs/chat/ChatHistoryManager.ts` | MODIFY | Add file message support to addMessage, add FileBlobStore |
| `src/app/libs/chat/ChatIntegration.ts` | MODIFY | Handle file type in send/receive events |
| `src/components/Chat/ChatPanel.tsx` | MODIFY | Complete handleFileSelect, add file bubble rendering |
| `src/app/libs/connection/colabLib.ts` | MODIFY | Emit file metadata in message-sent/received events |
| `src/components/Download.tsx` | MODIFY | Add per-user grouping, batch delete, select-all |
| `src/app/libs/i18n/translation.ts` | MODIFY | Add new i18n keys |
| `src/types/index.d.ts` | MODIFY | Add FileCategory type |
| `src/components/Chat/FileBubble.tsx` | NEW | File message bubble component |
| `src/components/Chat/ImageBubble.tsx` | NEW | Image message bubble component |
| `src/app/libs/chat/FileBlobStore.ts` | NEW | IndexedDB blob storage manager |

---

## 7. Success Criteria

1. ✅ User can send a file through the chat panel (attach button)
2. ✅ File appears as a styled bubble in chat history (not plain text)
3. ✅ File transfer progress is visible inline in the bubble
4. ✅ Received files persist across page refresh
5. ✅ Download panel shows all received files grouped by user
6. ✅ User can delete individual files or by user/select-all
7. ✅ Existing text chat functionality is unchanged
8. ✅ All strings i18n'd (en/zh/ms/id)
9. ✅ No regression in file transfer reliability

---

## 8. Out of Scope (for this iteration)

- Video/audio message recording and playback
- Cloud file storage / sync across devices
- File expiration / auto-cleanup
- Encrypted file storage at rest
- File message forwarding to other users
- Multi-file send in a single message (one file per message for now)
