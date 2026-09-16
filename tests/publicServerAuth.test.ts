import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_CUSTOM_SERVER_AUTH_TOKEN,
  PUBLIC_CUSTOM_SERVER_URL,
  resolveCustomServerAuthToken,
} from "../src/app/libs/connection/publicServerAuth";

test("public relay repairs a legacy JWT accidentally stored as authToken", () => {
  const legacyProJwt = "eyJhbGciOiJIUzI1NiJ9.eyJpc19wcm8iOnRydWV9.signature";
  assert.equal(
    resolveCustomServerAuthToken(PUBLIC_CUSTOM_SERVER_URL, legacyProJwt),
    PUBLIC_CUSTOM_SERVER_AUTH_TOKEN,
  );
});

test("public relay replaces any stale public-server token", () => {
  assert.equal(
    resolveCustomServerAuthToken(PUBLIC_CUSTOM_SERVER_URL, "a".repeat(64)),
    PUBLIC_CUSTOM_SERVER_AUTH_TOKEN,
  );
});

test("custom servers retain their configured token", () => {
  const customUrl = "wss://private.example.test/socket";
  const token = "private-server-token";
  assert.equal(resolveCustomServerAuthToken(customUrl, token), token);
});
