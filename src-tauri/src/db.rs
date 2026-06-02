use rusqlite::{Connection, params};
use std::path::PathBuf;

use crate::{TradeRecord, OpenPositionRecord, AppStateRecord};

pub struct Database {
    conn: Connection,
    path: PathBuf,
}

impl Database {
    pub fn open() -> Result<Self, Box<dyn std::error::Error>> {
        let mut path = dirs_data_dir();
        std::fs::create_dir_all(&path)?;
        path.push("cryptobud_v4.db");

        let conn = Connection::open(&path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON")?;
        let db = Database { conn, path };
        db.init()?;
        db.migrate()?;
        Ok(db)
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    fn init(&self) -> Result<(), Box<dyn std::error::Error>> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id TEXT NOT NULL DEFAULT '',
                coin TEXT NOT NULL,
                mode TEXT NOT NULL,
                side TEXT NOT NULL,
                adapter TEXT NOT NULL DEFAULT 'unknown',
                entry_price REAL NOT NULL,
                exit_price REAL,
                quantity REAL NOT NULL,
                pnl REAL,
                pnl_percent REAL,
                pnl_usd REAL,
                entry_time TEXT NOT NULL,
                exit_time TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                ml_confidence REAL,
                prediction TEXT,
                strategy TEXT NOT NULL DEFAULT 'default',
                buy_snapshot_json TEXT,
                close_snapshot_json TEXT,
                ml_label_json TEXT,
                ml_quality_json TEXT,
                training_eligible INTEGER,
                data_quality TEXT,
                ml_use TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS ml_predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                coin TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                prediction TEXT NOT NULL,
                confidence REAL NOT NULL,
                features TEXT,
                actual_outcome TEXT,
                actual_pnl REAL,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS schema_meta (
                version INTEGER PRIMARY KEY
            );

            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            );"
        )?;

        // ── schema_meta: deduplicate & init ──
        // Old broken migrations (execute_batch .ok()) could leave duplicate rows:
        //   INSERT OR IGNORE version=0 (init) + UPDATE version=1 (broken migrate)
        // This causes UNIQUE constraint failure when UPDATE targets both rows.
        // Fix: remove all rows except the lowest version.
        self.conn.execute(
            "DELETE FROM schema_meta WHERE version > COALESCE((SELECT MIN(version) FROM schema_meta), -1)",
            [],
        )?;

