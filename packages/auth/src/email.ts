import { authConfig } from "./config";

export type RecoveryEmail = { to: string; resetUrl: string; expiresAt: string };
export type VerificationEmail = {
  to: string;
  verificationUrl: string;
  expiresAt: string;
};
export interface EmailTransport {
  sendPasswordReset(message: RecoveryEmail): Promise<void>;
  sendEmailVerification(message: VerificationEmail): Promise<void>;
}
let fixtureTransport: EmailTransport | undefined;
// Every admitted recovery request uses this response floor. Delivery must finish
// earlier so a real address, an unknown account and a provider timeout take the
// same public path without detached work or unbounded request concurrency.
export const recoveryResponseMilliseconds = 2000;
const recoveryDeliveryMilliseconds = 1500;

/** Test injection cannot be activated in a production process. No credentials are logged. */
export function setEmailTransportForTests(transport?: EmailTransport) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Email fixtures require a test process");
  fixtureTransport = transport;
}
export function emailDeliveryConfigured() {
  return Boolean(
    fixtureTransport ||
    (process.env.EMAIL_PROVIDER === "resend" &&
      process.env.EMAIL_API_KEY &&
      process.env.EMAIL_FROM),
  );
}
export async function sendPasswordReset(message: RecoveryEmail) {
  const transport = fixtureTransport;
  return deliverWithin(
    (signal) =>
      transport
        ? transport.sendPasswordReset(message)
        : sendEmail(
            message.to,
            message.resetUrl,
            "Reset your Tell Aviv password",
            "Use this one-time link to reset your Tell Aviv password. It expires in 20 minutes.",
            signal,
          ),
    recoveryDeliveryMilliseconds,
  );
}
export async function sendEmailVerification(message: VerificationEmail) {
  if (fixtureTransport) return fixtureTransport.sendEmailVerification(message);
  return sendEmail(
    message.to,
    message.verificationUrl,
    "Verify your Tell Aviv email",
    "Use this one-time link to verify your private Tell Aviv email. It expires in 20 minutes.",
  );
}
async function sendEmail(
  to: string,
  url: string,
  subject: string,
  introduction: string,
  signal = AbortSignal.timeout(5000),
) {
  if (!emailDeliveryConfigured())
    throw new Error("Recovery email delivery is not configured");
  const expected = new URL(authConfig().appUrl).origin;
  const reset = new URL(url);
  if (reset.origin !== expected) throw new Error("Unexpected recovery origin");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.EMAIL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject,
      text: `${introduction}\n\n${url}\n\nIf you did not request this, ignore this message.`,
    }),
    signal,
    redirect: "error",
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Recovery email delivery failed");
}

async function deliverWithin(
  delivery: (signal: AbortSignal) => Promise<void>,
  milliseconds: number,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      delivery(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Recovery email delivery timed out"));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
