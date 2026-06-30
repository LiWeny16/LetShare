/**
 * FileBlobStore — IndexedDB-backed persistent file blob storage.
 *
 * Stores file blobs alongside chat history so received files survive page refresh.
 * Uses ChatHistoryManager's shared DB connection to avoid schema race conditions.
 */

import ChatHistoryManager from './ChatHistoryManager';

const STORE_NAME = 'file_blobs';

export interface StoredFile {
  fileKey: string;
  blob: ArrayBuffer;
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
      const arrayBuffer = await file.arrayBuffer();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        const storedFile: StoredFile = {
          fileKey,
          blob: arrayBuffer,
          fileName: file instanceof File ? file.name : fileKey,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          storedAt: Date.now(),
        };

        const putRequest = store.put(storedFile);
        putRequest.onsuccess = () => {
          console.log(`[FileBlobStore] Stored: ${fileKey} (${this.formatSize(file.size)})`);
          resolve({ success: true });
        };
        putRequest.onerror = () => {
          console.error('[FileBlobStore] Put error:', putRequest.error);
          resolve({ success: false, error: putRequest.error?.message || 'Unknown error' });
        };
        transaction.onerror = () => {
          reject(new Error(transaction.error?.message || 'Transaction failed'));
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
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(fileKey);
        request.onsuccess = () => {
          console.log(`[FileBlobStore] Deleted: ${fileKey}`);
          resolve({ success: true });
        };
        request.onerror = () => resolve({ success: false });
      });
    } catch {
      return { success: false };
    }
  }

  /** Delete all files whose keys start with a user prefix. */
  public async deleteFilesByUser(userId: string): Promise<{ success: boolean; deletedCount: number }> {
    try {
      const db = await this.getDB();
      const allKeys = await this.getAllFileKeys();
      const toDelete = allKeys.filter((k) => k.startsWith(userId));

      if (toDelete.length === 0) return { success: true, deletedCount: 0 };

      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      let deleted = 0;

      return new Promise((resolve) => {
        toDelete.forEach((key) => {
          const req = store.delete(key);
          req.onsuccess = () => {
            deleted++;
            if (deleted === toDelete.length) {
              console.log(`[FileBlobStore] Deleted ${deleted} files for user ${userId}`);
              resolve({ success: true, deletedCount: deleted });
            }
          };
          req.onerror = () => {
            deleted++;
            if (deleted === toDelete.length) {
              resolve({ success: true, deletedCount: deleted });
            }
          };
        });
      });
    } catch (error) {
      console.error('[FileBlobStore] deleteFilesByUser exception:', error);
      return { success: false, deletedCount: 0 };
    }
  }

  /** List all stored file keys (lightweight, no blob data). */
  public async getAllFileKeys(): Promise<string[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  /** Get all file infos using cursor (avoids loading all blobs into memory at once). */
  public async getAllFileInfos(): Promise<FileBlobInfo[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
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
      return [];
    }
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
      const db = await this.getDB();
      return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      });
    } catch {
      return 0;
    }
  }

  /** Check if a file with the given key exists (uses count, no blob loaded). */
  public async hasFile(fileKey: string): Promise<boolean> {
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

  private formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }
}

export { FileBlobStore };
export default FileBlobStore.getInstance();
