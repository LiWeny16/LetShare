/// <reference lib="webworker" />

import { IncrementalSha256 } from "../sha256";

type HashWorkerRequest =
  | { type: "start"; id: string }
  | { type: "update"; id: string; chunk: ArrayBuffer }
  | { type: "finish"; id: string };

type HashWorkerResponse =
  | { type: "ready" | "updated"; id: string }
  | { type: "result"; id: string; hash: string }
  | { type: "error"; id: string; error: string };

const sessions = new Map<string, IncrementalSha256>();
const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<HashWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "start") {
      sessions.set(request.id, new IncrementalSha256());
      respond({ type: "ready", id: request.id });
      return;
    }
    const hasher = sessions.get(request.id);
    if (!hasher) throw new Error("SHA-256 worker session does not exist");
    if (request.type === "update") {
      hasher.update(new Uint8Array(request.chunk));
      respond({ type: "updated", id: request.id });
      return;
    }
    sessions.delete(request.id);
    respond({ type: "result", id: request.id, hash: hasher.digestHex() });
  } catch (error) {
    sessions.delete(request.id);
    respond({ type: "error", id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
};

function respond(response: HashWorkerResponse): void {
  workerScope.postMessage(response);
}

export {};
