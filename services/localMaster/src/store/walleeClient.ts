import { createHash, createHmac } from "node:crypto";

import type { BasketLine } from "../types.js";

export type WalleeCredentials = {
  spaceId: string;
  applicationUserId: string;
  authenticationKey: string;
};

export type WalleeTerminalReference = {
  terminalId: string | null;
  terminalIdentifier: string | null;
};

export type WalleeTerminal = {
  id: number | string;
  identifier?: string;
  name?: string;
  state?: string;
  [key: string]: unknown;
};

export type WalleeTransaction = {
  id: number | string;
  state?: string;
  merchantReference?: string;
  [key: string]: unknown;
};

export type WalleeRenderedTerminalReceipt = {
  data: string;
  mimeType: string;
  printed: boolean;
  receiptType: string;
};

export class WalleeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly responseBody: string
  ) {
    super(message);
  }
}

export class WalleeClient {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(private readonly credentials: WalleeCredentials) {
    this.baseUrl = (process.env.WALLEE_API_BASE_URL ?? "https://app-wallee.com/api/v2.0").replace(/\/$/, "");
    this.requestTimeoutMs = positiveInteger(process.env.WALLEE_CLOUD_TILL_REQUEST_TIMEOUT_MS, 120_000);
  }

  async createTransaction(input: {
    merchantReference: string;
    currency: string;
    language: string;
    amount: number;
    lines: BasketLine[];
  }): Promise<WalleeTransaction> {
    return this.request<WalleeTransaction>("POST", "/payment/transactions", {
      currency: input.currency,
      language: input.language,
      merchantReference: input.merchantReference,
      autoConfirmationEnabled: false,
      lineItems: toWalleeLineItems(input.lines, input.merchantReference, input.amount)
    });
  }

  async confirmTransaction(transaction: WalleeTransaction): Promise<WalleeTransaction> {
    try {
      return await this.request<WalleeTransaction>(
        "POST",
        "/payment/transactions/" + encodeURIComponent(String(transaction.id)) + "/confirm",
        transaction
      );
    } catch (error) {
      if (error instanceof WalleeApiError && error.status === 409) {
        return this.readTransaction(String(transaction.id));
      }
      throw error;
    }
  }

  async performTerminalTransaction(
    transactionId: string,
    terminal: WalleeTerminalReference,
    language = "de-CH"
  ): Promise<WalleeTransaction | { state: "PENDING" }> {
    const path = terminal.terminalId
      ? "/payment/terminals/" + encodeURIComponent(terminal.terminalId) + "/perform-transaction"
      : "/payment/terminals/by-identifier/" + encodeURIComponent(required(terminal.terminalIdentifier, "Wallee terminal reference is required.")) + "/perform-transaction";

    try {
      return await this.request<WalleeTransaction>(
        "POST",
        path + "?transactionId=" + encodeURIComponent(transactionId) + "&language=" + encodeURIComponent(language),
        undefined,
        this.requestTimeoutMs
      );
    } catch (error) {
      if (error instanceof WalleeApiError && error.status === 543) {
        return { state: "PENDING" };
      }
      if (error instanceof WalleeApiError && error.status === 409) {
        return this.readTransaction(transactionId);
      }
      throw error;
    }
  }

  readTransaction(transactionId: string): Promise<WalleeTransaction> {
    return this.request("GET", "/payment/transactions/" + encodeURIComponent(transactionId));
  }

  readTerminal(terminalId: string): Promise<WalleeTerminal> {
    return this.request("GET", "/payment/terminals/" + encodeURIComponent(terminalId));
  }

  async resolveTerminal(reference: WalleeTerminalReference): Promise<WalleeTerminal> {
    if (reference.terminalId) {
      try {
        const terminal = await this.readTerminal(reference.terminalId);
        if (!reference.terminalIdentifier || !terminal.identifier || terminal.identifier === reference.terminalIdentifier) return terminal;
      } catch (error) {
        if (!(error instanceof WalleeApiError) || error.status !== 404 || !reference.terminalIdentifier) throw error;
      }
    }

    const response = await this.request<WalleeTerminal[] | { data?: WalleeTerminal[] }>("GET", "/payment/terminals?limit=100");
    const terminals = Array.isArray(response) ? response : response.data ?? [];
    const terminal = terminals.find((candidate) => candidate.identifier === reference.terminalIdentifier);
    if (!terminal) throw new Error("Wallee terminal identifier was not found in the configured space.");
    return terminal;
  }

  fetchReceipts(transactionId: string, format: "PDF" | "TXT" = "PDF", width = 72): Promise<WalleeRenderedTerminalReceipt[]> {
    return this.request(
      "GET",
      "/payment/transactions/" + encodeURIComponent(transactionId) + "/terminal-receipts" +
        "?format=" + encodeURIComponent(format) + "&width=" + encodeURIComponent(String(width))
    );
  }

  voidTransaction(transactionId: string): Promise<Record<string, unknown>> {
    return this.request("POST", "/payment/transactions/" + encodeURIComponent(transactionId) + "/void-online");
  }

