import { Socket } from "node:net";

import { listCatalogOutputStations } from "../catalogStore.js";
import { broadcast } from "../realtime.js";
import {
  appendOutboxEvent,
  beginIdempotentCommand,
  completeIdempotentCommand,
  failIdempotentCommand
} from "./commandStore.js";
import {
  localDevices,
  persistLocalDevices,
  persistPosDeviceBindings,
  persistPrintLogs,
  persistStationDeviceBindings,
  persistStationPrintJobs,
  posDeviceBindings,
  printJobs,
  printLogs,
  stationDeviceBindings
} from "./storeState.js";
import {
  formatReceiptPrintBody,
  formatStationPrintBody,
  formatZReportPrintBody,
  normalizeOptionalText,
  printJobId,
  scopedId,
  stationPrintJobId,
  stripEscPosControlCodes
} from "./storeHelpers.js";
import type { PosOrderSnapshot, StoredDayClose } from "./storeState.js";
import type {
  BasketLine,
  CompletedMockPayment,
  LocalDevice,
  LocalDeviceCreateRequest,
  LocalDeviceProvider,
  LocalDeviceType,
  LocalDeviceUpdateRequest,
  PosDeviceBinding,
  PosDeviceBindingUpdateRequest,
  PrintJob,
  PrintLog,
  PrintLogSource,
  RetryPrintJobRequest,
  StationDeviceBinding,
  StationDeviceBindingUpdateRequest
} from "../types.js";

setInterval(() => {
  void processPendingPrintJobs();
}, 5_000);

export function listStationDeviceBindings(): StationDeviceBinding[] {
  return listCatalogOutputStations().map((station) => stationDeviceBindingForStation(station.id));
}

export function getPosDeviceBinding(terminalId: string): PosDeviceBinding {
  return posDeviceBindingForTerminal(normalizeTerminalId(terminalId));
}

export function updatePosDeviceBinding(
  terminalId: string,
  request: PosDeviceBindingUpdateRequest
): PosDeviceBinding {
  const normalizedTerminalId = normalizeTerminalId(terminalId);
  const current = posDeviceBindingForTerminal(normalizedTerminalId);
  const next: PosDeviceBinding = {
    terminal_id: normalizedTerminalId,
    receipt_printer_device_id: normalizeOptionalText(
      request.receipt_printer_device_id,
      current.receipt_printer_device_id
    ),
    z_report_printer_device_id: normalizeOptionalText(
      request.z_report_printer_device_id,
      current.z_report_printer_device_id
    ),
    updated_at: Date.now()
  };

  if (next.receipt_printer_device_id) {
    requireLocalDeviceType(next.receipt_printer_device_id, "PRINTER");
  }

  if (next.z_report_printer_device_id) {
    requireLocalDeviceType(next.z_report_printer_device_id, "PRINTER");
  }

  posDeviceBindings.set(normalizedTerminalId, next);
  persistPosDeviceBindings();

  return next;
}

