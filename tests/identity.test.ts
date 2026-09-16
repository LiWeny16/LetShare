import assert from "node:assert/strict";
import test from "node:test";
import { initializeIdentity, updateIdentityUserName, type IdentityStorage } from "../src/app/libs/identity/identity";

function storage(): IdentityStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

test("identity initializes once with a stable nickname+random uniqId", () => {
  const store = storage();
  const first = initializeIdentity(store);
  const second = initializeIdentity(store);

  assert.equal(second.uniqId, first.uniqId);
  assert.equal(second.userName, first.userName);
  assert.equal(second.userNameExplicit, false);
  assert.match(first.uniqId, new RegExp(`^${first.userName}:`));
});

test("renaming updates userName without changing uniqId", () => {
  const store = storage();
  const first = initializeIdentity(store);
  const renamed = updateIdentityUserName("会议来宾", store);

  assert.equal(renamed.userName, "会议来宾");
  assert.equal(renamed.userNameExplicit, true);
  assert.equal(renamed.uniqId, first.uniqId);
  assert.equal(initializeIdentity(store).uniqId, first.uniqId);
});

test("legacy memorableState keeps the existing uniqId while deriving userName", () => {
  const store = storage();
  store.setItem("memorableState", JSON.stringify({ memorable: { userId: "old-account", uniqId: "旧昵称:random" } }));

  const identity = initializeIdentity(store);
  assert.equal(identity.userId, "old-account");
  assert.equal(identity.userName, "旧昵称");
  assert.equal(identity.userNameExplicit, false);
  assert.equal(identity.uniqId, "旧昵称:random");
});

test("an existing explicit userName skips the first-meeting name gate", () => {
  const store = storage();
  store.setItem("memorableState", JSON.stringify({ memorable: {
    userId: "old-account",
    userName: "Alice",
    uniqId: "old-nickname:random",
  } }));

  const identity = initializeIdentity(store);
  assert.equal(identity.userName, "Alice");
  assert.equal(identity.userNameExplicit, true);
});
