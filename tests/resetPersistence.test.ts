import assert from "node:assert/strict";
import test from "node:test";

class IsolatedStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("AC-001 Reset All restores defaults and discards the previous identity", async () => {
  const storage = new IsolatedStorage();
  storage.setItem("user_settings", JSON.stringify({
    roomId: "old-room",
    userTheme: "dark",
    micDeviceId: "old-microphone",
    videoDeviceId: "old-camera",
    meetingCameraDefaultOn: true,
    meetingMicrophoneDefaultOn: true,
  }));
  storage.setItem("memorableState", JSON.stringify({ memorable: {
    userId: "old-user-id",
    userName: "Old Display Name",
    userNameExplicit: true,
    uniqId: "old-display-name:old-random-id",
  } }));
  storage.setItem("countryCode", "+86");
  storage.setItem("phoneNumber", "12345678");
  storage.setItem("payNowName", "Old Payee");
  storage.setItem("ls_bundle", "max-compat");
  storage.setItem("ls_force_relay", "1");
  storage.setItem("ls_debug_stats", "1");
  storage.setItem("ls_turn_api", "https://old-turn.example");
  storage.setItem("user-created-content-marker", "keep");

  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

  try {
    const [{ default: settingsStore }, { initializeIdentity }] = await Promise.all([
      import("../src/app/libs/mobx/mobx"),
      import("../src/app/libs/identity/identity"),
    ]);

    settingsStore.reset();

    assert.equal(storage.getItem("memorableState"), null, "previous identity record is removed");
    for (const key of ["countryCode", "phoneNumber", "payNowName", "ls_bundle", "ls_force_relay", "ls_debug_stats", "ls_turn_api"]) {
      assert.equal(storage.getItem(key), null, `${key} is cleared`);
    }
    const persistedSettings = JSON.parse(storage.getItem("user_settings") ?? "{}");
    assert.equal(persistedSettings.roomId, "");
    assert.equal(persistedSettings.userTheme, "light");
    assert.equal(persistedSettings.micDeviceId, "");
    assert.equal(persistedSettings.videoDeviceId, "");
    assert.equal(persistedSettings.meetingCameraDefaultOn, false);
    assert.equal(persistedSettings.meetingMicrophoneDefaultOn, false);
    assert.equal(storage.getItem("user-created-content-marker"), "keep");

    const nextIdentity = initializeIdentity(storage);
    assert.notEqual(nextIdentity.userName, "Old Display Name");
    assert.notEqual(nextIdentity.userId, "old-user-id");
    assert.notEqual(nextIdentity.uniqId, "old-display-name:old-random-id");
    assert.notEqual(nextIdentity.userName, "用户");
  } finally {
    if (previousLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});
