# Implementation Plan: Chat File Message Support

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        ChatPanel.tsx                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐│
│  │ TextBubble   │  │ FileBubble   │  │ ImageBubble (inline)     ││
│  │ (existing)   │  │ (NEW)        │  │ (NEW)                    ││
│  └──────────────┘  └──────────────┘  └──────────────────────────┘│
│                         ↑ handleFileSelect → sendFileToUser()     │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                    ChatIntegration.ts
                    (routes file vs text messages)
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
   ChatHistoryManager   colabLib.ts     FileBlobStore (NEW)
   (IndexedDB:          (transport:     (IndexedDB: file
    chat_histories)      P2P + server)   blobs persistent)
```

## Implementation Phases

### Phase 1: Data Model & Storage Layer
**Estimated: ~150 lines new/changed**

#### 1.1 Extend ChatMessage interface (`ChatHistoryManager.ts`)
```typescript
// NEW: File metadata interface
export interface FileMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileCategory: FileCategory;
  transferStatus: 'uploading' | 'downloading' | 'completed' | 'failed';
  transferProgress: number; // 0-100
}

// MODIFIED: ChatMessage becomes a discriminated union
export interface TextChatMessage {
  id: string; senderId: string; receiverId: string;
  content: string; timestamp: number;
  type: 'text'; isRead: boolean;
}

export interface FileChatMessage {
  id: string; senderId: string; receiverId: string;
  content: string; // file name for backward compat
  timestamp: number; type: 'file' | 'image';
  isRead: boolean;
  fileMetadata: FileMetadata;
}

export type ChatMessage = TextChatMessage | FileChatMessage;

// NEW: FileCategory type
export type FileCategory = 'image' | 'video' | 'archive' | 'pdf' | 'document' | 'code' | 'other';
```

#### 1.2 Create FileBlobStore (`src/app/libs/chat/FileBlobStore.ts`) — NEW file
```typescript
// Manages IndexedDB storage for file blobs
// Store name: 'file_blobs' in 'letshare_chat_db'
// Key: fileKey (string) — format: "{userId}_{timestamp}_{fileName}"
// Value: { fileKey, blob: ArrayBuffer, fileName, mimeType, fileSize, storedAt }
// Methods: storeFile(), getFile(), deleteFile(), deleteFilesByUser(), getAllFiles()
// DB version bump to 2 (add 'file_blobs' store in onupgradeneeded)
```

#### 1.3 Extend ChatHistoryManager for file messages
- `addFileMessage()` — creates FileChatMessage with FileMetadata, stores blob via FileBlobStore
- `deleteMessage()` — delete single message (and its file blob if file type)
- `deleteMessagesByUser()` — delete all messages/files for a user
- `getAllFiles()` — returns all file messages across all chats (for Download panel)
- `getFileCount()` — total files stored
- `getStorageSize()` — estimated total storage used

#### 1.4 Bump IndexedDB version
- `dbVersion` from 1 → 2
- `onupgradeneeded`: create `file_blobs` store with `fileKey` keyPath

---

### Phase 2: Transport Layer Integration
**Estimated: ~80 lines changed**

#### 2.1 Extend ColabEvents type (`colabLib.ts`)
```typescript
// MODIFIED
type ColabEvents = {
  'message-sent': { to: string; message: string; type?: 'text' | 'file'; metadata?: Record<string, any> };
  'message-received': { from: string; message: string; type?: 'text' | 'file'; metadata?: Record<string, any> };
  'file-sent': { to: string; fileName: string; fileSize: number; transferId: string };
  'file-received': { from: string; fileName: string; fileSize: number; file: File };
};
```

#### 2.2 Hook file transfer completion into chat system (`colabLib.ts`)
After `sendFileToUser()` completes successfully (receives `file-complete` ack):
- Emit `file-sent` event with file metadata
- ChatIntegration listens and creates a file message in history

After file receive completes (`handleReceivedFile`):
- Emit `file-received` event with file metadata + File object
- ChatIntegration listens, stores blob via FileBlobStore, creates file message

#### 2.3 Add `sendFileMessage()` to colabLib
- Sends a JSON `file-message` signal (metadata only) before file transfer begins
- This lets the receiver create a placeholder file message immediately (with progress=0)

---

### Phase 3: ChatIntegration Bridge
**Estimated: ~60 lines changed**

#### 3.1 Handle file message events
```typescript
// LISTEN for 'file-sent' → create file message with transferStatus='completed'
// LISTEN for 'file-received' → store blob, create file message with transferStatus='completed'
// LISTEN for file transfer progress → update message transferProgress
```

#### 3.2 Update sendMessage to handle file type
```typescript
public async sendFileMessage(targetUserId: string, file: File): Promise<void> {
  // 1. Create placeholder file message in chat history (transferStatus='uploading')
  // 2. Call realTimeColab.sendFileToUser(targetUserId, file)
  // 3. On completion, update message to transferStatus='completed'
}
```

---

### Phase 4: UI — File Bubbles
**Estimated: ~250 lines new**

#### 4.1 FileBubble component (`src/components/Chat/FileBubble.tsx`) — NEW
```
Props: { message: FileChatMessage; isMyMessage: boolean; onDownload: () => void; onRetry: () => void }

