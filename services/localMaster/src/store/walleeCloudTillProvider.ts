import type { PaymentProviderRequest, PaymentProviderResult } from "./paymentProviderTypes.js";
import {
  beginPaymentAttempt,
  ensurePaymentRecoveryJob,
  recordPaymentEvent,
  storePaymentReceipts,
  updatePaymentAttempt
} from "./paymentAttemptStore.js";
import { selectActiveWalleeTerminal } from "./walleeConfigStore.js";
import { mapWalleeProviderState, WalleeApiError, WalleeClient, type WalleeTransaction } from "./walleeClient.js";

export async function startWalleeCloudTillPayment(request: PaymentProviderRequest): Promise<PaymentProviderResult> {
  const attemptHandle = beginPaymentAttempt(request.request, request.amount);
  const attempt = attemptHandle.attempt;
  if (attemptHandle.mode === "replay") {
    const successful = attempt.lifecycleState === "provider_authorized" || attempt.lifecycleState === "provider_completed" || attempt.lifecycleState === "completed";
    return {
      provider: "WALLEE_CLOUD_TILL",
      payment_attempt_id: attempt.id,
      provider_transaction_id: attempt.providerTransactionId,
      provider_status: attempt.providerState ?? "UNKNOWN",
      lifecycle_state: attempt.lifecycleState as PaymentProviderResult["lifecycle_state"],
      authorized: successful,
      reconciliation_required: attempt.reconciliationRequired === 1,
      failure_reason: attempt.failureReason
    };
  }

  const { config, terminal } = selectActiveWalleeTerminal(request.request.wallee_terminal_config_id);
  const client = new WalleeClient(config.credentials);
  let transactionId: string | null = null;

  try {
    let transaction = await client.createTransaction({
      merchantReference: attempt.merchantReference,
      currency: "CHF",
      language: "de-CH",
      amount: request.amount,
      lines: request.lines
    });
    transactionId = String(transaction.id);
    updatePaymentAttempt(attempt.id, {
      providerTransactionId: transactionId,
      providerState: transaction.state ?? "CREATE",
      lifecycleState: "provider_pending"
    });
    recordPaymentEvent(attempt.id, "PROVIDER_TRANSACTION_CREATED", transaction.state ?? "CREATE", transaction);

    if (config.confirmationPolicy === "EXPLICIT") {
      transaction = await client.confirmTransaction(transaction);
      updatePaymentAttempt(attempt.id, { providerState: transaction.state ?? "CONFIRMED", lifecycleState: "provider_pending" });
      recordPaymentEvent(attempt.id, "PROVIDER_TRANSACTION_CONFIRMED", transaction.state ?? "CONFIRMED", transaction);
    }

    const maxAttempts = positiveInteger(process.env.WALLEE_CLOUD_TILL_LONG_POLL_ATTEMPTS, 3);
    let finalTransaction: WalleeTransaction | null = null;
    for (let pollAttempt = 0; pollAttempt < maxAttempts; pollAttempt += 1) {
      const result = await client.performTerminalTransaction(transactionId, terminal, "de-CH");
      const mapped = mapWalleeProviderState(result.state);
      recordPaymentEvent(attempt.id, result.state === "PENDING" ? "PROVIDER_LONG_POLL_TIMEOUT" : "PROVIDER_TERMINAL_RESULT", result.state ?? null, result);
      updatePaymentAttempt(attempt.id, { providerState: mapped.providerState, lifecycleState: mapped.lifecycleState });
      if (mapped.final) {
        finalTransaction = result as WalleeTransaction;
        break;
      }
    }

    if (!finalTransaction) {
      finalTransaction = await client.readTransaction(transactionId);
      recordPaymentEvent(attempt.id, "PROVIDER_TRANSACTION_READ", finalTransaction.state ?? null, finalTransaction);
    }

    const mapped = mapWalleeProviderState(finalTransaction.state);
    if (!mapped.final) {
      updatePaymentAttempt(attempt.id, {
        providerState: mapped.providerState,
        lifecycleState: "reconciliation_required",
        reconciliationRequired: true,
        failureReason: "Wallee transaction has no final state yet."
      });
      ensurePaymentRecoveryJob(attempt.id, "RECONCILE");
      return providerResult(attempt.id, transactionId, mapped.providerState, "reconciliation_required", false, true, "Wallee transaction requires reconciliation.");
    }

    updatePaymentAttempt(attempt.id, {
      providerState: mapped.providerState,
      lifecycleState: mapped.lifecycleState,
      reconciliationRequired: false,
      failureReason: mapped.successful ? null : "Wallee terminal returned " + mapped.providerState + "."
    });

    if (mapped.successful && config.receiptPolicy === "FETCH_AND_QUEUE_UNPRINTED") {
      try {
        const receipts = await client.fetchReceipts(transactionId);
        storePaymentReceipts(attempt.id, transactionId, receipts);
        recordPaymentEvent(attempt.id, "PROVIDER_RECEIPTS_FETCHED", mapped.providerState, { count: receipts.length });
      } catch (error) {
        ensurePaymentRecoveryJob(attempt.id, "FETCH_RECEIPTS");
        recordPaymentEvent(attempt.id, "PROVIDER_RECEIPTS_PENDING", mapped.providerState, { error: safeError(error) });
      }
    }

    if (mapped.successful) ensurePaymentRecoveryJob(attempt.id, "RECONCILE");

    return providerResult(
      attempt.id,
      transactionId,
      mapped.providerState,
      mapped.lifecycleState,
      mapped.successful,
      false,
      mapped.successful ? null : "Wallee terminal returned " + mapped.providerState + "."
    );
  } catch (error) {
    if (isTerminalTransactionCancelled(error)) {
      const providerState = "CANCELLED";
      updatePaymentAttempt(attempt.id, {
        providerTransactionId: transactionId,
        providerState,
        lifecycleState: "cancelled",
        reconciliationRequired: false,
        failureReason: null
      });
      recordPaymentEvent(attempt.id, "PROVIDER_TERMINAL_CANCELLED", providerState, { status: error.status });
      return providerResult(attempt.id, transactionId, providerState, "cancelled", false, false, null);
    }
    const message = safeError(error);
    const retryable = transactionId !== null && (!(error instanceof WalleeApiError) || error.status === 0 || error.status === 409 || error.status === 542 || error.status === 543 || error.status >= 500);
    const lifecycleState = retryable ? "reconciliation_required" : "failed";
    updatePaymentAttempt(attempt.id, {
      providerTransactionId: transactionId,
      lifecycleState,
      reconciliationRequired: retryable,
      failureReason: message
    });
    recordPaymentEvent(attempt.id, "PROVIDER_ERROR", null, { error: message });
    if (retryable) ensurePaymentRecoveryJob(attempt.id, "RECONCILE");
    return providerResult(attempt.id, transactionId, "UNKNOWN", lifecycleState, false, retryable, message);
  }
}

function isTerminalTransactionCancelled(error: unknown) {
  if (!(error instanceof WalleeApiError) || error.status !== 422) return false;
  try {
    const body = JSON.parse(error.responseBody) as { message?: unknown };
    return typeof body.message === "string" && body.message.trim().toLowerCase() === "terminal transaction canceled.";
  } catch {
    return false;
  }
}

function providerResult(
  attemptId: string,
  transactionId: string | null,
  providerStatus: string,
  lifecycleState: PaymentProviderResult["lifecycle_state"],
  authorized: boolean,
  reconciliationRequired: boolean,
  failureReason: string | null
): PaymentProviderResult {
  return {
    provider: "WALLEE_CLOUD_TILL",
    payment_attempt_id: attemptId,
    provider_transaction_id: transactionId,
    provider_status: providerStatus,
    lifecycle_state: lifecycleState,
    authorized,
    reconciliation_required: reconciliationRequired,
    failure_reason: failureReason
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeError(error: unknown) {
  if (error instanceof WalleeApiError) return error.message + (error.responseBody ? " " + error.responseBody.slice(0, 500) : "");
  return error instanceof Error ? error.message : String(error);
}
