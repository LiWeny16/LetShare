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

test("a fresh identity gets a random fun nickname instead of the placeholder", () => {
  const store = storage();
  const identity = initializeIdentity(store);

  assert.notEqual(identity.userName, "用户");
  assert.notEqual(identity.userName, "");
  assert.match(identity.uniqId, new RegExp(`^${identity.userName}:`));
});

test("random nicknames are drawn from a diverse curated list", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const identity = initializeIdentity(storage());
    seen.add(identity.userName);
    assert.notEqual(identity.userName, "用户");
  }
  assert.ok(seen.size >= 5, `expected variety, got ${seen.size} distinct names`);
});

test("stored placeholder '用户' migrates to a random nickname without touching uniqId", () => {
  const store = storage();
  store.setItem("memorableState", JSON.stringify({ memorable: { userId: "u1", uniqId: "用户:abc" } }));

  const identity = initializeIdentity(store);
  assert.notEqual(identity.userName, "用户");
  assert.equal(identity.uniqId, "用户:abc");
  assert.equal(identity.userNameExplicit, false);
});

test("legacy UUID-only uniqId also migrates to a random nickname", () => {
  const store = storage();
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  store.setItem("memorableState", JSON.stringify({ memorable: { userId: uuid, uniqId: `${uuid}:xyz` } }));

  const identity = initializeIdentity(store);
  assert.notEqual(identity.userName, uuid.slice(0, 32));
  assert.match(identity.uniqId, new RegExp(`^${uuid}:xyz$`));
});

test("an explicitly chosen name is never replaced, even if it equals the old placeholder", () => {
  const store = storage();
  store.setItem("memorableState", JSON.stringify({ memorable: {
    userId: "u1",
    userName: "用户",
    userNameExplicit: true,
    uniqId: "用户:abc",
  } }));

  const identity = initializeIdentity(store);
  assert.equal(identity.userName, "用户");
  assert.equal(identity.uniqId, "用户:abc");
});