export function listLocalDevices(): LocalDevice[] {
  return Array.from(localDevices.values()).sort(
    (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
  );
}

export function listPrintLogs(): PrintLog[] {
  return printLogs.slice().sort((left, right) => right.created_at - left.created_at);
}

export function listPrintJobs(): PrintJob[] {
  return printJobs
    .slice()
    .sort((left, right) => right.created_at - left.created_at || (left.station_name ?? "").localeCompare(right.station_name ?? ""));
}

export function retryPrintJob(jobId: string, request: RetryPrintJobRequest = {}) {
  const requestId = request.request_id?.trim();

  if (requestId) {
    const command = beginIdempotentCommand("PRINT_JOB_RETRY", requestId, { job_id: jobId });

    if (command.mode === "replay") {
      return command.result as PrintJob;
    }

    try {
      const job = retryPrintJobUnchecked(jobId);
      appendOutboxEvent("PRINT_JOB_RETRY_QUEUED", job.id, job);
      return completeIdempotentCommand(command.entry, job);
    } catch (error) {
      return failIdempotentCommand(command.entry, error);
    }
  }

  return retryPrintJobUnchecked(jobId);
}

function retryPrintJobUnchecked(jobId: string) {
  const job = printJobs.find((entry) => entry.id === jobId);

  if (!job) {
    throw new Error("Print job not found.");
  }

  if (job.status !== "FAILED") {
    throw new Error("Only failed print jobs can be retried.");
  }

  job.status = "PENDING";
  job.error = null;
  job.updated_at = Date.now();
  persistStationPrintJobs();
  broadcast("PRINT_JOB_UPDATED", { job });
  schedulePrintJobProcessing();

  return job;
}

export function clearPrintLogs() {
  printLogs.splice(0, printLogs.length);
  persistPrintLogs();

  return { ok: true };
}

export function createLocalDevice(request: LocalDeviceCreateRequest): LocalDevice {
  const input = normalizeLocalDeviceInput(request);
  const now = Date.now();
  const device: LocalDevice = {
    id: scopedId("dev", now, localDevices.size),
    name: input.name,
    type: input.type,
    provider: input.provider,
    address_or_device_id: input.address_or_device_id,
    created_at: now,
    updated_at: now
  };

  localDevices.set(device.id, device);
  persistLocalDevices();

  return device;
}

export function updateLocalDevice(deviceId: string, request: LocalDeviceUpdateRequest): LocalDevice {
  const current = localDevices.get(deviceId);

  if (!current) {
    throw new Error("Local device not found.");
  }

  const input = normalizeLocalDeviceInput({
    name: request.name ?? current.name,
    type: request.type ?? current.type,
    provider: request.provider ?? current.provider,
    address_or_device_id: request.address_or_device_id ?? current.address_or_device_id
  });
  const next: LocalDevice = {
    ...current,
    ...input,
    updated_at: Date.now()
  };

  localDevices.set(deviceId, next);
  persistLocalDevices();

  return next;
}

export async function testLocalDevice(deviceId: string) {
  const device = localDevices.get(deviceId);

  if (!device) {
    throw new Error("Local device not found.");
  }

  if (device.type === "PRINTER" && device.provider === "simulator") {
    const log = createPrintLog(device, "TEST", "Testdruck angekommen", [
      "EasyTable Testdruck",
      "Geraet: " + device.name,
      "Quelle: Simulator"
    ].join("\n"));

    return {
      ok: true,
      device_id: device.id,
      message: "Simulierter Testdruck gespeichert.",
      print_log: log
    };
  }

  if (device.type === "PRINTER") {
    await sendEscPosTestPrint(device);

    return {
      ok: true,
      device_id: device.id,
      message: "Testdruck gesendet."
    };
  }

  if (device.type === "KDS_DISPLAY") {
    return {
      ok: true,
      device_id: device.id,
      message: "KDS-Test vorgemerkt. Die echte Display-Ausgabe wird separat verdrahtet."
    };
  }

  throw new Error("Local device type is invalid.");
}

export function updateStationDeviceBinding(
  stationId: string,
  request: StationDeviceBindingUpdateRequest
): StationDeviceBinding {
  const station = listCatalogOutputStations().find((entry) => entry.id === stationId);

  if (!station) {
    throw new Error("Output station not found.");
  }

  const current = stationDeviceBindingForStation(stationId);
  const next: StationDeviceBinding = {
    station_id: stationId,
    kds_device_id: normalizeOptionalText(request.kds_device_id, current.kds_device_id),
    printer_device_id: normalizeOptionalText(request.printer_device_id, current.printer_device_id),
    updated_at: Date.now()
  };

  if (!station.has_kds) {
    next.kds_device_id = null;
  } else if (next.kds_device_id) {
    requireLocalDeviceType(next.kds_device_id, "KDS_DISPLAY");
  }

  if (!station.has_printer) {
    next.printer_device_id = null;
  } else if (next.printer_device_id) {
    requireLocalDeviceType(next.printer_device_id, "PRINTER");
  }

  stationDeviceBindings.set(stationId, next);
  persistStationDeviceBindings();

  return next;
}

export function rebuildStationPrintJobsForOrder(order: PosOrderSnapshot) {
  const now = Date.now();
  const groupedLines = new Map<string, BasketLine[]>();
  const printerStations = listCatalogOutputStations().filter(
    (station) => station.is_active && station.has_printer
  );
  const printerStationByName = new Map(printerStations.map((station) => [station.name, station]));
  const created: PrintJob[] = [];
  const updated: PrintJob[] = [];

  for (const line of order.lines) {
    const stationName = line.station.trim();

    if (!stationName || !printerStationByName.has(stationName)) {
      continue;
    }

    const lines = groupedLines.get(stationName) ?? [];
    lines.push(line);
    groupedLines.set(stationName, lines);
  }

  for (const [stationName, lines] of groupedLines.entries()) {
    const station = printerStationByName.get(stationName);

    if (!station) {
      continue;
    }

    const binding = stationDeviceBindingForStation(station.id);

    if (!binding.printer_device_id) {
      continue;
    }

    const device = localDevices.get(binding.printer_device_id);

    if (!device || device.type !== "PRINTER") {
      continue;
    }

    const jobId = stationPrintJobId(order.id, station.id);
    const existingJob = printJobs.find((job) => job.id === jobId);
    const title = station.name + " Bon angekommen";
    const body = formatStationPrintBody(order, station.name, lines);
    const status = "PENDING";

    if (existingJob) {
      existingJob.order_number = order.order_number;
      existingJob.station_name = station.name;
      existingJob.device_id = device.id;
      existingJob.device_name = device.name;
      existingJob.status = status;
      existingJob.title = title;
      existingJob.body = body;
      existingJob.error = null;
      existingJob.updated_at = now;
      updated.push(existingJob);
    } else {
      const job: PrintJob = {
        id: jobId,
        source: "STATION",
        device_id: device.id,
        device_name: device.name,
        status,
        title,
        body,
        error: null,
        order_id: order.id,
        order_number: order.order_number,
        station_id: station.id,
        station_name: station.name,
        terminal_id: null,
        attempt_count: 0,
        last_attempt_at: null,
        created_at: now,
        updated_at: now
      };

      printJobs.push(job);
      created.push(job);
    }
  }

  for (let index = printJobs.length - 1; index >= 0; index -= 1) {
    const job = printJobs[index];
    const station = printerStations.find((entry) => entry.id === job.station_id);

    if (job.source === "STATION" && job.order_id === order.id && (!station || !groupedLines.has(station.name))) {
      printJobs.splice(index, 1);
    }
  }

  persistStationPrintJobs();
  if (created.length > 0 || updated.length > 0) {
    schedulePrintJobProcessing();
  }

  return { created, updated };
}

export function enqueueReceiptPrintJob(
  terminalId: string | undefined,
  order: PosOrderSnapshot,
  payment: CompletedMockPayment
) {
  const normalizedTerminalId = terminalId?.trim();

  if (!normalizedTerminalId) {
    return null;
  }

  const binding = posDeviceBindingForTerminal(normalizedTerminalId);

  if (!binding.receipt_printer_device_id) {
    return null;
  }

  const device = localDevices.get(binding.receipt_printer_device_id);

  if (!device || device.type !== "PRINTER") {
    return null;
  }

  const now = Date.now();
  const job: PrintJob = {
    id: printJobId("receipt", order.id, normalizedTerminalId),
    source: "RECEIPT",
    device_id: device.id,
    device_name: device.name,
    status: "PENDING",
    title: "Beleg angekommen",
    body: formatReceiptPrintBody(order, payment),
    error: null,
    order_id: order.id,
    order_number: order.order_number,
    station_id: null,
    station_name: null,
    terminal_id: normalizedTerminalId,
    attempt_count: 0,
    last_attempt_at: null,
    created_at: now,
    updated_at: now
  };

  return enqueuePrintJob(job);
}

export function enqueueZReportPrintJob(terminalId: string | undefined, dayClose: StoredDayClose) {
  const normalizedTerminalId = terminalId?.trim();

  if (!normalizedTerminalId) {
    return null;
  }

  const binding = posDeviceBindingForTerminal(normalizedTerminalId);

  if (!binding.z_report_printer_device_id) {
    return null;
  }

  const device = localDevices.get(binding.z_report_printer_device_id);

  if (!device || device.type !== "PRINTER") {
    return null;
  }

  const now = Date.now();
  const job: PrintJob = {
    id: printJobId("z_report", dayClose.business_date, normalizedTerminalId),
    source: "Z_REPORT",
    device_id: device.id,
    device_name: device.name,
    status: "PENDING",
    title: "Z-Bon angekommen",
    body: formatZReportPrintBody(dayClose),
    error: null,
    order_id: null,
    order_number: null,
    station_id: null,
    station_name: null,
    terminal_id: normalizedTerminalId,
    attempt_count: 0,
    last_attempt_at: null,
    created_at: now,
    updated_at: now
  };

  return enqueuePrintJob(job);
}

function stationDeviceBindingForStation(stationId: string): StationDeviceBinding {
  return stationDeviceBindings.get(stationId) ?? {
    station_id: stationId,
    kds_device_id: null,
    printer_device_id: null,
    updated_at: 0
  };
}

function posDeviceBindingForTerminal(terminalId: string): PosDeviceBinding {
  return posDeviceBindings.get(terminalId) ?? {
    terminal_id: terminalId,
    receipt_printer_device_id: null,
    z_report_printer_device_id: null,
    updated_at: 0
  };
}

function normalizeTerminalId(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error("Terminal id is required.");
  }

  return normalized;
}

