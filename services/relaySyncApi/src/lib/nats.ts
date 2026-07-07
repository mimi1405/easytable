import { connect, type NatsConnection } from "nats";

let natsConn: NatsConnection | null = null;
let connectNats = connect;

export async function getNatsConnection(): Promise<NatsConnection> {
  if (!natsConn) {
    const url = process.env.NATS_URL ?? "nats://localhost:4222";
    try {
      natsConn = await connectNats({ servers: url });
      console.log(`Connected to NATS server at ${url}`);
    } catch (error) {
      console.error(`Failed to connect to NATS server at ${url}:`, error);
      throw error;
    }
  }
  return natsConn;
}

export async function publishCommandEvent(
  tenantId: string,
  locationId: string,
  instanceId: string,
  commandId: string
) {
  try {
    const nc = await getNatsConnection();
    const subject = `commands.${tenantId}.${locationId}.${instanceId}`;
    nc.publish(subject, new TextEncoder().encode(JSON.stringify({ commandId })));
  } catch (error) {
    console.warn("Failed to publish NATS command event:", error);
  }
}

export function setNatsConnectForTest(nextConnect: typeof connect) {
  connectNats = nextConnect;
  natsConn = null;
}

export function resetNatsForTest() {
  connectNats = connect;
  natsConn = null;
}
