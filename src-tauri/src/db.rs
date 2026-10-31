//! Thin, synchronous SQLite bridge for the web layer.
//!
//! The schema and its migrations live in TypeScript (`src/persistence/migrations.ts`)
//! so the same SQL runs here and in the browser preview / test driver. This module
//! only owns the connection, parameter binding and transactional batches.

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let conn = Connection::open(&path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )?;
        Ok(Self { conn: Mutex::new(conn), path })
    }
}

#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

#[derive(Serialize)]
pub struct ExecResult {
    rows_affected: usize,
    last_insert_id: i64,
}

#[derive(Serialize)]
pub struct DbInfo {
    path: String,
    sqlite_version: String,
}

fn to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::Number((*x).into())).collect()),
    }
}

fn exec(conn: &Connection, sql: &str, params: &[Value]) -> Result<ExecResult, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows_affected = stmt
        .execute(params_from_iter(params.iter().map(to_sql)))
        .map_err(|e| e.to_string())?;
    Ok(ExecResult { rows_affected, last_insert_id: conn.last_insert_rowid() })
}

#[tauri::command]
pub fn db_execute(
    db: tauri::State<'_, Database>,
    sql: String,
    params: Vec<Value>,
) -> Result<ExecResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    exec(&conn, &sql, &params)
}

#[tauri::command]
pub fn db_select(
    db: tauri::State<'_, Database>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().map(|s| s.to_string()).collect();
    let mut rows = stmt
        .query(params_from_iter(params.iter().map(to_sql)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), from_sql(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        out.push(obj);
    }
    Ok(out)
}

/// Runs every statement inside one transaction; any failure rolls the whole batch back.
#[tauri::command]
pub fn db_batch(
    db: tauri::State<'_, Database>,
    statements: Vec<Statement>,
) -> Result<usize, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut total = 0;
    for s in &statements {
        total += exec(&tx, &s.sql, &s.params)?.rows_affected;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(total)
}

#[tauri::command]
pub fn db_info(db: tauri::State<'_, Database>) -> DbInfo {
    DbInfo {
        path: db.path.to_string_lossy().into_owned(),
        sqlite_version: rusqlite::version().to_string(),
    }
}
