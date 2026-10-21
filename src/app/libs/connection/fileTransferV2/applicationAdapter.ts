import {
  FILE_TRANSFER_V2_MAX_FRAME_BYTES,
  FILE_TRANSFER_V2_MAX_SIZE,
  FILE_TRANSFER_V2_MIN_FRAME_BYTES,
  decodeFileTransferV2Frame,
  validateFileTransferV2Capabilities,
  validateFileTransferV2Control,
  type FileTransferV2Capabilities,
  type FileTransferV2Control,
} from "./protocol";
import {
  FileTransferV2Engine,
  type FileTransferV2Path,
  type FileTransferV2PathContext,
  type FileTransferV2Snapshot,
} from "./engine";
import {
  FILE_TRANSFER_V2_DEFAULT_EXPIRY_MS,
  IndexedDbFileTransferV2Store,
  type FileTransferV2Store,
  type FileTransferV2Task,
} from "./store";

export const FILE_TRANSFER_V2_HISTORY_PREFIX = "filev2:";
export const FILE_TRANSFER_V2_DISCOVERY_CAPABILITY = Object.freeze({ version: 2 as const });
const MAX_BACKPRESSURE_BYTES = 512 * 1024;
const BACKPRESSURE_TIMEOUT_MS = 15_000;
const PEER_HELLO_TIMEOUT_MS = 1_500;
const SERVER_HELLO_TIMEOUT_MS = 5_000;
const SERVER_HELLO_RETRY_DELAY_MS = 2_000;
const MAX_SERVER_HELLO_RETRIES = 2;
const SERVER_TASK_RETRY_COOLDOWN_MS = 5_000;
const HISTORY_PIN_EXPIRY = Number.MAX_SAFE_INTEGER;
const HIDDEN_TRANSFER_STORAGE_PREFIX = "letshare:file-transfer-v2:hidden:";

const LOCAL_CAPABILITIES: FileTransferV2Capabilities = {
  version: 2,
  maxFileSize: FILE_TRANSFER_V2_MAX_SIZE,
  maxFrameBytes: FILE_TRANSFER_V2_MAX_FRAME_BYTES,
  maxCreditBytes: 8 * 1024 * 1024,
  resume: true,
  multipath: true,
};

export interface FileTransferV2ApplicationAdapterOptions {
  selfId: () => string;
  roomId: () => string;
  getDataChannel: (peerId: string) => RTCDataChannel | null;
  getMaxSctpMessageSize: (peerId: string) => number | undefined;
  isP2PVerified: (peerId: string) => boolean;
  getConnectionType: () => string;
  isServerConnected: () => boolean;
  isTransportOnly: () => boolean;
  getServerBufferedAmount: () => number;
  sendServerControl: (control: FileTransferV2Control) => void;
  sendServerFrame: (frame: ArrayBuffer) => void;
  sendP2PControl: (peerId: string, control: FileTransferV2Control) => void;
  sendP2PFrame: (peerId: string, frame: Uint8Array) => void;
  onUpdate: (snapshot: FileTransferV2Snapshot) => void;
  onReceived: (task: FileTransferV2Task, file: File) => void | Promise<void>;
  onError: (reason: string, transferId?: string) => void;
  store?: FileTransferV2Store;
}

/** Recognize namespaced v2 controls before the legacy DataChannel parser. */
export function unwrapP2PFileTransferV2Control(value: unknown): { recognized: boolean; control?: unknown } {
  const record = asRecord(value);
  if (record?.type === "file:v2:control") return { recognized: true, control: record.data };
  // Accept the original bare control shape during rolling upgrades. Any v2
  // version marker is consumed here, even if its kind is unknown or malformed.
  if (record?.version === 2) return { recognized: true, control: value };
  return { recognized: false };
}

export interface FileTransferV2DiscoveryOffer {
  version: 2;
}

export interface FileTransferV2SendContext {
  roomId: string;
  selfId: string;
  connectionEpoch: number;
}

/** Keep v2 negotiation advertised on every normal discover broadcast. */
export function withFileTransferV2DiscoveryCapability(
  signal: unknown,
  capability?: FileTransferV2DiscoveryOffer | null,
): unknown {
  const record = asRecord(signal);
  if (!record || record.type !== "discover") return signal;
  const discover: Record<string, unknown> = { ...record };
  if (capability) discover.fileTransferV2 = capability;
  else delete discover.fileTransferV2;
  return discover;
}

let sharedStore: FileTransferV2Store | null = null;
let activeAdapter: FileTransferV2ApplicationAdapter | null = null;

export function getFileTransferV2Store(): FileTransferV2Store | null {
  if (sharedStore) return sharedStore;
  if (typeof indexedDB === "undefined") return null;
  sharedStore = new IndexedDbFileTransferV2Store();
  return sharedStore;
}

export function getFileTransferV2ApplicationAdapter(): FileTransferV2ApplicationAdapter | null {
  return activeAdapter;
}

export function installFileTransferV2ApplicationAdapter(
  adapter: FileTransferV2ApplicationAdapter,
): void {
  activeAdapter = adapter;
}