        // Ensure exactly one row with version 0 (fresh DB) or keep existing version
        let has_row: bool = self.conn
            .query_row("SELECT 1 FROM schema_meta LIMIT 1", [], |_| Ok(true))
            .unwrap_or(false);
        if !has_row {
            self.conn.execute("INSERT INTO schema_meta (version) VALUES (0)", [])?;
        }
        Ok(())
    }

    fn existing_columns(&self, table: &str) -> Result<Vec<String>, Box<dyn std::error::Error>> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({})", table))?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut cols = Vec::new();
        for row in rows {
            cols.push(row?);
        }
        Ok(cols)
    }

    fn ensure_column(
        &self,
        table: &str,
        column: &str,
        sql_type: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let existing = self.existing_columns(table)?;
        if !existing.iter().any(|c| c == column) {
            println!("DB_MIGRATION_ADD_COLUMN table={} column={} type={}", table, column, sql_type);
            let sql = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, sql_type);
            self.conn.execute_batch(&sql)?;
        }
        Ok(())
    }

    fn migrate(&self) -> Result<(), Box<dyn std::error::Error>> {
        let current: i64 = self.conn
            .query_row("SELECT version FROM schema_meta", [], |row| row.get(0))
            .unwrap_or(0);

        println!("DB_MIGRATION_START current_version={}", current);

        self.conn.execute_batch("BEGIN TRANSACTION")?;

        // ── Phase 1: ensure trades columns (runs unconditionally, idempotent) ──
        // Old broken migrations may have set version=1 without actually adding columns.
        // This pass always checks PRAGMA table_info and adds missing ones.
        self.ensure_column("trades", "adapter", "TEXT NOT NULL DEFAULT 'unknown'")?;
        self.ensure_column("trades", "buy_snapshot_json", "TEXT")?;
        self.ensure_column("trades", "close_snapshot_json", "TEXT")?;
        self.ensure_column("trades", "ml_label_json", "TEXT")?;
        self.ensure_column("trades", "ml_quality_json", "TEXT")?;
        self.ensure_column("trades", "training_eligible", "INTEGER")?;
        self.ensure_column("trades", "data_quality", "TEXT")?;
        self.ensure_column("trades", "ml_use", "TEXT")?;
        self.ensure_column("trades", "pnl_usd", "REAL")?;
        self.ensure_column("trades", "updated_at", "TEXT DEFAULT (datetime('now'))")?;

        // ── Phase 2: version-gated structural migrations ──
        if current < 1 {
            self.conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS open_positions (
                    trade_id TEXT PRIMARY KEY,
                    symbol TEXT NOT NULL,
                    position_json TEXT NOT NULL,
                    buy_snapshot_json TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                );"
            )?;
            self.conn.execute("UPDATE schema_meta SET version = 1", [])?;
            println!("DB_MIGRATION_COMPLETE version=1");
        } else {
            println!("DB_MIGRATION_SKIP version=1 reason=already_applied");
        }

        if current < 2 {
            let has_old_app_state = self.existing_columns("app_state")
                .map(|cols| cols.contains(&"value".to_string()))
                .unwrap_or(false);
            if has_old_app_state {
                self.conn.execute_batch(
                    "CREATE TABLE IF NOT EXISTS app_state_new (
                        key TEXT PRIMARY KEY,
                        value_json TEXT NOT NULL,
                        updated_at TEXT DEFAULT (datetime('now'))
                    );
                    INSERT OR IGNORE INTO app_state_new (key, value_json, updated_at)
                    SELECT key, value, datetime('now') FROM app_state;
                    DROP TABLE app_state;
                    ALTER TABLE app_state_new RENAME TO app_state;"
                )?;
            }
            self.conn.execute("UPDATE schema_meta SET version = 2", [])?;
            println!("DB_MIGRATION_COMPLETE version=2");
        } else {
            println!("DB_MIGRATION_SKIP version=2 reason=already_applied");
        }

        self.conn.execute_batch("COMMIT")?;

        let final_version: i64 = self.conn
            .query_row("SELECT version FROM schema_meta", [], |row| row.get(0))
            .unwrap_or(-1);
        println!("DB_MIGRATION_DONE final_version={}", final_version);
        Ok(())
    }

    // ── Trades ─────────────────────────────────────────

    pub fn insert_trade(&self, trade: &TradeRecord) -> Result<i64, rusqlite::Error> {
        self.conn.execute(
            "INSERT INTO trades (trade_id, coin, mode, side, adapter, entry_price, exit_price, quantity, pnl, pnl_percent, pnl_usd, entry_time, exit_time, status, ml_confidence, prediction, strategy, buy_snapshot_json, close_snapshot_json, ml_label_json, ml_quality_json, training_eligible, data_quality, ml_use)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
            params![
                trade.trade_id, trade.coin, trade.mode, trade.side, trade.adapter,
                trade.entry_price, trade.exit_price,
                trade.quantity, trade.pnl, trade.pnl_percent, trade.pnl_usd,
                trade.entry_time, trade.exit_time,
                trade.status, trade.ml_confidence, trade.prediction, trade.strategy,
                trade.buy_snapshot_json, trade.close_snapshot_json,
                trade.ml_label_json, trade.ml_quality_json,
                trade.training_eligible, trade.data_quality, trade.ml_use
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_trades(&self, coin: Option<&str>) -> Result<Vec<TradeRecord>, rusqlite::Error> {
        let sql = match coin {
            Some(_) => "SELECT id, trade_id, coin, mode, side, adapter, entry_price, exit_price, quantity, pnl, pnl_percent, pnl_usd, entry_time, exit_time, status, ml_confidence, prediction, strategy, buy_snapshot_json, close_snapshot_json, ml_label_json, ml_quality_json, training_eligible, data_quality, ml_use FROM trades WHERE coin = ?1 ORDER BY entry_time DESC",
            None => "SELECT id, trade_id, coin, mode, side, adapter, entry_price, exit_price, quantity, pnl, pnl_percent, pnl_usd, entry_time, exit_time, status, ml_confidence, prediction, strategy, buy_snapshot_json, close_snapshot_json, ml_label_json, ml_quality_json, training_eligible, data_quality, ml_use FROM trades ORDER BY entry_time DESC",
        };

        let mut stmt = self.conn.prepare(sql)?;
        let rows = if let Some(c) = coin {
            stmt.query_map(params![c], row_to_trade)?
        } else {
            stmt.query_map([], row_to_trade)?
        };

        let mut trades = Vec::new();
        for row in rows {
            trades.push(row?);
        }
        Ok(trades)
    }

    pub fn get_trade_count(&self) -> Result<i64, rusqlite::Error> {
        self.conn.query_row("SELECT COUNT(*) FROM trades", [], |row| row.get(0))
    }

    pub fn update_trade(&self, trade: &TradeRecord) -> Result<(), rusqlite::Error> {
        self.conn.execute(
            "UPDATE trades SET exit_price = ?1, pnl = ?2, pnl_percent = ?3, pnl_usd = ?4, exit_time = ?5, status = ?6, close_snapshot_json = ?7, ml_label_json = ?8, ml_quality_json = ?9, training_eligible = ?10, data_quality = ?11, ml_use = ?12, updated_at = datetime('now') WHERE trade_id = ?13",
            params![trade.exit_price, trade.pnl, trade.pnl_percent, trade.pnl_usd, trade.exit_time, trade.status, trade.close_snapshot_json, trade.ml_label_json, trade.ml_quality_json, trade.training_eligible, trade.data_quality, trade.ml_use, trade.trade_id],
        )?;
        Ok(())
    }

    pub fn clear_trades(&self) -> Result<(), rusqlite::Error> {
        self.conn.execute("DELETE FROM trades", [])?;
        Ok(())
    }

    // ── Open Positions ─────────────────────────────────

    pub fn insert_open_position(&self, pos: &OpenPositionRecord) -> Result<(), rusqlite::Error> {
        self.conn.execute(
            "INSERT OR REPLACE INTO open_positions (trade_id, symbol, position_json, buy_snapshot_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))",
            params![pos.trade_id, pos.symbol, pos.position_json, pos.buy_snapshot_json],
        )?;
        Ok(())
    }

    pub fn get_open_positions(&self) -> Result<Vec<OpenPositionRecord>, rusqlite::Error> {
        let mut stmt = self.conn.prepare(
            "SELECT trade_id, symbol, position_json, buy_snapshot_json, created_at, updated_at FROM open_positions"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(OpenPositionRecord {
                trade_id: row.get(0)?,
                symbol: row.get(1)?,
                position_json: row.get(2)?,
                buy_snapshot_json: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        let mut positions = Vec::new();
        for row in rows {
            positions.push(row?);
        }
        Ok(positions)
    }

    pub fn get_open_position_count(&self) -> Result<i64, rusqlite::Error> {
        self.conn.query_row("SELECT COUNT(*) FROM open_positions", [], |row| row.get(0))
    }

    pub fn delete_open_position(&self, trade_id: &str) -> Result<(), rusqlite::Error> {
        self.conn.execute("DELETE FROM open_positions WHERE trade_id = ?1", params![trade_id])?;
        Ok(())
    }

    pub fn clear_open_positions(&self) -> Result<(), rusqlite::Error> {
        self.conn.execute("DELETE FROM open_positions", [])?;
        Ok(())
    }

    // ── App State ──────────────────────────────────────

    pub fn save_app_state(&self, key: &str, value_json: &str) -> Result<(), rusqlite::Error> {
        self.conn.execute(
            "INSERT OR REPLACE INTO app_state (key, value_json, updated_at) VALUES (?1, ?2, datetime('now'))",
            params![key, value_json],
        )?;
        Ok(())
    }

    pub fn get_app_state(&self, key: &str) -> Result<Option<String>, rusqlite::Error> {
        let result = self.conn.query_row(
            "SELECT value_json FROM app_state WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn get_all_app_state(&self) -> Result<Vec<AppStateRecord>, rusqlite::Error> {
        let mut stmt = self.conn.prepare(
            "SELECT key, value_json, updated_at FROM app_state"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AppStateRecord {
                key: row.get(0)?,
                value_json: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;
        let mut records = Vec::new();
        for row in rows {
            records.push(row?);
        }
        Ok(records)
    }

    pub fn clear_app_state_prefix(&self, prefix: &str) -> Result<usize, rusqlite::Error> {
        self.conn.execute("DELETE FROM app_state WHERE key LIKE ?1", params![format!("{prefix}%")])
    }
    pub fn get_schema_info(&self) -> Result<String, Box<dyn std::error::Error>> {
        let version: i64 = self.conn
            .query_row("SELECT version FROM schema_meta", [], |row| row.get(0))
            .unwrap_or(-1);
        let trades_cols = self.existing_columns("trades")?;
        let expected = [
            "id", "trade_id", "coin", "mode", "side", "adapter",
            "entry_price", "exit_price", "quantity", "pnl", "pnl_percent",
            "pnl_usd", "entry_time", "exit_time", "status", "ml_confidence",
            "prediction", "strategy", "buy_snapshot_json", "close_snapshot_json",
            "ml_label_json", "ml_quality_json", "training_eligible", "data_quality",
            "ml_use", "created_at", "updated_at",
        ];
        let missing: Vec<&str> = expected.iter()
            .filter(|c| !trades_cols.iter().any(|x| x == *c))
            .copied()
            .collect();
        let info = serde_json::json!({
            "dbPath": self.path.to_string_lossy(),
            "schemaVersion": version,
            "tradesColumns": trades_cols,
            "missingColumns": missing,
        });
        Ok(info.to_string())
    }
}

fn row_to_trade(row: &rusqlite::Row) -> rusqlite::Result<TradeRecord> {
    Ok(TradeRecord {
        id: row.get(0)?,
        trade_id: row.get(1)?,
        coin: row.get(2)?,
        mode: row.get(3)?,
        side: row.get(4)?,
        adapter: row.get(5)?,
        entry_price: row.get(6)?,
        exit_price: row.get(7)?,
        quantity: row.get(8)?,
        pnl: row.get(9)?,
        pnl_percent: row.get(10)?,
        pnl_usd: row.get(11)?,
        entry_time: row.get(12)?,
        exit_time: row.get(13)?,
        status: row.get(14)?,
        ml_confidence: row.get(15)?,
        prediction: row.get(16)?,
        strategy: row.get(17)?,
        buy_snapshot_json: row.get(18)?,
        close_snapshot_json: row.get(19)?,
        ml_label_json: row.get(20)?,
        ml_quality_json: row.get(21)?,
        training_eligible: row.get(22)?,
        data_quality: row.get(23)?,
        ml_use: row.get(24)?,
    })
}

fn dirs_data_dir() -> PathBuf {
    let base = if let Ok(exe) = std::env::current_exe() {
        exe.parent().unwrap_or(&exe).to_path_buf()
    } else {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        cwd.join("..").join("..").join("target")
    };
    base.join("cryptobud_data")
}