function normalizeLocalDeviceInput(request: LocalDeviceCreateRequest): Required<LocalDeviceCreateRequest> {
  const name = request.name?.trim();

  if (!name) {
    throw new Error("Local device name is required.");
  }

  return {
    name,
    type: normalizeLocalDeviceType(request.type),
    provider: normalizeLocalDeviceProvider(request.provider),
    address_or_device_id: normalizeOptionalText(request.address_or_device_id, null)
  };
}

function normalizeLocalDeviceType(value: string): LocalDeviceType {
  if (value === "PRINTER" || value === "KDS_DISPLAY") {
    return value;
  }

  throw new Error("Local device type is invalid.");
}

function normalizeLocalDeviceProvider(value: string): LocalDeviceProvider {
  if (value === "manual" || value === "windows" || value === "escpos" || value === "browser" || value === "simulator") {
    return value;
  }

  throw new Error("Local device provider is invalid.");
}

function createPrintLog(device: LocalDevice, source: PrintLogSource, title: string, body: string) {
  const now = Date.now();
  const log: PrintLog = {
    id: scopedId("print", now, printLogs.length),
    device_id: device.id,
    device_name: device.name,
    source,
    title,
    body,
    created_at: now
  };

  printLogs.push(log);
  persistPrintLogs();
  broadcast("PRINT_LOG_CREATED", log);

  return log;
}

