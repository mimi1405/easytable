import assert from "node:assert/strict";
import { test } from "node:test";

import { isLoopbackHostname } from "./connection-discovery.js";

test("local discovery is limited to loopback development hosts", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("::1"), true);
  assert.equal(isLoopbackHostname("staff.easytable.ch"), false);
  assert.equal(isLoopbackHostname("192.168.1.20"), false);
});
