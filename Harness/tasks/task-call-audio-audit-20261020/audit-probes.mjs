// Repair regression probes (historical RED results remain in REPORT.md).
// Uses current application modules and synthetic RTC objects;
// does not exercise browser audio, real TURN, or cross-border networking.
// Run from repository root: node --import tsx Harness/tasks/task-call-audio-audit-20261020/audit-probes.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { CallManager } from "../../../src/app/libs/call/callManager.ts";
import { buildInvite } from "../../../src/app/libs/call/callSignaling.ts";
import { mergeRemoteCallStream } from "../../../src/app/libs/call/remoteStream.ts";

const originalTimeout = globalThis.setTimeout;
const originalPc = globalThis.RTCPeerConnection;
globalThis.setTimeout = (...args) => {
  const handle = originalTimeout(...args);
  handle.unref?.();
  return handle;
};

class ProbePc {
  static instances = [];
  connectionState = "new";
  signalingState = "stable";
  remoteDescription = null;
  localDescription = null;
  constructor(config) {
    this.initial = structuredClone(config);
    this.current = structuredClone(config);
    ProbePc.instances.push(this);
  }
  addTrack(track) { return { track }; }
  addTransceiver() {}
  getTransceivers() { return []; }
  getSenders() { return []; }
  getReceivers() { return []; }
  async getStats() { return new Map(); }
  async createOffer() { return { type: "offer", sdp: "synthetic-publish" }; }
  async createAnswer() { return { type: "answer", sdp: "synthetic-answer" }; }
  async setLocalDescription(value) { this.localDescription = value; }
  async setRemoteDescription(value) { this.remoteDescription = value; }
  async addIceCandidate() {}
  setConfiguration(config) { this.current = structuredClone(config); }
  close() { this.connectionState = "closed"; }
}

const noop = () => {};
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
let manager;
try {
  globalThis.RTCPeerConnection = ProbePc;
  manager = new CallManager({
    broadcast: noop,
    getSelfId: () => "callee:uid",
    isConnected: () => true,
    fetchTurn: async () => ({
      ice_servers: [{ urls: "turn:synthetic.invalid:3478?transport=tcp", username: "synthetic", credential: "synthetic" }],
      ttl_seconds: 3600,
    }),
    sfu: { available: () => true, send: noop },
  }, {
    onIncoming: noop, onCallState: noop, onRemoteStream: noop,
    onLocalStream: noop, onTransportChange: noop, onCallEnded: noop,
  });
  manager.handleSignal("caller:uid", buildInvite("c_audit", "audio", "callee:uid"));
  await flush();
  assert.equal(ProbePc.instances.length, 0);
  const localStream = { getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] };
  await manager.acceptCall("c_audit", localStream);
  await flush();
  const session = manager.getCallByPeer("caller:uid");
  session.handleSignal("meeting:membership:snapshot", { members: ["caller:uid"] });
  session.handleSignal("meeting:sdp", { type: "offer", to: "caller:uid", sdp: "synthetic-subscribe" });
  await flush();
  const hasTurn = (config) => config.iceServers.some((server) => String(server.urls).includes("turn:"));
  const result = {
    case: "TURN fetch completed before accept",
    publisherConstructedWithTurn: hasTurn(ProbePc.instances[0].initial),
    publisherUpdatedWithTurn: hasTurn(ProbePc.instances[0].current),
    subscriberConstructedWithTurn: hasTurn(ProbePc.instances[1].initial),
  };
  assert.equal(result.publisherConstructedWithTurn, true);
  assert.equal(result.publisherUpdatedWithTurn, true);
  assert.equal(result.subscriberConstructedWithTurn, true);
  console.log(JSON.stringify(result));
} finally {
  manager?.hangup("c_audit");
  globalThis.RTCPeerConnection = originalPc;
  globalThis.setTimeout = originalTimeout;
}

// Extract and execute the actual UI callback to avoid duplicating its merge logic.
const sourcePath = new URL("../../../src/pages/share.tsx", import.meta.url);
const file = ts.createSourceFile("share.tsx", fs.readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(file) === "onRemoteStream") callback = node.initializer;
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(callback);
const compiled = ts.transpile(callback.getText(file), { target: ts.ScriptTarget.ES2022 });
const oldTrack = { id: "old-audio", kind: "audio", readyState: "live" };
const newTrack = { id: "new-audio", kind: "audio", readyState: "live" };
const makeStream = (track) => ({ getTracks: () => [track], addTrack() { throw Error("unexpected add"); } });
let state = { peerId: "peer:uid", remoteStream: null };
const handler = new Function("setActiveCall", "mergeRemoteCallStream", "return " + compiled)(
  (update) => { state = update(state); }, mergeRemoteCallStream,
);
handler("peer:uid", makeStream(oldTrack), "audio");
oldTrack.readyState = "ended";
handler("peer:uid", makeStream(newTrack), "audio");
const selected = state.remoteStream.getTracks()[0];
assert.equal(selected, newTrack);
console.log(JSON.stringify({
  case: "actual share.tsx callback after track replacement",
  incomingTrack: newTrack.id,
  uiKeptTrack: selected.id,
  uiKeptTrackState: selected.readyState,
}));
