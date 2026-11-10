import test from "node:test";
import assert from "node:assert/strict";

import {
  LOCAL_DEV_SERVER_AUTH_TOKEN,
  LOCAL_DEV_SERVER_URL,
  isLocalDevHostname,
  resolveConnectionTarget,
} from "../src/app/libs/connection/localDevServer";
import {
  PUBLIC_CUSTOM_SERVER_AUTH_TOKEN,
  PUBLIC_CUSTOM_SERVER_URL,
} from "../src/app/libs/connection/publicServerAuth";

test("localhost pages replace the saved public relay with the local Go backend", () => {
  const target = resolveConnectionTarget({
    hostname: "localhost",
    configuredServerUrl: PUBLIC_CUSTOM_SERVER_URL,
    configuredAuthToken: PUBLIC_CUSTOM_SERVER_AUTH_TOKEN,
  });

  assert.deepEqual(target, {
    serverUrl: LOCAL_DEV_SERVER_URL,
    authToken: LOCAL_DEV_SERVER_AUTH_TOKEN,
    usesLocalDevServer: true,
  });
});

test("loopback hostnames are detected", () => {
  assert.equal(isLocalDevHostname("localhost"), true);
  assert.equal(isLocalDevHostname("127.0.0.1"), true);
  assert.equal(isLocalDevHostname("::1"), true);
  assert.equal(isLocalDevHostname("[::1]"), true);
  assert.equal(isLocalDevHostname("letshare.fun"), false);
  assert.equal(isLocalDevHostname("127.0.0.1.example.test"), false);
});

test("an empty saved server URL also selects the local backend", () => {
  const target = resolveConnectionTarget({
    hostname: "127.0.0.1",
    configuredServerUrl: "",
    configuredAuthToken: "",
  });

  assert.equal(target.serverUrl, LOCAL_DEV_SERVER_URL);
  assert.equal(target.authToken, LOCAL_DEV_SERVER_AUTH_TOKEN);
});

test("an explicitly configured private server is preserved on localhost", () => {
  const target = resolveConnectionTarget({
    hostname: "localhost",
    configuredServerUrl: "wss://staging.example.test/socket",
    configuredAuthToken: "private-token",
  });

  assert.deepEqual(target, {
    serverUrl: "wss://staging.example.test/socket",
    authToken: "private-token",
    usesLocalDevServer: false,
  });
});

test("an explicitly configured local port keeps its URL and token", () => {
  const target = resolveConnectionTarget({
    hostname: "localhost",
    configuredServerUrl: "ws://127.0.0.1:9090/",
    configuredAuthToken: "local-custom-token",
  });

  assert.deepEqual(target, {
    serverUrl: "ws://127.0.0.1:9090/",
    authToken: "local-custom-token",
    usesLocalDevServer: true,
  });
});

test("production hostnames continue using the public relay", () => {
  const target = resolveConnectionTarget({
    hostname: "ecs.letshare.fun",
    configuredServerUrl: PUBLIC_CUSTOM_SERVER_URL,
    configuredAuthToken: "stale-token",
  });

  assert.deepEqual(target, {
    serverUrl: PUBLIC_CUSTOM_SERVER_URL,
    authToken: PUBLIC_CUSTOM_SERVER_AUTH_TOKEN,
    usesLocalDevServer: false,
  });
});

test("dev URL and token overrides are honored on localhost", () => {
  const target = resolveConnectionTarget({
    hostname: "localhost",
    configuredServerUrl: PUBLIC_CUSTOM_SERVER_URL,
    configuredAuthToken: PUBLIC_CUSTOM_SERVER_AUTH_TOKEN,
    devServerUrl: "ws://127.0.0.1:18080/",
    devAuthToken: "dev-override-token",
    devBuild: true,
  });

  assert.deepEqual(target, {
    serverUrl: "ws://127.0.0.1:18080/",
    authToken: "dev-override-token",
    usesLocalDevServer: true,
  });
});

test("the existing dev preview override still works outside localhost", () => {
  const target = resolveConnectionTarget({
    hostname: "192.168.1.10",
    configuredServerUrl: PUBLIC_CUSTOM_SERVER_URL,
    configuredAuthToken: PUBLIC_CUSTOM_SERVER_AUTH_TOKEN,
    devServerUrl: "ws://127.0.0.1:18080/",
    devBuild: true,
  });

  assert.deepEqual(target, {
    serverUrl: "ws://127.0.0.1:18080/",
    authToken: PUBLIC_CUSTOM_SERVER_AUTH_TOKEN,
    usesLocalDevServer: true,
  });
});
