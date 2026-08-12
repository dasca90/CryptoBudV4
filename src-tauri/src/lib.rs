use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::sync::Mutex;
use tauri::State;
use zeroize::Zeroize;

mod db;

pub struct AppState {
    pub db: Mutex<db::Database>,
    pub credential_lock: Mutex<()>,
}

const BINANCE_CREDENTIAL_SERVICE: &str = "com.cryptobud.v6.binance";
const BINANCE_CREDENTIAL_ACCOUNT: &str = "spot-live";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinanceCredentialPayload {
    api_key: String,
    api_secret: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeCredentialStatus {
    configured: bool,
    storage_secure: bool,
    provider: &'static str,
    platform: &'static str,
    masked_api_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSignature {
    api_key: String,
    signature: String,
}

fn secure_store_error(operation: &str) -> String {
    match operation {
        "write" => "SECURE_STORE_WRITE_FAILED",
        "read" => "SECURE_STORE_READ_FAILED",
        "delete" => "SECURE_STORE_DELETE_FAILED",
        _ => "SECURE_STORE_UNAVAILABLE",
    }
    .to_string()
}

fn credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(BINANCE_CREDENTIAL_SERVICE, BINANCE_CREDENTIAL_ACCOUNT)
        .map_err(|_| secure_store_error("unavailable"))
}

fn read_secure_credentials() -> Result<Option<BinanceCredentialPayload>, String> {
    let entry = credential_entry()?;
    match entry.get_password() {
        Ok(mut value) => {
            let parsed = serde_json::from_str::<BinanceCredentialPayload>(&value)
                .map(Some)
                .map_err(|_| secure_store_error("read"));
            value.zeroize();
            parsed
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(secure_store_error("read")),
    }
}

fn mask_api_key(value: &str) -> String {
    let suffix: String = value
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!("****{}", suffix)
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unsupported"
    }
}

#[tauri::command]
fn save_binance_credentials(
    state: State<AppState>,
    api_key: String,
    api_secret: String,
) -> Result<NativeCredentialStatus, String> {
    if api_key.trim().is_empty() || api_secret.trim().is_empty() {
        return Err("CREDENTIALS_NOT_CONFIGURED".to_string());
    }
    let _guard = state
        .credential_lock
        .lock()
        .map_err(|_| secure_store_error("unavailable"))?;
    let mut payload = BinanceCredentialPayload {
        api_key: api_key.trim().to_string(),
        api_secret,
    };
    let mut serialized =
        serde_json::to_string(&payload).map_err(|_| secure_store_error("write"))?;
    let entry = credential_entry()?;
    let write_result = entry
        .set_password(&serialized)
        .map_err(|_| secure_store_error("write"));
    serialized.zeroize();
    write_result?;
    let mut verified = read_secure_credentials()?.ok_or_else(|| secure_store_error("write"))?;
    if verified.api_key != payload.api_key || verified.api_secret != payload.api_secret {
        let _ = entry.delete_credential();
        verified.api_secret.zeroize();
        payload.api_secret.zeroize();
        return Err(secure_store_error("write"));
    }
    verified.api_secret.zeroize();
    payload.api_secret.zeroize();
    Ok(NativeCredentialStatus {
        configured: true,
        storage_secure: true,
        provider: "os_keyring",
        platform: platform_name(),
        masked_api_key: Some(mask_api_key(&payload.api_key)),
    })
}

#[tauri::command]
fn get_binance_credential_status(state: State<AppState>) -> Result<NativeCredentialStatus, String> {
    let _guard = state
        .credential_lock
        .lock()
        .map_err(|_| secure_store_error("unavailable"))?;
    let credentials = read_secure_credentials()?;
    Ok(NativeCredentialStatus {
        configured: credentials.is_some(),
        storage_secure: true,
        provider: "os_keyring",
        platform: platform_name(),
        masked_api_key: credentials
            .as_ref()
            .map(|value| mask_api_key(&value.api_key)),
    })
}

#[tauri::command]
fn delete_binance_credentials(state: State<AppState>) -> Result<(), String> {
    let _guard = state
        .credential_lock
        .lock()
        .map_err(|_| secure_store_error("unavailable"))?;
    let entry = credential_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(secure_store_error("delete")),
    }
}