export function fileTransferV2IdFromHistoryKey(fileKey: string): string | null {
  if (!fileKey.startsWith(FILE_TRANSFER_V2_HISTORY_PREFIX)) return null;
  const transferId = fileKey.slice(FILE_TRANSFER_V2_HISTORY_PREFIX.length);
  return /^[A-Za-z0-9_-]{8,96}$/.test(transferId) ? transferId : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseEnvelopeControl(envelope: unknown): Record<string, unknown> | null {
  const record = asRecord(envelope);
  if (!record) return null;
  const raw = record.data;
  if (typeof raw === "string") {
    try { return asRecord(JSON.parse(raw)); } catch { return null; }
  }
  return asRecord(raw);
}

function isServerServiceError(value: Record<string, unknown>, selfId: string): boolean {
  const allowed = new Set(["version", "kind", "transferId", "from", "to", "reason"]);
  if (Object.keys(value).some(key => !allowed.has(key))) return false;
  const transferId = value.transferId;
  return value.version === 2 && value.kind === "error" && value.from === "server"
    && value.to === selfId
    && (transferId === undefined || transferId === "" || (typeof transferId === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(transferId)))
    && typeof value.reason === "string" && value.reason.length > 0 && value.reason.length <= 1024;
}

function isPermanentServerRejection(reason: string): boolean {
  return /unsupported|invalid (?:control|file v2)|authenticated websocket required|missing authenticated identity|hello-ack is server-only/i.test(reason);
}

function hasLsf2Magic(value: ArrayBuffer | Uint8Array): boolean {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return bytes.byteLength >= 4 && bytes[0] === 0x4c && bytes[1] === 0x53 && bytes[2] === 0x46 && bytes[3] === 0x32;
}

function frameToArrayBuffer(frame: Uint8Array): ArrayBuffer {
  return frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer;
}

async function waitForBackpressure(
  getBufferedAmount: () => number,
  isOpen: () => boolean,
): Promise<void> {
  const deadline = Date.now() + BACKPRESSURE_TIMEOUT_MS;
  while (getBufferedAmount() > MAX_BACKPRESSURE_BYTES) {
    if (!isOpen()) throw new Error("Transfer path closed while waiting for backpressure");
    if (Date.now() >= deadline) throw new Error("Transfer path remained congested for too long");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!isOpen()) throw new Error("Transfer path is closed");
}

/**
 * Binds the durable transfer engine to LetShare's existing authenticated
 * DataChannel and WebSocket transports. The application remains responsible
 * for associating peer IDs with those transports.
 */
export class FileTransferV2ApplicationAdapter {
  readonly store: FileTransferV2Store;
  readonly engine: FileTransferV2Engine;

  private readonly options: FileTransferV2ApplicationAdapterOptions;
  private readonly peerOffers = new Set<string>();
  private readonly peerCapabilities = new Map<string, FileTransferV2Capabilities>();
  private readonly p2pHelloAcknowledged = new Set<string>();
  private readonly peerChannels = new Map<string, RTCDataChannel | null>();
  private readonly p2pReadiness = new Map<string, boolean>();
  private readonly hiddenTransferIds = new Map<string, number>();
  private readonly hiddenTransferStorageKey: string;
  private readonly restoredScopes = new Set<string>();
  private readonly restorePromises = new Map<string, Promise<void>>();
  private readonly relayTaskCooldowns = new Map<string, { expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  private activeRoomId: string;
  private serverConnectionEpoch = 0;
  private relayTransportEnabled = false;
  private relayDisabledForConnection = false;
  private serverCapabilities: FileTransferV2Capabilities | null = null;
  private serverHelloPending = false;
  private serverHelloTimer: ReturnType<typeof setTimeout> | null = null;
  private serverHelloRetries = 0;
  private serverHelloWaiters = new Set<{ resolve: (supported: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  private peerHelloWaiters = new Map<string, {
    promise: Promise<boolean>;
    resolve: (supported: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private disposed = false;

  constructor(options: FileTransferV2ApplicationAdapterOptions) {
    this.options = options;
    this.hiddenTransferStorageKey = `${HIDDEN_TRANSFER_STORAGE_PREFIX}${options.selfId()}`;
    this.restoreHiddenTransferIds();
    const store = options.store || getFileTransferV2Store();
    if (!store) throw new Error("IndexedDB is required for file transfer v2");
    this.store = store;
    if (!sharedStore) sharedStore = store;
    this.activeRoomId = options.roomId();
    this.engine = new FileTransferV2Engine({
      selfId: options.selfId,
      roomId: options.roomId,
      store,
      paths: () => this.getPaths(),
      onUpdate: snapshot => options.onUpdate(snapshot),
      onReceived: (task, file) => options.onReceived(task, file),
    });
  }

  getDiscoveryCapability(): FileTransferV2DiscoveryOffer {
    return FILE_TRANSFER_V2_DISCOVERY_CAPABILITY;
  }

  supportsPeer(peerId: string): boolean {
    return this.peerOffers.has(peerId);
  }

  captureSendContext(): FileTransferV2SendContext {
    return {
      roomId: this.options.roomId(),
      selfId: this.options.selfId(),
      connectionEpoch: this.serverConnectionEpoch,
    };
  }

  isSendContextCurrent(context: FileTransferV2SendContext): boolean {
    return !this.disposed
      && context.roomId === this.options.roomId()
      && context.roomId === this.activeRoomId
      && context.selfId === this.options.selfId()
      && context.connectionEpoch === this.serverConnectionEpoch;
  }

  async listCompletedReceivedTasks(): Promise<FileTransferV2Task[]> {
    const selfId = this.options.selfId();
    const matches: FileTransferV2Task[] = [];
    for (const task of await this.store.listTasks()) {
      if (task.localParticipantId !== selfId || task.direction !== "receive"
        || task.status !== "completed" || task.expiresAt <= Date.now()
        || this.isHiddenTransfer(task.transferId)) continue;
      if ((await this.store.getCommittedIndices(task.transferId)).length === task.manifest.totalBlocks) matches.push(task);
    }
    return matches;
  }

  /** Called after a normal room connection is adopted. Meeting-only sockets are excluded. */
  beginServerConnection(roomId: string, relayTransportEnabled: boolean): void {
    if (this.disposed) return;
    this.serverConnectionEpoch++;
    if (this.activeRoomId !== roomId) {
      this.activeRoomId = roomId;
      this.peerOffers.clear();
      this.peerCapabilities.clear();
      this.p2pHelloAcknowledged.clear();
      this.peerChannels.clear();
      this.p2pReadiness.clear();
      this.resolvePeerHelloWaiters(false);
    }
    this.clearServerHelloTimer();
    this.resolveServerHelloWaiters(false);
    this.serverCapabilities = null;
    this.serverHelloPending = false;
    this.serverHelloRetries = 0;
    this.relayDisabledForConnection = false;
    this.relayTransportEnabled = relayTransportEnabled && !this.options.isTransportOnly()
      && this.options.getConnectionType() === "custom";
    if (this.canSendServerHello()) this.sendServerHello();
    void this.restore().catch(error => this.options.onError(this.errorMessage(error)));
    this.engine.notifyPathsChanged();
  }

  endServerConnection(): void {
    this.serverConnectionEpoch++;
    this.clearServerHelloTimer();
    this.serverHelloPending = false;
    this.resolveServerHelloWaiters(false);
    this.serverCapabilities = null;
    this.relayTransportEnabled = false;
    this.engine.notifyPathsChanged();
  }

  async restore(): Promise<void> {
    const scope = `${this.options.roomId()}\u0000${this.options.selfId()}`;
    if (this.restoredScopes.has(scope)) return;
    const pending = this.restorePromises.get(scope);
    if (pending) return pending;
    const restoring = (async () => {
      await this.store.expireTasks(Date.now());
      const tasks = await this.store.listTasks();
      for (const task of tasks) {
        if (task.roomId === this.options.roomId() && task.localParticipantId === this.options.selfId()
          && task.expiresAt > Date.now() && !["completed", "cancelled", "failed"].includes(task.status)) {
          this.peerOffers.add(task.peerParticipantId);
        }
      }
      await this.engine.restore();
      this.restoredScopes.add(scope);
    })();
    this.restorePromises.set(scope, restoring);
    try { await restoring; }
    finally { this.restorePromises.delete(scope); }
  }

  setPeerDiscoveryCapability(peerId: string, capability: unknown): void {
    if (!peerId || peerId === this.options.selfId()) return;
    const record = asRecord(capability);
    if (!record || record.version !== 2) {
      this.peerOffers.delete(peerId);
      this.peerCapabilities.delete(peerId);
      this.p2pHelloAcknowledged.delete(peerId);
      this.resolvePeerHelloWaiter(peerId, false);
    } else {
      this.peerOffers.add(peerId);
      this.requestP2PHello(peerId);
    }
    this.refreshPeerPath(peerId);
  }

  onPeerDataChannelChanged(peerId: string): void {
    const channel = this.options.getDataChannel(peerId);
    const changed = this.peerChannels.get(peerId) !== channel;
    if (changed || channel?.readyState !== "open") {
      this.peerChannels.set(peerId, channel);
      this.peerCapabilities.delete(peerId);
      this.p2pHelloAcknowledged.delete(peerId);
      this.resolvePeerHelloWaiter(peerId, false);
    }
    if (channel?.readyState === "open" && this.peerOffers.has(peerId)) this.requestP2PHello(peerId);
    this.refreshPeerPath(peerId);
  }

  onPeerVerificationChanged(peerId: string): void {
    this.refreshPeerPath(peerId);
  }

  async preparePeerForSend(
    peerId: string,
    fileSize: number,
    context = this.captureSendContext(),
  ): Promise<boolean> {
    if (!this.isSendContextCurrent(context)) return false;
    if (!this.peerOffers.has(peerId)) return false;
    if (this.isP2PReady(peerId, fileSize) || this.canUseRelay(peerId, fileSize)) return true;

    const readinessChecks: Promise<boolean>[] = [];
    if (this.options.isP2PVerified(peerId)) readinessChecks.push(this.requestP2PHello(peerId));
    if (!this.serverCapabilities && this.canSendServerHello()) readinessChecks.push(this.waitForServerHello());
    if (readinessChecks.length > 0) await this.waitForAnyReadyPath(readinessChecks);

    if (!this.isSendContextCurrent(context)) return false;
    if (this.canUseRelay(peerId, fileSize)) return true;
    return this.isP2PReady(peerId, fileSize);
  }

  canUseRelay(peerId: string, fileSize: number): boolean {
    return this.isRelaySessionReady() && this.peerOffers.has(peerId)
      && !!this.serverCapabilities
      && this.serverCapabilities.maxFileSize >= fileSize
      && this.serverCapabilities.maxFrameBytes >= FILE_TRANSFER_V2_MIN_FRAME_BYTES;
  }

  async send(peerId: string, file: File, preferRelay = false): Promise<string> {
    if (this.disposed) throw new Error("File transfer v2 adapter is disposed");
    const context = this.captureSendContext();
    if (!(await this.preparePeerForSend(peerId, file.size, context)) || !this.isSendContextCurrent(context)) {
      throw new Error("No negotiated file transfer v2 path is available for this peer");
    }
    const started = this.startSendIfReady(peerId, file, preferRelay, context);
    if (!started) throw new Error("No negotiated file transfer v2 path is available for this peer");
    return started;
  }

  /** Synchronously commits to v2 only if a negotiated path still exists. A null result is safe for legacy fallback. */
  startSendIfReady(
    peerId: string,
    file: File,
    preferRelay = false,
    context = this.captureSendContext(),
  ): Promise<string> | null {
    if (!this.isSendContextCurrent(context) || !this.peerOffers.has(peerId)) return null;
    const relayReady = this.canUseRelay(peerId, file.size);
    if (!relayReady && !this.isP2PReady(peerId, file.size)) return null;
    const preferredPath = preferRelay && this.canUseRelay(peerId, file.size) ? "relay" : undefined;
    return this.engine.send(peerId, file, { preferredPath, multipath: true });
  }

  getSnapshots(): FileTransferV2Snapshot[] {
    return this.engine.getSnapshots().filter(snapshot => !this.isHiddenTransfer(snapshot.transferId));
  }

  async getTasks(): Promise<FileTransferV2Task[]> {
    const selfId = this.options.selfId();
    const roomId = this.options.roomId();
    return (await this.store.listTasks()).filter(task => task.localParticipantId === selfId && task.roomId === roomId
      && !this.isHiddenTransfer(task.transferId));
  }

  async getTask(transferId: string): Promise<FileTransferV2Task | null> {
    const task = await this.store.getTask(transferId);
    return task?.localParticipantId === this.options.selfId() ? task : null;
  }

  async hasCompletedReceivedFile(transferId: string): Promise<boolean> {
    if (this.isHiddenTransfer(transferId)) return false;
    const task = await this.store.getTask(transferId);
    if (!task || task.localParticipantId !== this.options.selfId() || task.direction !== "receive"
      || task.status !== "completed" || task.expiresAt <= Date.now()) return false;
    const indices = await this.store.getCommittedIndices(transferId);
    return indices.length === task.manifest.totalBlocks;
  }

  async getFile(transferId: string): Promise<File> {
    if (this.isHiddenTransfer(transferId)) throw new Error("Received file was removed from history");
    const task = await this.store.getTask(transferId);
    if (!task || task.localParticipantId !== this.options.selfId() || task.direction !== "receive"
      || task.status !== "completed" || task.expiresAt <= Date.now()) {
      throw new Error("Received file is not complete");
    }
    const parts: Blob[] = [];
    for (let index = 0; index < task.manifest.totalBlocks; index++) {
      const block = await this.store.getBlock(transferId, index);
      if (!block) throw new Error(`Missing committed transfer block ${index}`);
      parts.push(block.blob);
    }
    return new File(parts, task.manifest.name, {
      type: task.manifest.type,
      lastModified: task.manifest.lastModified,
    });
  }

  async pinForHistory(fileKey: string): Promise<boolean> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (!transferId || this.isHiddenTransfer(transferId)) return false;
    const task = await this.store.getTask(transferId);
    if (!task || task.localParticipantId !== this.options.selfId() || task.direction !== "receive"
      || !["verifying", "completed"].includes(task.status)) return false;
    if ((await this.store.getCommittedIndices(transferId)).length !== task.manifest.totalBlocks) return false;
    await this.store.updateTask(transferId, { expiresAt: HISTORY_PIN_EXPIRY });
    return true;
  }

  async isHistoryPinCurrent(fileKey: string): Promise<boolean> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (!transferId || this.isHiddenTransfer(transferId)) return false;
    const task = await this.store.getTask(transferId);
    if (!task || task.localParticipantId !== this.options.selfId() || task.direction !== "receive"
      || !["verifying", "completed"].includes(task.status)
      || task.expiresAt !== HISTORY_PIN_EXPIRY) return false;
    return (await this.store.getCommittedIndices(transferId)).length === task.manifest.totalBlocks;
  }

  async deleteFile(fileKey: string): Promise<boolean> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (!transferId) return false;
    return this.hideAndClearTask(transferId);
  }

  /** Stop local work before a history transaction while preserving transfer blocks. */
  async prepareFileDeletion(fileKey: string): Promise<boolean> {
    const transferId = fileTransferV2IdFromHistoryKey(fileKey);
    if (!transferId) return false;
    const task = await this.store.getTask(transferId);
    if (!task || task.localParticipantId !== this.options.selfId()) return false;
    await this.prepareRuntimeForDeletion(task);
    return true;
  }

  async prepareFilesDeletionByUser(userId: string): Promise<number> {
    const localParticipantId = this.options.selfId();
    const tasks = (await this.store.listTasks()).filter(task => task.localParticipantId === localParticipantId
      && task.peerParticipantId === userId);
    for (const task of tasks) await this.prepareRuntimeForDeletion(task);
    return tasks.length;
  }

  async prepareClearAll(): Promise<number> {
    const tasks = await this.store.listTasks();
    for (const task of tasks) await this.prepareRuntimeForDeletion(task);
    return tasks.length;
  }

  async deleteFilesByUser(userId: string): Promise<number> {
    const tasks = await this.store.listTasks();
    const localParticipantId = this.options.selfId();
    const matches = tasks.filter(task => task.localParticipantId === localParticipantId
      && task.peerParticipantId === userId);
    let deleted = 0;
    let firstError: unknown;
    for (const task of matches) {
      try {
        if (await this.hideAndClearTask(task.transferId)) deleted++;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
    return deleted;
  }

  async clearAll(): Promise<number> {
    const tasks = await this.store.listTasks();
    let firstError: unknown;
    for (const task of tasks) {
      try {
        if (["completed", "cancelled", "failed"].includes(task.status)) {
          await this.engine.forgetRuntime(task.transferId);
        } else {
          await this.engine.cancel(task.transferId);
          await this.engine.forgetRuntime(task.transferId);
        }
        await this.store.removeTask(task.transferId);
      } catch (error) {
        this.hiddenTransferIds.delete(task.transferId);
        await this.expireUnlinkedTask(task.transferId);
        firstError ??= error;
      }
    }
    for (const cooldown of this.relayTaskCooldowns.values()) clearTimeout(cooldown.timer);
    this.relayTaskCooldowns.clear();
    this.hiddenTransferIds.clear();
    this.persistHiddenTransferIds();
    if (firstError) throw firstError;
    return tasks.length;
  }

  async pause(transferId: string): Promise<void> { await this.engine.pause(transferId); }
  async resume(transferId: string): Promise<void> { await this.engine.resume(transferId); }
  async resumeWithSource(transferId: string, file: File): Promise<void> { await this.engine.resumeWithSource(transferId, file); }
  async cancel(transferId: string): Promise<void> { await this.engine.cancel(transferId); }

  private async hideAndClearTask(transferId: string): Promise<boolean> {
    const task = await this.store.getTask(transferId);
    if (!task || task.localParticipantId !== this.options.selfId()) return false;
    // Runtimes can survive a room switch. Cancel locally in every room so old
    // source files and in-flight work cannot reappear on a later reconnect. If
    // cancellation fails, leave the task visible and surface the failure.
    try {
      if (["completed", "cancelled", "failed"].includes(task.status)) {
        await this.engine.forgetRuntime(transferId);
      } else {
        await this.engine.cancel(transferId);
        await this.engine.forgetRuntime(transferId);
      }
      const current = await this.store.getTask(transferId);
      if (current) {
        const status = ["completed", "cancelled", "failed"].includes(current.status)
          ? current.status
          : "cancelled";
        await this.store.clearBlocksKeepingTask(transferId, status);
      }
      this.hideTransfer(transferId);
      return true;
    } catch (error) {
      await this.expireUnlinkedTask(transferId);
      throw error;
    }
  }

  private async prepareRuntimeForDeletion(task: FileTransferV2Task): Promise<void> {
    if (["completed", "cancelled", "failed"].includes(task.status)) {
      await this.engine.forgetRuntime(task.transferId);
      return;
    }
    await this.engine.pause(task.transferId);
    const current = await this.store.getTask(task.transferId);
    if (current && !["completed", "cancelled", "failed", "paused"].includes(current.status)) {
      await this.store.updateTask(task.transferId, { status: "paused" });
    }
  }

  private async expireUnlinkedTask(transferId: string): Promise<void> {
    const task = await this.store.getTask(transferId).catch(() => null);
    if (!task) return;
    await this.store.updateTask(transferId, {
      expiresAt: Date.now() + FILE_TRANSFER_V2_DEFAULT_EXPIRY_MS,
    }).catch(() => undefined);
  }

  private restoreHiddenTransferIds(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(this.hiddenTransferStorageKey) || "[]");
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        const record = asRecord(item);
        if (typeof record?.transferId === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(record.transferId)
          && Number.isSafeInteger(record.expiresAt) && (record.expiresAt as number) > Date.now()) {
          this.hiddenTransferIds.set(record.transferId, record.expiresAt as number);
        }
      }
      this.persistHiddenTransferIds();
    } catch {
      localStorage.removeItem(this.hiddenTransferStorageKey);
    }
  }

  private hideTransfer(transferId: string): void {
    this.hiddenTransferIds.set(transferId, Date.now() + FILE_TRANSFER_V2_DEFAULT_EXPIRY_MS);
    this.persistHiddenTransferIds();
  }

  private isHiddenTransfer(transferId: string): boolean {
    const expiresAt = this.hiddenTransferIds.get(transferId);
    if (!expiresAt) return false;
    if (expiresAt > Date.now()) return true;
    this.hiddenTransferIds.delete(transferId);
    this.persistHiddenTransferIds();
    return false;
  }

  private persistHiddenTransferIds(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const now = Date.now();
      for (const [transferId, expiresAt] of this.hiddenTransferIds) {
        if (expiresAt <= now) this.hiddenTransferIds.delete(transferId);
      }
      if (this.hiddenTransferIds.size === 0) localStorage.removeItem(this.hiddenTransferStorageKey);
      else localStorage.setItem(this.hiddenTransferStorageKey, JSON.stringify(
        [...this.hiddenTransferIds].map(([transferId, expiresAt]) => ({ transferId, expiresAt })),
      ));
    } catch {
      // Hidden IDs are a UI hint; the durable task tombstone remains authoritative.
    }
  }

  /** Route a top-level WebSocket `file:v2:control` envelope. */
  handleServerEnvelope(envelope: unknown): boolean {
    const outer = asRecord(envelope);
    if (outer?.type !== "file:v2:control") return false;
    const roomId = typeof outer.channel === "string" ? outer.channel : "";
    if (!roomId || roomId !== this.options.roomId() || roomId !== this.activeRoomId || this.options.isTransportOnly()) return true;
    const value = parseEnvelopeControl(outer);
    const selfId = this.options.selfId();
    if (!value) {
      this.options.onError("The file transfer service returned an unreadable v2 control message");
      return true;
    }

    if (value.from === "server" && value.kind === "error"
      && (value.transferId === undefined || value.transferId === "")) {
      if (!isServerServiceError(value, selfId)) {
        this.options.onError("The file transfer service returned an invalid error message");
        return true;
      }
      const transferId = typeof value.transferId === "string" && value.transferId ? value.transferId : undefined;
      if (isPermanentServerRejection(value.reason as string)) this.disableRelayForConnection();
      else this.scheduleServerHelloRetry();
      this.options.onError(value.reason as string, transferId);
      return true;
    }

    if (!validateFileTransferV2Control(value)) {
      if (value.from === "server") this.disableRelayForConnection();
      this.options.onError("The file transfer service returned an invalid v2 control message");
      return true;
    }
    const control = value;
    if (control.from === "server") {
      if (control.kind === "hello-ack" && control.to === selfId && this.serverHelloPending
        && validateFileTransferV2Capabilities(control.capabilities)) {
        this.serverCapabilities = { ...control.capabilities };
        this.serverHelloPending = false;
        this.serverHelloRetries = 0;
        this.clearServerHelloTimer();
        this.resolveServerHelloWaiters(true);
        this.engine.notifyPathsChanged();
      } else if (control.kind === "error" && control.to === selfId) {
        if (control.transferId) {
          void this.applyServerTaskError(control).catch(error => {
            this.options.onError(this.errorMessage(error), control.transferId);
          });
        }
      }
      return true;
    }
    if (control.to !== selfId) return true;
    this.recordPeerControl(control, "relay");
    void this.engine.handleControl(control, "relay", control.from).catch(error => {
      this.options.onError(this.errorMessage(error), control.transferId);
    });
    return true;
  }

  /** Route DataChannel JSON controls before legacy controls. */
  handleP2PControl(peerId: string, value: unknown): boolean {
    if (this.disposed) return true;
    const controlValue = asRecord(value);
    if (!controlValue || !validateFileTransferV2Control(controlValue)) {
      this.options.onError("The peer sent an invalid file transfer v2 control");
      return true;
    }
    const control = controlValue;
    if (control.from !== peerId || control.to !== this.options.selfId()) return true;
    this.recordPeerControl(control, "p2p");
    void this.engine.handleControl(control, "p2p", peerId).catch(error => {
      this.options.onError(this.errorMessage(error), control.transferId);
    });
    return true;
  }

  /** Returns true for every LSF2-prefixed packet, including malformed ones. */
  handleP2PFrame(peerId: string, bytes: ArrayBuffer | Uint8Array): boolean {
    if (!hasLsf2Magic(bytes)) return false;
    void this.deliverFrame(bytes, "p2p", peerId);
    return true;
  }

  /** Returns true for every LSF2-prefixed packet, including malformed ones. */
  handleRelayFrame(bytes: ArrayBuffer | Uint8Array): boolean {
    if (!hasLsf2Magic(bytes)) return false;
    if (!this.isRelaySessionReady()) return true;
    void (async () => {
      const decoded = decodeFileTransferV2Frame(bytes);
      if (!decoded) return;
      const task = await this.store.getTask(decoded.header.transferId);
      if (!task || task.direction !== "receive" || task.roomId !== this.options.roomId()
        || task.localParticipantId !== this.options.selfId()) return;
      await this.engine.handleFrame(bytes, "relay", task.peerParticipantId);
    })().catch(error => this.options.onError(this.errorMessage(error)));
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearServerHelloTimer();
    this.resolveServerHelloWaiters(false);
    for (const cooldown of this.relayTaskCooldowns.values()) clearTimeout(cooldown.timer);
    this.relayTaskCooldowns.clear();
    this.resolvePeerHelloWaiters(false);
    this.engine.dispose();
    if (activeAdapter === this) activeAdapter = null;
  }

  private getPaths(): FileTransferV2Path[] {
    return [this.p2pPath(), this.relayPath()];
  }

  private p2pPath(): FileTransferV2Path {
    return {
      id: "p2p",
      available: (peerId, manifest) => this.isP2PReady(peerId, manifest.size),
      maxFrameBytes: peerId => this.maxP2PFrameBytes(peerId),
      bufferedAmount: peerId => this.options.getDataChannel(peerId)?.bufferedAmount ?? Number.POSITIVE_INFINITY,
      sendControl: (peerId, control, context) => this.sendP2PControl(peerId, control, context),
      sendFrame: async (peerId, frame, context) => {
        if (!this.isPathContextCurrent(context)) throw new Error("P2P v2 transfer is no longer current");
        const channel = this.options.getDataChannel(peerId);
        if (!channel || channel.readyState !== "open" || !this.isP2PPathReady(peerId)) {
          throw new Error("P2P v2 path is no longer available");
        }
        await waitForBackpressure(
          () => channel?.bufferedAmount ?? Number.POSITIVE_INFINITY,
          () => channel.readyState === "open" && this.options.isP2PVerified(peerId),
        );
        if (!this.isPathContextCurrent(context)
          || channel !== this.options.getDataChannel(peerId)
          || channel.readyState !== "open"
          || !this.isP2PPathReady(peerId)) {
          throw new Error("P2P v2 path is no longer available");
        }
        channel.send(frameToArrayBuffer(frame));
      },
    };
  }

  private relayPath(): FileTransferV2Path {
    return {
      id: "relay",
      available: (peerId, manifest) => this.canUseRelay(peerId, manifest.size)
        && !this.isRelayTaskCoolingDown(manifest.transferId),
      maxFrameBytes: () => this.serverCapabilities?.maxFrameBytes ?? 0,
      bufferedAmount: () => this.options.getServerBufferedAmount(),
      sendControl: (_peerId, control, context) => {
        if (!this.isPathContextCurrent(context) || !this.isRelaySessionReady()) {
          throw new Error("File transfer v2 relay is unavailable");
        }
        if (this.isRelayTaskCoolingDown(control.transferId)) {
          throw new Error("File transfer v2 relay is cooling down for this transfer");
        }
        const connectionEpoch = this.serverConnectionEpoch;
        if (connectionEpoch !== this.serverConnectionEpoch || !this.isPathContextCurrent(context)
          || !this.isRelaySessionReady()) throw new Error("File transfer v2 relay is no longer available");
        this.options.sendServerControl(control);
      },
      sendFrame: async (_peerId, frame, context) => {
        if (!this.isPathContextCurrent(context) || !this.isRelaySessionReady()) {
          throw new Error("File transfer v2 relay is unavailable");
        }
        const decoded = decodeFileTransferV2Frame(frame);
        if (decoded && this.isRelayTaskCoolingDown(decoded.header.transferId)) {
          throw new Error("File transfer v2 relay is cooling down for this transfer");
        }
        const connectionEpoch = this.serverConnectionEpoch;
        await waitForBackpressure(
          () => this.options.getServerBufferedAmount(),
          () => this.isRelaySessionReady(),
        );
        if (!this.isPathContextCurrent(context)
          || connectionEpoch !== this.serverConnectionEpoch
          || !this.isRelaySessionReady()
          || (decoded && this.isRelayTaskCoolingDown(decoded.header.transferId))) {
          throw new Error("File transfer v2 relay is no longer available");
        }
        this.options.sendServerFrame(frameToArrayBuffer(frame));
      },
    };
  }

  private isPathContextCurrent(context?: FileTransferV2PathContext): boolean {
    if (this.disposed) return false;
    if (!context) return this.activeRoomId === this.options.roomId();
    return context.roomId === this.options.roomId()
      && context.roomId === this.activeRoomId
      && context.isCurrent();
  }

  private maxP2PFrameBytes(peerId: string): number {
    const reported = this.options.getMaxSctpMessageSize(peerId);
    const localMaximum = reported === undefined || !Number.isFinite(reported) || reported === 0
      ? FILE_TRANSFER_V2_MAX_FRAME_BYTES
      : reported < 0 ? 0 : Math.min(FILE_TRANSFER_V2_MAX_FRAME_BYTES, Math.floor(reported));
    const remoteMaximum = this.peerCapabilities.get(peerId)?.maxFrameBytes ?? FILE_TRANSFER_V2_MAX_FRAME_BYTES;
    return Math.max(0, Math.min(localMaximum, remoteMaximum));
  }

  private isP2PPathReady(peerId: string): boolean {
    return this.peerOffers.has(peerId) && this.p2pHelloAcknowledged.has(peerId)
      && this.peerCapabilities.has(peerId) && this.options.isP2PVerified(peerId)
      && this.options.getDataChannel(peerId)?.readyState === "open"
      && this.maxP2PFrameBytes(peerId) >= FILE_TRANSFER_V2_MIN_FRAME_BYTES;
  }

  private refreshPeerPath(peerId: string): void {
    const ready = this.isP2PPathReady(peerId);
    const previous = this.p2pReadiness.get(peerId) ?? false;
    this.p2pReadiness.set(peerId, ready);
    if (ready !== previous) this.engine.notifyPathsChanged();
  }

  private isP2PReady(peerId: string, fileSize: number): boolean {
    const remote = this.peerCapabilities.get(peerId);
    return this.isP2PPathReady(peerId) && !!remote && remote.maxFileSize >= fileSize;
  }

  private isRelaySessionReady(): boolean {
    return !this.disposed && this.relayTransportEnabled && !this.relayDisabledForConnection
      && this.serverCapabilities !== null && !this.options.isTransportOnly()
      && this.activeRoomId === this.options.roomId()
      && this.options.isServerConnected() && this.options.getConnectionType() === "custom";
  }

  private canSendServerHello(): boolean {
    return !this.disposed && this.relayTransportEnabled && !this.relayDisabledForConnection
      && !this.options.isTransportOnly() && this.activeRoomId === this.options.roomId()
      && this.options.isServerConnected() && this.options.getConnectionType() === "custom";
  }

  private sendServerHello(): void {
    if (!this.canSendServerHello() || this.serverHelloPending) return;
    this.serverHelloPending = true;
    try {
      this.options.sendServerControl({
        version: 2,
        kind: "hello",
        from: this.options.selfId(),
        to: "server",
        capabilities: LOCAL_CAPABILITIES,
      });
    } catch (error) {
      this.serverHelloPending = false;
      this.options.onError(this.errorMessage(error));
      return;
    }
    this.serverHelloTimer = setTimeout(() => {
      this.serverHelloPending = false;
      this.serverHelloTimer = null;
      this.resolveServerHelloWaiters(false);
      this.scheduleServerHelloRetry();
    }, SERVER_HELLO_TIMEOUT_MS);
  }

  private waitForServerHello(): Promise<boolean> {
    if (this.serverCapabilities) return Promise.resolve(true);
    if (!this.canSendServerHello()) return Promise.resolve(false);
    if (!this.serverHelloPending) this.sendServerHello();
    if (this.serverCapabilities) return Promise.resolve(true);
    if (!this.serverHelloPending) return Promise.resolve(false);
    return new Promise(resolve => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          this.serverHelloWaiters.delete(waiter);
          resolve(!!this.serverCapabilities);
        }, SERVER_HELLO_TIMEOUT_MS),
      };
      this.serverHelloWaiters.add(waiter);
    });
  }

  private resolveServerHelloWaiters(supported: boolean): void {
    for (const waiter of this.serverHelloWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(supported);
    }
    this.serverHelloWaiters.clear();
  }

  private async waitForAnyReadyPath(checks: Promise<boolean>[]): Promise<void> {
    await new Promise<void>(resolve => {
      let remaining = checks.length;
      let settled = false;
      for (const check of checks) {
        void check.then(ready => {
          if (settled) return;
          if (ready) {
            settled = true;
            resolve();
            return;
          }
          remaining--;
          if (remaining === 0) resolve();
        }, () => {
          if (settled) return;
          remaining--;
          if (remaining === 0) resolve();
        });
      }
    });
  }

  private scheduleServerHelloRetry(): void {
    if (!this.canSendServerHello() || this.serverCapabilities || this.serverHelloRetries >= MAX_SERVER_HELLO_RETRIES) return;
    this.clearServerHelloTimer();
    this.serverHelloPending = false;
    this.serverHelloRetries++;
    this.serverHelloTimer = setTimeout(() => {
      this.serverHelloTimer = null;
      this.sendServerHello();
    }, SERVER_HELLO_RETRY_DELAY_MS);
  }

  private disableRelayForConnection(): void {
    this.relayDisabledForConnection = true;
    this.serverCapabilities = null;
    this.serverHelloPending = false;
    this.clearServerHelloTimer();
    this.resolveServerHelloWaiters(false);
    this.engine.notifyPathsChanged();
  }

  private async sendP2PControl(
    peerId: string,
    control: FileTransferV2Control,
    context?: FileTransferV2PathContext,
  ): Promise<void> {
    if (!this.isPathContextCurrent(context)) throw new Error("P2P v2 transfer is no longer current");
    const channel = this.options.getDataChannel(peerId);
    if (!channel || channel.readyState !== "open") throw new Error("P2P data channel is unavailable");
    if (!this.isPathContextCurrent(context)
      || channel !== this.options.getDataChannel(peerId)
      || channel.readyState !== "open") throw new Error("P2P data channel is no longer available");
    this.options.sendP2PControl(peerId, control);
  }

  private requestP2PHello(peerId: string): Promise<boolean> {
    if (!this.peerOffers.has(peerId)) return Promise.resolve(false);
    if (this.p2pHelloAcknowledged.has(peerId)) return Promise.resolve(true);
    const channel = this.options.getDataChannel(peerId);
    if (!channel || channel.readyState !== "open") return Promise.resolve(false);
    const existing = this.peerHelloWaiters.get(peerId);
    if (existing) return existing.promise;

    let resolveWaiter!: (supported: boolean) => void;
    const promise = new Promise<boolean>(resolve => { resolveWaiter = resolve; });
    const timer = setTimeout(() => this.resolvePeerHelloWaiter(peerId, this.p2pHelloAcknowledged.has(peerId)), PEER_HELLO_TIMEOUT_MS);
    this.peerHelloWaiters.set(peerId, { promise, resolve: resolveWaiter, timer });
    try {
      this.options.sendP2PControl(peerId, {
        version: 2,
        kind: "hello",
        from: this.options.selfId(),
        to: peerId,
        capabilities: LOCAL_CAPABILITIES,
      });
    } catch {
      this.resolvePeerHelloWaiter(peerId, false);
    }
    return promise;
  }

  private recordPeerControl(control: FileTransferV2Control, pathId: "p2p" | "relay"): void {
    if (control.kind === "hello-ack" && pathId === "p2p" && control.capabilities
      && validateFileTransferV2Capabilities(control.capabilities)) {
      const previous = this.peerCapabilities.get(control.from);
      this.peerCapabilities.set(control.from, { ...control.capabilities });
      this.p2pHelloAcknowledged.add(control.from);
      this.resolvePeerHelloWaiter(control.from, true);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(control.capabilities)) {
        this.refreshPeerPath(control.from);
      }
    }
  }

  private async applyServerTaskError(control: FileTransferV2Control): Promise<void> {
    if (control.kind !== "error" || !control.transferId) return;
    const task = await this.store.getTask(control.transferId);
    if (!task) {
      console.debug("[FileTransferV2] Ignoring server error for an unknown transfer", control.transferId);
      return;
    }
    if (task.roomId !== this.options.roomId() || task.localParticipantId !== this.options.selfId()) {
      console.debug("[FileTransferV2] Ignoring server error outside the current room or owner", control.transferId);
      return;
    }
    const previous = this.relayTaskCooldowns.get(control.transferId);
    if (previous) clearTimeout(previous.timer);
    const expiresAt = Date.now() + SERVER_TASK_RETRY_COOLDOWN_MS;
    const transferId = control.transferId;
    const timer = setTimeout(() => {
      this.relayTaskCooldowns.delete(transferId);
      this.engine.notifyPathsChanged();
    }, SERVER_TASK_RETRY_COOLDOWN_MS);
    this.relayTaskCooldowns.set(transferId, { expiresAt, timer });
    // This rejection applies to this relay path and transfer only. P2P keeps running.
    this.engine.notifyPathsChanged();
    console.debug("[FileTransferV2] Cooling down relay for a rejected transfer path", transferId, control.reason || "unspecified reason");
  }

  private isRelayTaskCoolingDown(transferId?: string): boolean {
    if (!transferId) return false;
    const cooldown = this.relayTaskCooldowns.get(transferId);
    if (!cooldown) return false;
    if (cooldown.expiresAt > Date.now()) return true;
    clearTimeout(cooldown.timer);
    this.relayTaskCooldowns.delete(transferId);
    return false;
  }

  private async deliverFrame(bytes: ArrayBuffer | Uint8Array, pathId: "p2p" | "relay", peerId: string): Promise<void> {
    try {
      await this.engine.handleFrame(bytes, pathId, peerId);
    } catch (error) {
      this.options.onError(this.errorMessage(error));
    }
  }

  private resolvePeerHelloWaiter(peerId: string, supported: boolean): void {
    const waiter = this.peerHelloWaiters.get(peerId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.peerHelloWaiters.delete(peerId);
    waiter.resolve(supported);
  }

  private resolvePeerHelloWaiters(supported: boolean): void {
    for (const peerId of this.peerHelloWaiters.keys()) this.resolvePeerHelloWaiter(peerId, supported);
  }

  private clearServerHelloTimer(): void {
    if (!this.serverHelloTimer) return;
    clearTimeout(this.serverHelloTimer);
    this.serverHelloTimer = null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Standalone 24-hour expiry policy for UI diagnostics. */
export const FILE_TRANSFER_V2_UNPINNED_EXPIRY_MS = FILE_TRANSFER_V2_DEFAULT_EXPIRY_MS;