Renders:
┌──────────────────────────────────────┐
│ 📄 report.pdf                        │
│ 2.3 MB                               │
│ [████████████████░░░░] 75%           │  ← if uploading/downloading
│ [⬇ Download] [✓ Saved]              │  ← if completed
│ [↻ Retry]                            │  ← if failed
│                        14:32         │
└──────────────────────────────────────┘
```

States:
- `uploading` / `downloading`: show progress bar + cancel button
- `completed` (sent): show file icon + name + size + ✓
- `completed` (received, not saved): show download button
- `completed` (received, saved): show "Saved" indicator
- `failed`: show retry button + error message

#### 4.2 ImageBubble component (`src/components/Chat/ImageBubble.tsx`) — NEW
```
Props: { message: FileChatMessage; isMyMessage: boolean; onDownload: () => void }

Renders thumbnail inline (like WeChat), click to enlarge in Dialog
Same states as FileBubble but with image preview
```

#### 4.3 Update ChatPanel.renderMessage
```typescript
const renderMessage = (message: ChatMessage) => {
  if (message.type === 'text') {
    return <TextBubble ... />;  // existing text rendering
  }
  if (message.type === 'image') {
    return <ImageBubble message={message} ... />;
  }
  if (message.type === 'file') {
    return <FileBubble message={message} ... />;
  }
};
```

#### 4.4 Complete handleFileSelect in ChatPanel
```typescript
const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  const file = files[0];
  // Reset input so same file can be selected again
  event.target.value = '';
  
  // Create placeholder message and start transfer
  await ChatIntegration.sendFileMessage(targetUserId, file);
};
```

#### 4.5 Add paste-to-send-file support
```typescript
// In ChatPanel, add onPaste handler to the message list area
// If clipboard contains a file, call handleFileSelect equivalent
```

---

### Phase 5: Download Panel Enhancement
**Estimated: ~120 lines changed**

#### 5.1 Add per-user file grouping
- Group `receivedFiles` by sender userId
- Show collapsible sections: "Files from UserA (5 files, 12MB)"

#### 5.2 Add batch delete
- Checkbox on each file row
- "Select All" checkbox in header
- "Delete Selected" button (with confirmation dialog)
- Integration with ChatHistoryManager for file+message deletion

#### 5.3 Add "Delete by User" button
- Each user group has a delete icon
- Deletes all files from that user + associated chat messages

#### 5.4 Show file source context
- Each file row shows: when received, which chat
- "View in Chat" link to open that user's chat

---

### Phase 6: i18n
**Estimated: ~40 lines added to translation.ts**

New keys needed:
```typescript
chat: {
  sendFile: "发送文件",        // already exists, hook up
  fileUploading: "发送中...",
  fileDownloading: "接收中...",
  fileCompleted: "发送完成",
  fileFailed: "发送失败",
  fileDownload: "下载",
  fileSaved: "已保存",
  fileRetry: "重试",
  dropFileHere: "拖拽文件到这里",
  pasteFileHint: "粘贴文件 (Ctrl+V)",
},
download: {
  deleteSelected: "删除选中",
  deleteAllFrom: "删除来自 {{name}} 的所有文件",
  selectAll: "全选",
  filesFrom: "来自 {{name}} 的文件",
  confirmDelete: "确定要删除 {{count}} 个文件吗？",
  totalStorage: "总存储: {{size}}",
  viewInChat: "在聊天中查看",
  noFiles: "暂无接收的文件",
}
```

---

## File Change Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `src/app/libs/chat/ChatHistoryManager.ts` | MODIFY | +80 (extend types, add file methods) |
| `src/app/libs/chat/FileBlobStore.ts` | **NEW** | +120 (IndexedDB blob CRUD) |
| `src/app/libs/chat/ChatIntegration.ts` | MODIFY | +70 (file events, sendFileMessage) |
| `src/components/Chat/ChatPanel.tsx` | MODIFY | +80 (file send, paste, render switch) |
| `src/components/Chat/FileBubble.tsx` | **NEW** | +160 (file message bubble) |
| `src/components/Chat/ImageBubble.tsx` | **NEW** | +140 (image message bubble) |
| `src/app/libs/connection/colabLib.ts` | MODIFY | +50 (extend events, hook file→chat) |
| `src/components/Download.tsx` | MODIFY | +120 (user grouping, batch delete) |
| `src/app/libs/i18n/translation.ts` | MODIFY | +40 (new keys en/zh/ms/id) |
| `src/types/index.d.ts` | MODIFY | +5 (FileCategory type) |
| **Total** | | **~865 lines** |

---

## Verification Steps

### After Phase 1 (Data Layer):
1. Open DevTools → Application → IndexedDB → letshare_chat_db
2. Verify `file_blobs` store exists
3. Call `FileBlobStore.storeFile()` in console, verify blob stored
4. Call `ChatHistoryManager.addFileMessage()`, verify message in `chat_histories`

### After Phase 2 (Transport):
1. Send a file between two browser tabs
2. Verify `file-sent` and `file-received` events fire
3. Check console for event payload correctness

### After Phase 3 (Integration):
1. Send a file through ChatIntegration.sendFileMessage()
2. Verify file message appears in IndexedDB with correct metadata
3. Verify text messages still work (no regression)

### After Phase 4 (UI):
1. Open chat panel, click attach → select file
2. Verify file bubble appears with progress bar
3. Verify completed file shows download/save buttons
4. Verify image files show thumbnail preview
5. Verify paste-to-send works (Ctrl+V with file in clipboard)

### After Phase 5 (Download Panel):
1. Open download panel, verify files grouped by user
2. Select files, delete selected → verify removal from panel + storage
3. Delete all files from one user → verify chat messages also deleted
4. Verify "View in Chat" navigates to correct chat

### Full Integration Test:
1. Device A opens chat with Device B
2. Device A sends a file via chat attach button
3. Device B sees file bubble with progress → completed
4. Device B clicks download → file saved
5. Device B opens Download panel → file listed under Device A
6. Both devices refresh page → files persist in chat history + download panel

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| IndexedDB version upgrade fails | Catch `onblocked` event, notify user to close other tabs |
| Large files consume too much IndexedDB storage | Cap individual file at 500MB; warn if total > 2GB |
| File bubble rendering slow with many files | Lazy load thumbnails; use IntersectionObserver |
| Breaking existing text chat | Keep text message path identical; add file path in parallel |
| Memory pressure from object URLs | Revoke URLs after 60s; use FileBlobStore for persistence |