#[tauri::command]
fn sign_binance_payload(
    state: State<AppState>,
    payload: String,
    include_api_key: Option<bool>,
) -> Result<NativeSignature, String> {
    let _guard = state
        .credential_lock
        .lock()
        .map_err(|_| secure_store_error("unavailable"))?;
    let mut credentials =
        read_secure_credentials()?.ok_or_else(|| "CREDENTIALS_NOT_CONFIGURED".to_string())?;
    let mac_result = Hmac::<Sha256>::new_from_slice(credentials.api_secret.as_bytes())
        .map_err(|_| "SECURE_SIGNING_FAILED".to_string());
    credentials.api_secret.zeroize();
    let mut mac = mac_result?;
    let signing_payload = if include_api_key.unwrap_or(false) {
        format!("apiKey={}&{}", credentials.api_key, payload)
    } else {
        payload
    };
    mac.update(signing_payload.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());
    Ok(NativeSignature {
        api_key: credentials.api_key,
        signature,
    })
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TradeRecord {
    pub id: Option<i64>,
    pub trade_id: String,
    pub coin: String,
    pub mode: String,
    pub side: String,
    pub adapter: String,
    pub entry_price: f64,
    pub exit_price: Option<f64>,
    pub quantity: f64,
    pub pnl: Option<f64>,
    pub pnl_percent: Option<f64>,
    pub pnl_usd: Option<f64>,
    pub entry_time: String,
    pub exit_time: Option<String>,
    pub status: String,
    pub ml_confidence: Option<f64>,
    pub prediction: Option<String>,
    pub strategy: String,
    pub buy_snapshot_json: Option<String>,
    pub close_snapshot_json: Option<String>,
    pub ml_label_json: Option<String>,
    pub ml_quality_json: Option<String>,
    pub training_eligible: Option<i64>,
    pub data_quality: Option<String>,
    pub ml_use: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OpenPositionRecord {
    pub trade_id: String,
    pub symbol: String,
    pub position_json: String,
    pub buy_snapshot_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppStateRecord {
    pub key: String,
    pub value_json: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TradeInsightRecord {
    pub symbol: String,
    pub event_ts: i64,
    pub confidence_bps: i64,
    pub score: f64,
    pub diagnostic_test: bool,
}

// ── Trade commands ──────────────────────────────────

#[tauri::command]
fn save_trade(state: State<AppState>, trade: TradeRecord) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.insert_trade(&trade).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_trades(state: State<AppState>, coin: Option<String>) -> Result<Vec<TradeRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_trades(coin.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_trade_count(state: State<AppState>) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_trade_count().map_err(|e| e.to_string())
}

#[tauri::command]
fn update_trade(state: State<AppState>, trade: TradeRecord) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_trade(&trade).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_trades(state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_trades().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_db_path(state: State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db.path().to_string_lossy().to_string())
}

// ── Open Position commands ──────────────────────────

#[tauri::command]
fn save_open_position(state: State<AppState>, position: OpenPositionRecord) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.insert_open_position(&position)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_open_positions(state: State<AppState>) -> Result<Vec<OpenPositionRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_open_positions().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_open_position_count(state: State<AppState>) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_open_position_count().map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
fn delete_open_position(state: State<AppState>, trade_id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_open_position(&trade_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_open_positions(state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_open_positions().map_err(|e| e.to_string())
}

// ── App State commands ──────────────────────────────

#[tauri::command]
fn save_app_state_entry(
    state: State<AppState>,
    key: String,
    value_json: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_app_state(&key, &value_json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_state_entry(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_app_state(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_all_app_state(state: State<AppState>) -> Result<Vec<AppStateRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_app_state().map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_app_state_prefix(state: State<AppState>, prefix: String) -> Result<usize, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_app_state_prefix(&prefix)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_db_schema_info(state: State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_schema_info().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_trade_insight(state: State<AppState>, insight: TradeInsightRecord) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let key = format!(
        "diagnostic_trade_insight_{}_{}",
        insight.symbol, insight.event_ts
    );
    let value_json = serde_json::to_string(&insight).map_err(|e| e.to_string())?;
    db.save_app_state(&key, &value_json)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = db::Database::open().expect("Failed to open database");

    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(db),
            credential_lock: Mutex::new(()),
        })
        .invoke_handler(tauri::generate_handler![
            save_trade,
            get_trades,
            get_trade_count,
            update_trade,
            clear_trades,
            get_db_path,
            get_db_schema_info,
            save_open_position,
            get_open_positions,
            get_open_position_count,
            delete_open_position,
            clear_open_positions,
            save_app_state_entry,
            get_app_state_entry,
            get_all_app_state,
            clear_app_state_prefix,
            save_trade_insight,
            save_binance_credentials,
            get_binance_credential_status,
            delete_binance_credentials,
            sign_binance_payload,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
