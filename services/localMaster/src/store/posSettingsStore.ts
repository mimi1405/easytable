import { location, tenant } from "./storeSeeds.js";
import type { PosSettingsFile } from "../types.js";

const posSettings: PosSettingsFile = {
  path: "local-master://settings/pos-settings.json",
  settings: {
    schema_version: 1,
    tenant_id: tenant.id,
    location_id: location.id,
    service_mode: "TABLE_SERVICE",
    language: "de-CH",
    business_day_cutover_time: "00:00",
    receipt_printer: {
      enabled: false,
      provider: "none",
      device_id: null
    },
    payment_terminal: {
      enabled: false,
      provider: "none",
      device_id: null
    }
  }
};

export function loadPosSettings(): PosSettingsFile {
  return {
    path: posSettings.path,
    settings: {
      ...posSettings.settings,
      receipt_printer: { ...posSettings.settings.receipt_printer },
      payment_terminal: { ...posSettings.settings.payment_terminal }
    }
  };
}