function enqueuePrintJob(job: PrintJob) {
  const existingJob = printJobs.find((entry) => entry.id === job.id);

  if (existingJob) {
    Object.assign(existingJob, {
      ...job,
      created_at: existingJob.created_at,
      attempt_count: existingJob.status === "FAILED" ? existingJob.attempt_count : job.attempt_count,
      last_attempt_at: existingJob.status === "FAILED" ? existingJob.last_attempt_at : job.last_attempt_at
    });
    persistStationPrintJobs();
    broadcast("PRINT_JOB_UPDATED", { job: existingJob });
    schedulePrintJobProcessing();
    return existingJob;
  }

  printJobs.push(job);
  persistStationPrintJobs();
  broadcast("PRINT_JOB_CREATED", { job });
  schedulePrintJobProcessing();

  return job;
}

let isProcessingPrintJobs = false;

function schedulePrintJobProcessing() {
  setTimeout(() => {
    void processPendingPrintJobs();
  }, 0);
}

async function processPendingPrintJobs() {
  if (isProcessingPrintJobs) {
    return;
  }

  isProcessingPrintJobs = true;

  try {
    for (const job of printJobs) {
      if (job.status !== "PENDING") {
        continue;
      }

      await processPrintJob(job);
    }
  } finally {
    isProcessingPrintJobs = false;
  }
}

