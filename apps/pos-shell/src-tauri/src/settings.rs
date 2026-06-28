use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Deserialize, Serialize)]
pub(crate) struct PosSettings {
    schema_version: u16,
    tenant_id: String,
    location_id: String,
    language: String,
    #[serde(default = "default_business_day_cutover_time")]
    business_day_cutover_time: String,
    receipt_printer: PeripheralSettings,
    payment_terminal: PeripheralSettings,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct PeripheralSettings {
    enabled: bool,
    provider: String,
    device_id: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct PosSettingsFile {
    path: String,
    settings: PosSettings,
}

fn default_pos_settings() -> PosSettings {
    PosSettings {
        schema_version: 1,
        tenant_id: "tenant_basilica".to_string(),
        location_id: "loc_basilica_main".to_string(),
        language: "de-CH".to_string(),
        business_day_cutover_time: default_business_day_cutover_time(),
        receipt_printer: PeripheralSettings {
            enabled: false,
            provider: "none".to_string(),
            device_id: None,
        },
        // Future: store Wallee terminal configuration here, for example provider = "wallee"
        // plus the terminal/device id this POS shell should use for card payments.
        payment_terminal: PeripheralSettings {
            enabled: false,
            provider: "none".to_string(),
            device_id: None,
        },
    }
}

fn default_business_day_cutover_time() -> String {
    "00:00".to_string()
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;

    Ok(data_dir.join("pos-settings.json"))
}

pub(crate) fn ensure_pos_settings(app: &AppHandle) -> Result<PosSettingsFile, String> {
    let path = settings_path(app)?;

    if !path.exists() {
        let default_settings = default_pos_settings();
        let json = serde_json::to_string_pretty(&default_settings)
            .map_err(|error| format!("Could not serialize POS settings: {error}"))?;

        fs::write(&path, json)
            .map_err(|error| format!("Could not write POS settings file: {error}"))?;

        return Ok(PosSettingsFile {
            path: path.display().to_string(),
            settings: default_settings,
        });
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read POS settings file: {error}"))?;
    let settings = serde_json::from_str::<PosSettings>(&content)
        .map_err(|error| format!("Could not parse POS settings file: {error}"))?;

    Ok(PosSettingsFile {
        path: path.display().to_string(),
        settings,
    })
}

#[tauri::command]
pub(crate) fn load_pos_settings(app: AppHandle) -> Result<PosSettingsFile, String> {
    ensure_pos_settings(&app)
}
