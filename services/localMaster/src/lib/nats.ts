import { connect, type NatsConnection, type Subscription } from "nats";
import { getRelayRuntimeBinding } from "../cloudBinding.js";
import { pollRelayCommands } from "../relayCommandWorker.js";

let natsConn: NatsConnection | null = null;
let subscription: Subscription | null = null;
let isConnecting = false;

export async function getNatsConnection(): Promise<NatsConnection> {
  if (natsConn) return natsConn;

  const url = process.env.NATS_URL ?? "nats://localhost:4222";
  natsConn = await connect({
    servers: url,
    reconnect: true,
    reconnectTimeWait: 5000,
    maxReconnectAttempts: -1, // Infinite reconnect
  });

  // Handle connection events
  void (async () => {
    for await (const status of natsConn!.status()) {
      console.log(`NATS status change: ${status.type}`, status.data);
      if (status.type === "reconnect") {
        // Trigger a catch-up poll when we reconnect
        void pollRelayCommands();
      }
    }
  })();

  return natsConn;
}

export async function setupNatsCommandSubscription() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const binding = getRelayRuntimeBinding();
    if (!binding) {
      console.log("No cloud binding active. Skipping NATS subscription setup.");
      isConnecting = false;
      return;
    }

    const nc = await getNatsConnection();

    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    const subject = `commands.${binding.tenant_id}.${binding.location_id}.${binding.local_master_instance_id}`;
    subscription = nc.subscribe(subject);
    console.log(`Subscribed to NATS commands on subject: ${subject}`);

    void (async () => {
      for await (const msg of subscription!) {
        console.log(`Received NATS command poke on ${msg.subject}`);
        void pollRelayCommands();
      }
    })();
  } catch (error) {
    console.warn("Failed to setup NATS command subscription:", error);
  } finally {
    isConnecting = false;
  }
}

export async function closeNatsConnection() {
  if (natsConn) {
    await natsConn.close();
    natsConn = null;
    subscription = null;
  }
}