async function processPrintJob(job: PrintJob) {
  const device = localDevices.get(job.device_id);
  const now = Date.now();

  job.status = "PRINTING";
  job.error = null;
  job.attempt_count = (job.attempt_count ?? 0) + 1;
  job.last_attempt_at = now;
  job.updated_at = now;
  persistStationPrintJobs();
  broadcast("PRINT_JOB_UPDATED", { job });

  try {
    if (!device || device.type !== "PRINTER") {
      throw new Error("Printer device is not available.");
    }

    if (device.provider === "browser") {
      throw new Error("Browser printer jobs are not supported by LocalMaster.");
    }

    if (device.provider === "simulator") {
      createPrintLog(device, job.source, job.title, stripEscPosControlCodes(job.body));
      job.status = "SIMULATED";
    } else {
      await sendEscPosPrintJob(device, job);
      job.status = "PRINTED";
    }

    job.error = null;
  } catch (error) {
    job.status = "FAILED";
    job.error = error instanceof Error ? error.message : String(error);
  } finally {
    job.updated_at = Date.now();
    persistStationPrintJobs();
    broadcast("PRINT_JOB_UPDATED", { job });
  }
}

function requireLocalDeviceType(deviceId: string, type: LocalDeviceType) {
  const device = localDevices.get(deviceId);

  if (!device) {
    throw new Error("Local device not found.");
  }

  if (device.type !== type) {
    throw new Error("Local device type does not match the station capability.");
  }
}

async function sendEscPosTestPrint(device: LocalDevice) {
  const target = parsePrinterTarget(device);
  const payload = Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from("EasyTable Testdruck\n", "utf8"),
    Buffer.from("-------------------\n", "utf8"),
    Buffer.from("Geraet: " + device.name + "\n", "utf8"),
    Buffer.from("Zeit: " + new Date().toLocaleString("de-CH") + "\n\n\n", "utf8"),
    Buffer.from([0x1d, 0x56, 0x42, 0x00])
  ]);

  await writeTcpPayload(target.host, target.port, payload);
}

async function sendEscPosPrintJob(device: LocalDevice, job: PrintJob) {
  const target = parsePrinterTarget(device);
  const payload = Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from(job.body + "\n\n\n", "utf8"),
    Buffer.from([0x1d, 0x56, 0x42, 0x00])
  ]);

  await writeTcpPayload(target.host, target.port, payload);
}

function parsePrinterTarget(device: LocalDevice) {
  const rawAddress = device.address_or_device_id?.trim();

  if (!rawAddress) {
    throw new Error("Printer address is required. Use an IP like 192.168.178.50 or tcp://192.168.178.50:9100.");
  }

  if (device.provider === "browser") {
    throw new Error("Browser printer tests are not supported by LocalMaster.");
  }

  let address = rawAddress;

  if (address.startsWith("tcp://")) {
    address = address.slice("tcp://".length);
  }

  if (address.startsWith("http://") || address.startsWith("https://")) {
    const parsed = new URL(address);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 9100
    };
  }

  const [host, portText] = address.split(":");
  const port = portText ? Number(portText) : 9100;

  if (!host?.trim()) {
    throw new Error("Printer host is required.");
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Printer port is invalid.");
  }

  return { host: host.trim(), port };
}

function writeTcpPayload(host: string, port: number, payload: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Printer connection timed out.")), 4_000);

    function finish(error?: Error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.once("error", (error) => finish(error));
    socket.connect(port, host, () => {
      socket.write(payload, (error) => {
        if (error) {
          finish(error);
          return;
        }

        socket.end(() => finish());
      });
    });
  });
}
