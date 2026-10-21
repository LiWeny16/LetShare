/**
 * FileBlobStore — IndexedDB-backed persistent file blob storage.
 *
 * Stores file blobs alongside chat history so received files survive page refresh.
 * Uses ChatHistoryManager's shared DB connection to avoid schema race conditions.
 */

import ChatHistoryManager from './ChatHistoryManager';
import {
  fileTransferV2IdFromHistoryKey,
  getFileTransferV2ApplicationAdapter,
} from '../connection/fileTransferV2/applicationAdapter';

const STORE_NAME = 'file_blobs';

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
}

class FileBlobStore {
  private static instance: FileBlobStore | null = null;

  private constructor() {}

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

  /** Generate a deterministic file key. */
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

      return await new Promise((resolve, reject) => {
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
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[FileBlobStore] storeFile exception:', error);
      return { success: false, error: msg };
    }
  }

  /** Retrieve a file as a Blob (reconstructed from ArrayBuffer). */
  public async getFile(fileKey: string): Promise<File | null> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (transferId) {
      try {
        return await getFileTransferV2ApplicationAdapter()?.getFile(transferId) ?? null;
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
        return { success: await (getFileTransferV2ApplicationAdapter()?.deleteFile(fileKey) ?? Promise.resolve(false)) };
      } catch {
        return { success: false };
      }
    }
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
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

  /** Get all file infos using cursor (avoids loading all blobs into memory at once). */
  public async getAllFileInfos(): Promise<FileBlobInfo[]> {
    let legacyInfos: FileBlobInfo[];
    try {
      const db = await this.getDB();
      legacyInfos = await new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const results: FileBlobInfo[] = [];
        const request = store.openCursor();

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const s = cursor.value as StoredFile;
            results.push({
              fileKey: s.fileKey,
              fileName: s.fileName,
              mimeType: s.mimeType,
              fileSize: s.fileSize,
              storedAt: s.storedAt,
            });
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        request.onerror = () => resolve(results);
      });
    } catch {
      legacyInfos = [];
    }
    const adapter = getFileTransferV2ApplicationAdapter();
    if (!adapter) return legacyInfos;
    const tasks = await adapter.listCompletedReceivedTasks();
    return [
      ...legacyInfos,
      ...tasks.map(task => ({
        fileKey: `filev2:${task.transferId}`,
        fileName: task.manifest.name,
        mimeType: task.manifest.type,
        fileSize: task.manifest.size,
        storedAt: task.createdAt,
      })),
    ];
  }

  /** Get total storage size estimate (bytes). Uses cursor count, no blob loading. */
  public async getStorageSize(): Promise<number> {
    try {
      const infos = await this.getAllFileInfos();
      return infos.reduce((sum, f) => sum + f.fileSize, 0);
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
        return await getFileTransferV2ApplicationAdapter()?.hasCompletedReceivedFile(transferId) ?? false;
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

  /** Pin a v2 receive only after its chat history record has committed. */
  public async pinForHistory(fileKey: string): Promise<boolean> {
    const adapter = getFileTransferV2ApplicationAdapter();
    return adapter ? adapter.pinForHistory(fileKey) : false;
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