  completeTransaction(transactionId: string): Promise<Record<string, unknown>> {
    return this.request("POST", "/payment/transactions/" + encodeURIComponent(transactionId) + "/complete-online");
  }

  refundTransaction(transactionId: string, amount?: number): Promise<Record<string, unknown>> {
    const transaction = safeWalleeLong(transactionId, "Wallee transaction id");
    const nonce = createHash("sha256")
      .update(transactionId + ":" + (amount === undefined ? "full" : String(amount)))
      .digest("hex")
      .slice(0, 32);
    return this.request("POST", "/payment/refunds", {
      transaction,
      externalId: "easytable-refund-" + nonce,
      merchantReference: "easytable-refund-" + nonce,
      type: "MERCHANT_INITIATED_ONLINE",
      ...(amount === undefined ? {} : { amount: amount / 100 })
    });
  }

  triggerTerminalConfiguration(terminalId: string): Promise<void> {
    return this.request("POST", "/payment/terminals/" + encodeURIComponent(terminalId) + "/trigger-configuration");
  }

  triggerTerminalFinalBalance(terminalId: string): Promise<Record<string, unknown>> {
    return this.request("POST", "/payment/terminals/" + encodeURIComponent(terminalId) + "/trigger-final-balance");
  }

  fetchTerminalSummary(summaryId: string): Promise<Record<string, unknown>> {
    return this.request("GET", "/payment/terminals/transaction-summaries/" + encodeURIComponent(summaryId));
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    const maxServerRetries = positiveInteger(process.env.WALLEE_SERVER_ERROR_RETRY_ATTEMPTS, 3);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.requestOnce<T>(method, path, body, timeoutMs);
      } catch (error) {
        if (!(error instanceof WalleeApiError) || error.status !== 542 || attempt >= maxServerRetries - 1) throw error;
        await delay(serverRetryDelay(attempt));
      }
    }
  }

  private async requestOnce<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: createWalleeAuthorizationHeader(url, method, this.credentials.applicationUserId, this.credentials.authenticationKey),
          Accept: "application/json",
          Space: this.credentials.spaceId,
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new WalleeApiError("Wallee request timed out.", 0, path, "");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = await response.text();
    if (!response.ok) {
      throw new WalleeApiError("Wallee API request failed with HTTP " + response.status + ".", response.status, path, responseBody);
    }
    if (!responseBody) return undefined as T;
    return JSON.parse(responseBody) as T;
  }
}

export function mapWalleeProviderState(value: string | undefined) {
  const state = value?.toUpperCase() ?? "UNKNOWN";
  if (["AUTHORIZED"].includes(state)) return { providerState: state, lifecycleState: "provider_authorized" as const, final: true, successful: true };
  if (["COMPLETED", "FULFILL", "FULFILLED"].includes(state)) return { providerState: state, lifecycleState: "provider_completed" as const, final: true, successful: true };
  if (["DECLINE", "DECLINED", "FAILED"].includes(state)) return { providerState: state, lifecycleState: "declined" as const, final: true, successful: false };
  if (["VOIDED", "CANCELED", "CANCELLED"].includes(state)) return { providerState: state, lifecycleState: "cancelled" as const, final: true, successful: false };
  if (["PENDING", "CONFIRMED", "PROCESSING", "CREATE"].includes(state)) return { providerState: state, lifecycleState: "provider_pending" as const, final: false, successful: false };
  return { providerState: state, lifecycleState: "reconciliation_required" as const, final: false, successful: false };
}

function toWalleeLineItems(lines: BasketLine[], merchantReference: string, amount: number) {
  if (lines.length === 0) {
    return [{
      uniqueId: merchantReference,
      type: "PRODUCT",
      name: "EasyTable POS",
      quantity: 1,
      amountIncludingTax: amount / 100
    }];
  }

  return lines.map((line) => ({
    uniqueId: line.id,
    type: "PRODUCT",
    name: line.product_name,
    quantity: line.quantity,
    amountIncludingTax: line.line_total / 100,
    taxRate: line.tax_rate_bps / 100
  }));
}

function createWalleeAuthorizationHeader(
  url: string,
  method: "GET" | "POST",
  applicationUserId: string,
  authenticationKey: string
) {
  const parsed = new URL(url);
  const requestPath = parsed.pathname + parsed.search;
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT", ver: 1 }));
  const payload = base64UrlEncode(JSON.stringify({
    sub: applicationUserId,
    iat: Math.trunc(Date.now() / 1000),
    requestPath,
    requestMethod: method
  }));
  const signingInput = header + "." + payload;
  const key = Buffer.from(authenticationKey, "base64");
  const signature = createHmac("sha256", key).update(signingInput).digest("base64url");
  return "Bearer " + signingInput + "." + signature;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function required(value: string | null, message: string) {
  if (!value) throw new Error(message);
  return value;
}

function safeWalleeLong(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(label + " must be a numeric Wallee id.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(label + " is outside the supported integer range.");
  return parsed;
}

function serverRetryDelay(attempt: number) {
  const base = Math.min(2_000, 100 * 2 ** attempt);
  return base + Math.floor(Math.random() * Math.max(1, Math.floor(base / 2)));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
