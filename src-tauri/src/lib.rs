use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

mod db;

pub struct AppState {
    pub db: Mutex<db::Database>,
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
    db.insert_open_position(&position).map_err(|e| e.to_string())
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

#[tauri::command]
fn delete_open_position(state: State<AppState>, trade_id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_open_position(&trade_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_open_positions(state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_open_positions().map_err(|e| e.to_string())
}

// ── App State commands ──────────────────────────────

#[tauri::command]
fn save_app_state_entry(state: State<AppState>, key: String, value_json: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_app_state(&key, &value_json).map_err(|e| e.to_string())
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
    db.clear_app_state_prefix(&prefix).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_db_schema_info(state: State<AppState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_schema_info().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_trade_insight(state: State<AppState>, insight: TradeInsightRecord) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let key = format!("diagnostic_trade_insight_{}_{}", insight.symbol, insight.event_ts);
    let value_json = serde_json::to_string(&insight).map_err(|e| e.to_string())?;
    db.save_app_state(&key, &value_json).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = db::Database::open().expect("Failed to open database");

    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(db),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
