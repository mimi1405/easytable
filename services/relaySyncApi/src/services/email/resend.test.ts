import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { resetResendClientFactoryForTest, sendEmailWithResend, setResendClientFactoryForTest } from "./resend.js";

afterEach(() => {
  resetResendClientFactoryForTest();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
});

test("sendEmailWithResend sends the expected payload", async () => {
  const sentPayloads: unknown[] = [];
  process.env.RESEND_API_KEY = "test_key";
  process.env.RESEND_FROM_EMAIL = "EasyTable <info@example.test>";
  setResendClientFactoryForTest((apiKey) => {
    assert.equal(apiKey, "test_key");
    return {
      emails: {
        async send(payload) {
          sentPayloads.push(payload);
          return {};
        },
      },
    };
  });

  await sendEmailWithResend({
    to: "owner@example.test",
    subject: "Reset",
    text: "Reset text",
    html: "<p>Reset</p>",
  });

  assert.deepEqual(sentPayloads, [
    {
      from: "EasyTable <info@example.test>",
      to: ["owner@example.test"],
      subject: "Reset",
      text: "Reset text",
      html: "<p>Reset</p>",
    },
  ]);
});

test("sendEmailWithResend fails when email config is missing", async () => {
  await assert.rejects(
    () =>
      sendEmailWithResend({
        to: "owner@example.test",
        subject: "Reset",
        text: "Reset text",
        html: "<p>Reset</p>",
      }),
    /RESEND_API_KEY/
  );
});

test("sendEmailWithResend surfaces Resend errors", async () => {
  process.env.RESEND_API_KEY = "test_key";
  process.env.RESEND_FROM_EMAIL = "EasyTable <info@example.test>";
  setResendClientFactoryForTest(() => ({
    emails: {
      async send() {
        return { error: { message: "resend rejected payload" } };
      },
    },
  }));

  await assert.rejects(
    () =>
      sendEmailWithResend({
        to: "owner@example.test",
        subject: "Reset",
        text: "Reset text",
        html: "<p>Reset</p>",
      }),
    /resend rejected payload/
  );
});
