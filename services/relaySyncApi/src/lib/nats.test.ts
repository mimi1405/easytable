import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { publishCommandEvent, resetNatsForTest, setNatsConnectForTest } from "./nats.js";

afterEach(async () => {
  await resetNatsForTest();
});

test("publishCommandEvent does not throw when NATS is unavailable", async () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  const originalError = console.error;

  setNatsConnectForTest((async () => {
    throw new Error("NATS unavailable in test");
  }) as never);
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  console.error = () => undefined;

  try {
    await publishCommandEvent("tenant_test", "location_test", "lm_test", "command_test");
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.equal(warnings.length, 1);
  assert.equal(String(warnings[0]?.[0]), "Failed to publish NATS command event:");
});

test("publishCommandEvent publishes the command poke on the scoped subject", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
  const originalLog = console.log;

  setNatsConnectForTest((async () => ({
    publish(subject: string, payload: Uint8Array) {
      published.push({
        subject,
        payload: JSON.parse(new TextDecoder().decode(payload))
      });
    }
  })) as never);
  console.log = () => undefined;

  try {
    await publishCommandEvent("tenant_test", "location_test", "lm_test", "command_test");
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(published, [{
    subject: "commands.tenant_test.location_test.lm_test",
    payload: { commandId: "command_test" }
  }]);
});
