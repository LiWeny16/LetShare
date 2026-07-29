import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/libs/connection/ServerFileTransfer.ts", "utf8");

test("server relay resume protocol is wired in the client control plane", () => {
 assert.match(source, /RESUME_QUERY:\s*"file:transfer:resume-query"/);
 assert.match(source, /RESUME_STATE:\s*"file:transfer:resume-state"/);
 assert.match(source, /case FILE_TRANSFER_MESSAGE_TYPES\.RESUME_STATE:/);
 assert.match(source, /handleTransferResumeState\(payload\)/);
 assert.match(source, /requestResumeState\(transferId: string/);
 assert.match(source, /type:\s*FILE_TRANSFER_MESSAGE_TYPES\.RESUME_QUERY/);
});
