

import { Resend } from "resend";

export type SendEmailInput = {
  html: string;
  subject: string;
  text: string;
  to: string;
};

export type PasswordResetEmailInput = {
  displayName: string;
  temporaryPassword: string;
  to: string;
};

export type AccountSetupEmailInput = {
  displayName: string;
  requiresPin: boolean;
  setupUrl: string;
  to: string;
};

type ResendClient = {
  emails: {
    send: (payload: {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    }) => Promise<{ error?: { message?: string } | null }>;
  };
};

let createResendClient = (apiKey: string): ResendClient => new Resend(apiKey) as ResendClient;

function requireEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const emailFrom = process.env.RESEND_FROM_EMAIL?.trim();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required to send email.");
  }

  if (!emailFrom) {
    throw new Error("RESEND_FROM_EMAIL is required to send email.");
  }

  return {
    apiKey,
    emailFrom,
  };
}

export async function sendEmailWithResend(input: SendEmailInput) {
  const { apiKey, emailFrom } = requireEmailConfig();
  const response = await createResendClient(apiKey).emails.send({
    from: emailFrom,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (response.error) {
    throw new Error(response.error.message || "Could not send the email.");
  }
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput) {
  const greeting = input.displayName ? "Hallo " + input.displayName + "," : "Hallo,";
  const escapedPassword = escapeHtml(input.temporaryPassword);
  const escapedGreeting = escapeHtml(greeting);
  const text = [
    greeting,
    "",
    "dein EasyTable Zugang wurde aktualisiert.",
    "",
    "Temporaeres Passwort:",
    input.temporaryPassword,
    "",
    "Bitte melde dich mit diesem Passwort an und ersetze es danach durch ein eigenes Passwort.",
    "Wenn du diese Aenderung nicht erwartet hast, melde dich bitte beim EasyTable Administrator.",
  ].join("\n");
  const html = `
<!doctype html>
<html lang="de">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>EasyTable Zugang aktualisiert</title>
  </head>
  <body style="margin:0;background:#f6f7f9;color:#17202a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;overflow:hidden;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
            <tr>
              <td style="background:#111827;padding:22px 28px;">
                <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.2px;">easyTable</div>
                <div style="margin-top:4px;font-size:13px;color:#cbd5e1;">Zugang aktualisiert</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapedGreeting}</p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">
                  dein EasyTable Passwort wurde zurueckgesetzt. Verwende das temporaere Passwort unten fuer deine naechste Anmeldung.
                </p>
                <div style="margin:22px 0;padding:18px;border:1px solid #dbeafe;border-radius:10px;background:#eff6ff;">
                  <div style="margin-bottom:8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1d4ed8;">Temporaeres Passwort</div>
                  <code style="display:block;word-break:break-all;border-radius:8px;background:#ffffff;padding:14px 16px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:18px;font-weight:700;color:#111827;">${escapedPassword}</code>
                </div>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
                  Bitte melde dich damit an und ersetze es anschliessend durch ein eigenes Passwort.
                </p>
                <div style="margin-top:22px;border-left:4px solid #f59e0b;background:#fffbeb;padding:12px 14px;color:#78350f;font-size:13px;line-height:1.5;">
                  Wenn du diese Aenderung nicht erwartet hast, melde dich bitte beim EasyTable Administrator.
                </div>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e5e7eb;padding:16px 28px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
                Diese Nachricht wurde automatisch von EasyTable versendet.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  await sendEmailWithResend({
    to: input.to,
    subject: "Dein EasyTable Zugang wurde aktualisiert",
    text,
    html,
  });
}

export async function sendAccountSetupEmail(input: AccountSetupEmailInput) {
  const greeting = input.displayName ? "Hallo " + input.displayName + "," : "Hallo,";
  const escapedGreeting = escapeHtml(greeting);
  const escapedSetupUrl = escapeHtml(input.setupUrl);
  const pinText = input.requiresPin
    ? "Dabei legst du auch deine POS-PIN fest."
    : "Fuer diesen Zugang ist keine POS-PIN erforderlich.";
  const text = [
    greeting,
    "",
    "richte deinen EasyTable Zugang ueber den folgenden sicheren Link ein:",
    input.setupUrl,
    "",
    "Du legst dabei dein eigenes Passwort fest. " + pinText,
    "",
    "Der Link ist einmalig verwendbar und laeuft nach 3 Tagen ab.",
    "Wenn du diese Einladung nicht erwartet hast, kannst du diese Nachricht ignorieren oder dich beim EasyTable Administrator melden.",
  ].join("\n");
  const html = `
<!doctype html>
<html lang="de">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>EasyTable Zugang einrichten</title>
  </head>
  <body style="margin:0;background:#f4f6f8;color:#17202a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;overflow:hidden;border:1px solid #e5e7eb;border-radius:14px;background:#ffffff;">
            <tr>
              <td style="background:#111827;padding:24px 30px;">
                <div style="font-size:21px;font-weight:700;color:#ffffff;letter-spacing:.2px;">easyTable</div>
                <div style="margin-top:4px;font-size:13px;color:#cbd5e1;">Zugang einrichten</div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapedGreeting}</p>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#374151;">
                  richte deinen EasyTable Zugang sicher ein. Du legst dein eigenes Passwort fest.${input.requiresPin ? " Deine POS-PIN erstellst du im selben Schritt." : ""}
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:10px;background:#111827;">
                      <a href="${escapedSetupUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Zugang einrichten</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b7280;">
                  Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br />
                  <a href="${escapedSetupUrl}" style="color:#2563eb;word-break:break-all;">${escapedSetupUrl}</a>
                </p>
                <div style="margin-top:22px;border-left:4px solid #2563eb;background:#eff6ff;padding:12px 14px;color:#1e3a8a;font-size:13px;line-height:1.5;">
                  Der Link ist einmalig verwendbar und laeuft nach 3 Tagen ab.
                </div>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e5e7eb;padding:16px 30px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
                Diese Nachricht wurde automatisch von EasyTable versendet.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  await sendEmailWithResend({
    to: input.to,
    subject: "EasyTable Zugang einrichten",
    text,
    html,
  });
}

export function setResendClientFactoryForTest(factory: (apiKey: string) => ResendClient) {
  createResendClient = factory;
}

export function resetResendClientFactoryForTest() {
  createResendClient = (apiKey: string): ResendClient => new Resend(apiKey) as ResendClient;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
