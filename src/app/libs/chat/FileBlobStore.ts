/**
 * FileBlobStore 鈥?IndexedDB-backed persistent file blob storage.
 *
 * Stores file blobs alongside chat history so received files survive page refresh.
 * Uses ChatHistoryManager's shared DB connection to avoid schema race conditions.
 */

import ChatHistoryManager from './ChatHistoryManager';
import {
  fileTransferV2IdFromHistoryKey,
  getFileTransferV2ApplicationAdapter,
} from '../connection/fileTransferV2/applicationAdapter';
import type { FileTransferV2FileHandle } from '../connection/fileTransferV2/directDiskSink';
import type { FileHandleAvailability } from '../connection/fileTransferV2/fileHandleAvailability';

const STORE_NAME = 'file_blobs';
const FILE_INFO_INDEX = 'fileInfo';

export function createFileBlobKey(userId: string, timestamp: number, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const randomBytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure random IDs are unavailable in this environment');
  }
  globalThis.crypto.getRandomValues(randomBytes);
  const uniqueId = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${userId}_${timestamp}_${uniqueId}_${safeName}`;
}

export interface StoredFile {
  fileKey: string;
  /** ArrayBuffer is retained for records written by older releases. */
  blob: Blob | ArrayBuffer;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storedAt: number;
}

export interface FileBlobInfo {
  fileKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storedAt: number;
  storageMode?: "browser-cache" | "direct-to-disk";
}

export interface DirectDiskFileInfo {
  transferId: string;
  handle: FileTransferV2FileHandle | null;
  availability: FileHandleAvailability | 'unavailable';
}

export type DirectDiskOpenResult = 'opened' | 'permission-required' | 'deleted' | 'failed';

class FileBlobStore {
  private static instance: FileBlobStore | null = null;
  private fileInfoCache: FileBlobInfo[] | null = null;
  private fileInfoCacheVersion = 0;

  private constructor() {}

  /** Synchronous metadata snapshot for receive admission; null means the scan is pending or unavailable. */
  public getCachedFileInfos(): FileBlobInfo[] | null {
    const snapshot = this.fileInfoCache;
    return snapshot ? snapshot.map(info => ({ ...info })) : null;
  }

  private rememberFileInfo(info: FileBlobInfo): void {
    this.fileInfoCacheVersion++;
    if (!this.fileInfoCache) return;
    this.fileInfoCache = [...this.fileInfoCache.filter(item => item.fileKey !== info.fileKey), info];
  }

  private forgetFileInfo(fileKey: string): void {
    this.fileInfoCacheVersion++;
    if (!this.fileInfoCache) return;
    this.fileInfoCache = this.fileInfoCache.filter(item => item.fileKey !== fileKey);
  }

  private invalidateFileInfoCache(): void {
    this.fileInfoCacheVersion++;
    this.fileInfoCache = null;
  }

  public static getInstance(): FileBlobStore {
    if (!FileBlobStore.instance) {
      FileBlobStore.instance = new FileBlobStore();
    }
    return FileBlobStore.instance;
  }

  /** Get the shared DB from ChatHistoryManager (no separate connection). */
  private async getDB(): Promise<IDBDatabase> {
    return ChatHistoryManager.getDB();
  }

  /** Generate a deterministic file key for legacy callers and tests. */
  public static makeFileKey(userId: string, timestamp: number, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${userId}_${timestamp}_${safeName}`;
  }

  /** Store a file blob. Returns the fileKey used. */
  public async storeFile(
    fileKey: string,
    file: File | Blob,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const db = await this.getDB();

      const result = await new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        const storedFile: StoredFile = {
          fileKey,
          blob: file,
          fileName: file instanceof File ? file.name : fileKey,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          storedAt: Date.now(),
        };

        const putRequest = store.put(storedFile);
        putRequest.onsuccess = () => {
          console.log(`[FileBlobStore] Stored: ${fileKey} (${this.formatSize(file.size)})`);
        };
        putRequest.onerror = () => {
          console.error('[FileBlobStore] Put error:', putRequest.error);
        };
        transaction.oncomplete = () => resolve({ success: true });
        transaction.onerror = () => {
          reject(new Error(transaction.error?.message || 'Transaction failed'));
        };
        transaction.onabort = () => {
          reject(new Error(transaction.error?.message || 'Transaction aborted'));
        };
      });
      if (result.success) this.rememberFileInfo({
        fileKey,
        fileName: file instanceof File ? file.name : fileKey,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        storedAt: Date.now(),
      });
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[FileBlobStore] storeFile exception:', error);
      return { success: false, error: msg };
    }
  }

  /** Retrieve cached file content; direct-disk V2 files are metadata-only and return null. */
  public async getFile(fileKey: string): Promise<File | null> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (transferId) {
      try {
        const adapter = getFileTransferV2ApplicationAdapter();
        if (await adapter?.getReceiveStorageMode(transferId) === 'direct-to-disk') return null;
        return await adapter?.getFile(transferId) ?? null;
      } catch (error) {
        console.error('[FileBlobStore] v2 file retrieval failed:', error);
        return null;
      }
    }
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(fileKey);

        request.onsuccess = () => {
          const stored: StoredFile | undefined = request.result;
          if (!stored) {
            console.warn(`[FileBlobStore] File not found: ${fileKey}`);
            resolve(null);
            return;
          }
          const file = new File([stored.blob], stored.fileName, {
            type: stored.mimeType,
            lastModified: stored.storedAt,
          });
          resolve(file);
        };
        request.onerror = () => {
          console.error('[FileBlobStore] getFile error:', request.error);
          resolve(null);
        };
      });
    } catch (error) {
      console.error('[FileBlobStore] getFile exception:', error);
      return null;
    }
  }

  /** Delete a single file. */
  public async deleteFile(fileKey: string): Promise<{ success: boolean }> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (transferId) {
      try {
        const success = await (getFileTransferV2ApplicationAdapter()?.deleteFile(fileKey) ?? Promise.resolve(false));
        if (success) this.forgetFileInfo(fileKey);
        return { success };
      } catch {
        return { success: false };
      }
    }
    try {
      const db = await this.getDB();
      const result = await new Promise<{ success: boolean }>((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(fileKey);
        transaction.oncomplete = () => {
          console.log(`[FileBlobStore] Deleted: ${fileKey}`);
          resolve({ success: true });
        };
        transaction.onerror = () => resolve({ success: false });
        transaction.onabort = () => resolve({ success: false });
      });
      if (result.success) this.forgetFileInfo(fileKey);
      return result;
    } catch {
      return { success: false };
    }
  }

  /** Pause v2 runtime work before changing a history link, without deleting bytes. */
  public async prepareDeleteFile(fileKey: string): Promise<boolean> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (!transferId) return true;
    const adapter = getFileTransferV2ApplicationAdapter();
    return adapter ? adapter.prepareFileDeletion(fileKey) : false;
  }

  public async prepareDeleteFilesByUser(userId: string): Promise<{ success: boolean }> {
    try {
      await getFileTransferV2ApplicationAdapter()?.prepareFilesDeletionByUser(userId);
      return { success: true };
    } catch (error) {
      console.error('[FileBlobStore] Failed to pause files before history deletion:', error);
      return { success: false };
    }
  }

  public async prepareClearAll(): Promise<{ success: boolean }> {
    try {
      await getFileTransferV2ApplicationAdapter()?.prepareClearAll();
      return { success: true };
    } catch (error) {
      console.error('[FileBlobStore] Failed to pause files before clearing history:', error);
      return { success: false };
    }
  }

  /** Delete all files whose keys start with a user prefix. */
  public async deleteFilesByUser(userId: string): Promise<{ success: boolean; deletedCount: number }> {
    let success = true;
    let deletedCount = 0;
    const adapter = getFileTransferV2ApplicationAdapter();
    try {
      deletedCount += await (adapter?.deleteFilesByUser(userId) ?? Promise.resolve(0));
    } catch (error) {
      success = false;
      console.error('[FileBlobStore] v2 deleteFilesByUser failed:', error);
    }

    try {
      const db = await this.getDB();
      const allKeys = await new Promise<string[]>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const request = transaction.objectStore(STORE_NAME).getAllKeys();
        let keys: string[] = [];
        request.onsuccess = () => { keys = request.result as string[]; };
        request.onerror = () => reject(request.error || new Error('Failed to read stored file keys'));
        transaction.oncomplete = () => resolve(keys);
        transaction.onerror = () => reject(transaction.error || new Error('File key read transaction failed'));
        transaction.onabort = () => reject(transaction.error || new Error('File key read transaction aborted'));
      });
      const toDelete = allKeys.filter(key => !fileTransferV2IdFromHistoryKey(key) && key.startsWith(userId));
      if (toDelete.length > 0) {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          for (const key of toDelete) store.delete(key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error || new Error('File deletion transaction failed'));
          transaction.onabort = () => reject(transaction.error || new Error('File deletion transaction aborted'));
        });
        deletedCount += toDelete.length;
        console.log(`[FileBlobStore] Deleted ${toDelete.length} files for user ${userId}`);
      }
    } catch (error) {
      success = false;
      console.error('[FileBlobStore] legacy deleteFilesByUser failed:', error);
    }
    if (deletedCount > 0) this.invalidateFileInfoCache();
    return { success, deletedCount };
  }

  /** List all stored file keys (lightweight, no blob data). */
  public async getAllFileKeys(): Promise<string[]> {
    let legacyKeys: string[];
    try {
      const db = await this.getDB();
      legacyKeys = await new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => resolve([]);
      });
    } catch {
      legacyKeys = [];
    }
    const adapter = getFileTransferV2ApplicationAdapter();
    if (!adapter) return legacyKeys;
    const tasks = await adapter.listCompletedReceivedTasks();
    return Array.from(new Set([...legacyKeys, ...tasks.map(task => `filev2:${task.transferId}`)]));
  }

  /** Read indexed file metadata with key cursors, without materializing blob payloads. */
  public async getAllFileInfos(): Promise<FileBlobInfo[]> {
    const cacheVersion = this.fileInfoCacheVersion;
    let legacyInfos: FileBlobInfo[];
    let legacyInfoScanSucceeded = true;
    try {
      const db = await this.getDB();
      legacyInfos = await new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const results: FileBlobInfo[] = [];
        let cursorFinished = false;
        let settled = false;
        let expectedCount: number | null = null;
        const finish = (success: boolean) => {
          if (settled) return;
          settled = true;
          if (!success) legacyInfoScanSucceeded = false;
          resolve(results);
        };

        const countRequest = store.count();
        countRequest.onsuccess = () => { expectedCount = countRequest.result; };
        countRequest.onerror = () => finish(false);

        const request = store.index(FILE_INFO_INDEX).openKeyCursor();
        request.onsuccess = () => {
          if (settled) return;
          const cursor = request.result;
          if (cursor) {
            const [fileSize, storedAt, fileName, mimeType] =
              cursor.key as unknown as [number, number, string, string];
            if (typeof cursor.primaryKey !== 'string'
              || !Number.isSafeInteger(fileSize) || fileSize < 0
              || !Number.isFinite(storedAt)
              || typeof fileName !== 'string' || typeof mimeType !== 'string') {
              finish(false);
              return;
            }
            results.push({
              fileKey: cursor.primaryKey,
              fileName,
              mimeType,
              fileSize,
              storedAt,
            });
            cursor.continue();
          } else {
            cursorFinished = true;
          }
        };
        request.onerror = () => finish(false);
        transaction.oncomplete = () => finish(cursorFinished && expectedCount === results.length);
        transaction.onerror = () => finish(false);
        transaction.onabort = () => finish(false);
      });
    } catch {
      legacyInfoScanSucceeded = false;
      legacyInfos = [];
    }
    const adapter = getFileTransferV2ApplicationAdapter();
    if (!adapter) {
      if (cacheVersion !== this.fileInfoCacheVersion) return this.getAllFileInfos();
      this.fileInfoCache = legacyInfoScanSucceeded ? legacyInfos : null;
      return legacyInfos;
    }
    let tasks: Awaited<ReturnType<typeof adapter.listCompletedReceivedTasks>> = [];
    if (typeof adapter.listCompletedReceivedTasks === "function") {
      try {
        tasks = await adapter.listCompletedReceivedTasks();
      } catch (error) {
        if (cacheVersion === this.fileInfoCacheVersion) this.fileInfoCache = null;
        throw error;
      }
    }
    const infos = [
      ...legacyInfos,
      ...tasks.map(task => ({
        fileKey: `filev2:${task.transferId}`,
        fileName: task.manifest.name,
        mimeType: task.manifest.type,
        fileSize: task.manifest.size,
        storedAt: task.createdAt,
        storageMode: task.receiveStorageMode ?? "browser-cache",
      })),
    ];
    if (cacheVersion !== this.fileInfoCacheVersion) return this.getAllFileInfos();
    this.fileInfoCache = legacyInfoScanSucceeded ? infos : null;
    return infos;
  }

  /** Get total storage size estimate (bytes). Uses cursor count, no blob loading. */
  public async getStorageSize(): Promise<number> {
    try {
      const infos = await this.getAllFileInfos();
      return infos.reduce((sum, f) => sum + (f.storageMode === "direct-to-disk" ? 0 : f.fileSize), 0);
    } catch {
      return 0;
    }
  }

  /** Get total file count using IndexedDB count (no data loaded). */
  public async getFileCount(): Promise<number> {
    try {
      return (await this.getAllFileInfos()).length;
    } catch {
      return 0;
    }
  }

  /** Check if a file with the given key exists (uses count, no blob loaded). */
  public async hasFile(fileKey: string): Promise<boolean> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (transferId) {
      try {
        const adapter = getFileTransferV2ApplicationAdapter();
        if (!adapter) return false;
        if (await adapter.getReceiveStorageMode(transferId) === 'direct-to-disk') {
          return (await adapter.getReceiveFileHandleAvailability(transferId)) !== 'deleted';
        }
        return await adapter.hasCompletedReceivedFile(transferId);
      } catch {
        return false;
      }
    }
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count(IDBKeyRange.only(fileKey));
        request.onsuccess = () => resolve(request.result > 0);
        request.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  /** Read direct-disk metadata without materializing the saved file as a browser Blob. */
  public async getDirectDiskFileInfo(fileKey: string, historyMetadata?: unknown): Promise<DirectDiskFileInfo | null> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (!transferId) return null;

    const hasDirectDiskHistoryFlag = historyMetadata !== null && typeof historyMetadata === 'object'
      && 'storageMode' in historyMetadata
      && (historyMetadata as { storageMode?: unknown }).storageMode === 'direct-to-disk';
    const adapter = getFileTransferV2ApplicationAdapter();
    if (!adapter) {
      return hasDirectDiskHistoryFlag
        ? { transferId, handle: null, availability: 'unavailable' }
        : null;
    }
    try {
      const storageMode = await adapter.getReceiveStorageMode(transferId);
      if (storageMode !== 'direct-to-disk') {
        return hasDirectDiskHistoryFlag
          ? { transferId, handle: null, availability: 'deleted' }
          : null;
      }
      const handle = await adapter.getReceiveFileHandle(transferId);
      const availability = handle
        ? await adapter.getReceiveFileHandleAvailability(transferId)
        : 'deleted';
      return { transferId, handle, availability };
    } catch (error) {
      if (!hasDirectDiskHistoryFlag) throw error;
      console.warn('[FileBlobStore] Direct-disk history status is temporarily unavailable:', error);
      return { transferId, handle: null, availability: 'unavailable' };
    }
  }

  /** Open a previously selected disk file from a user click without copying it into IndexedDB. */
  public async openDirectDiskFile(handle: FileTransferV2FileHandle): Promise<DirectDiskOpenResult> {
    let openedWindow: WindowProxy | null = null;
    try {
      // Open a placeholder synchronously within the click handler. The same user action
      // then covers any required permission prompt and the final file navigation.
      openedWindow = window.open('about:blank', '_blank');
      const permission = handle.requestPermission
        ? await handle.requestPermission({ mode: 'read' })
        : handle.queryPermission
          ? await handle.queryPermission({ mode: 'read' })
          : 'granted';
      if (permission !== 'granted') {
        openedWindow?.close();
        return 'permission-required';
      }

      const file = await handle.getFile();
      const objectUrl = URL.createObjectURL(file);
      if (openedWindow) {
        openedWindow.location.replace(objectUrl);
      } else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return 'opened';
    } catch (error) {
      openedWindow?.close();
      if (error instanceof DOMException && error.name === 'NotFoundError') return 'deleted';
      if (error instanceof DOMException && error.name === 'NotAllowedError') return 'permission-required';
      console.error('[FileBlobStore] Failed to open direct-disk file:', error);
      return 'failed';
    }
  }

  /** Pin a v2 receive only after its chat history record has committed. */
  public async pinForHistory(fileKey: string): Promise<boolean> {
    const adapter = getFileTransferV2ApplicationAdapter();
    if (!adapter) return false;
    const pinned = await adapter.pinForHistory(fileKey);
    if (pinned) {
      const transferId = fileTransferV2IdFromHistoryKey(fileKey);
      const task = transferId && typeof adapter.getTask === "function"
        ? await adapter.getTask(transferId)
        : null;
      if (task) this.rememberFileInfo({
        fileKey,
        fileName: task.manifest.name,
        mimeType: task.manifest.type,
        fileSize: task.manifest.size,
        storedAt: task.createdAt,
        storageMode: task.receiveStorageMode ?? "browser-cache",
      });
    }
    return pinned;
  }

  /** Recheck a pinned v2 receive after the chat history transaction commits. */
  public async isHistoryPinCurrent(fileKey: string): Promise<boolean> {
    const adapter = getFileTransferV2ApplicationAdapter();
    return adapter ? adapter.isHistoryPinCurrent(fileKey) : false;
  }

  /** Remove all legacy blobs and v2 task data for a user-triggered history clear. */
  public async clearAll(): Promise<{ success: boolean; deletedCount: number }> {
    let success = true;
    let deletedCount = 0;
    try {
      const db = await this.getDB();
      const legacyCount = await new Promise<number>((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const countRequest = store.count();
        countRequest.onsuccess = () => { store.clear(); };
        countRequest.onerror = () => { store.clear(); };
        transaction.oncomplete = () => resolve(countRequest.result || 0);
        transaction.onerror = () => resolve(-1);
        transaction.onabort = () => resolve(-1);
      });
      if (legacyCount < 0) success = false;
      else deletedCount += legacyCount;
    } catch (error) {
      success = false;
      console.error('[FileBlobStore] Legacy clearAll failed:', error);
    }
    try {
      deletedCount += await (getFileTransferV2ApplicationAdapter()?.clearAll() ?? Promise.resolve(0));
    } catch (error) {
      success = false;
      console.error('[FileBlobStore] v2 clearAll failed:', error);
    }
    if (deletedCount > 0) this.invalidateFileInfoCache();
    if (success) this.fileInfoCache = [];
    return { success, deletedCount };
  }

  private formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }
}

export { FileBlobStore };
export default FileBlobStore.getInstance();
