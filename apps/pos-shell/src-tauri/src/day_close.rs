use chrono::{Duration, Local, LocalResult, NaiveDate, NaiveTime, TimeZone, Timelike};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;
use crate::util::current_timestamp_ms;

#[derive(Deserialize)]
pub(crate) struct DayClosePreviewRequest {
    business_date: String,
    business_day_cutover_time: String,
}

#[derive(Serialize)]
pub(crate) struct DayClosePreview {
    business_date: String,
    business_day_cutover_time: String,
    window_start_ms: i64,
    window_end_ms: i64,
    expected_cash: i64,
    expected_card: i64,
    expected_total: i64,
    order_count: i64,
    item_count: i64,
    product_sales: Vec<DayCloseProductSale>,
    existing_close: Option<ExistingDayClose>,
}

#[derive(Serialize)]
pub(crate) struct DayCloseProductSale {
    product_id: String,
    product_name: String,
    product_category: String,
    quantity: i64,
    total: i64,
}

#[derive(Serialize)]
pub(crate) struct ExistingDayClose {
    counted_cash: i64,
    cash_difference: i64,
    created_at: i64,
}

#[derive(Deserialize)]
pub(crate) struct SaveDayCloseRequest {
    business_date: String,
    business_day_cutover_time: String,
    counted_cash: i64,
}

#[derive(Serialize)]
pub(crate) struct SavedDayClose {
    business_date: String,
    total_cash: i64,
    total_card: i64,
    counted_cash: i64,
    cash_difference: i64,
    order_count: i64,
    item_count: i64,
    created_at: i64,
}

#[derive(Deserialize)]
pub(crate) struct CurrentBusinessDateRequest {
    business_day_cutover_time: String,
}

#[derive(Serialize)]
pub(crate) struct CurrentBusinessDate {
    business_date: String,
}

struct DayCloseWindow {
    business_date: String,
    business_day_cutover_time: String,
    start_ms: i64,
    end_ms: i64,
}

struct DayCloseTotals {
    expected_cash: i64,
    expected_card: i64,
    order_count: i64,
    item_count: i64,
}

#[tauri::command]
pub(crate) fn get_day_close_preview(
    state: State<DbState>,
    request: DayClosePreviewRequest,
) -> Result<DayClosePreview, String> {
    let connection = state.0.lock().map_err(|_| "Database lock poisoned".to_string())?;
    let window = business_day_window(&request.business_date, &request.business_day_cutover_time)?;
    let totals = query_day_close_totals(&connection, &window)?;
    let product_sales = query_day_close_product_sales(&connection, &window)?;
    let existing_close = query_existing_day_close(&connection, &window.business_date)?;

    Ok(DayClosePreview {
        business_date: window.business_date,
        business_day_cutover_time: window.business_day_cutover_time,
        window_start_ms: window.start_ms,
        window_end_ms: window.end_ms,
        expected_cash: totals.expected_cash,
        expected_card: totals.expected_card,
        expected_total: totals.expected_cash + totals.expected_card,
        order_count: totals.order_count,
        item_count: totals.item_count,
        product_sales,
        existing_close,
    })
}

#[tauri::command]
pub(crate) fn save_day_close(
    state: State<DbState>,
    request: SaveDayCloseRequest,
) -> Result<SavedDayClose, String> {
    if request.counted_cash < 0 {
        return Err("Counted cash cannot be negative.".to_string());
    }

    let connection = state.0.lock().map_err(|_| "Database lock poisoned".to_string())?;
    let window = business_day_window(&request.business_date, &request.business_day_cutover_time)?;
    let totals = query_day_close_totals(&connection, &window)?;
    let product_sales = query_day_close_product_sales(&connection, &window)?;
    let now = current_timestamp_ms();
    let cash_difference = request.counted_cash - totals.expected_cash;
    let report_json = serde_json::json!({
        "business_date": window.business_date,
        "business_day_cutover_time": window.business_day_cutover_time,
        "window_start_ms": window.start_ms,
        "window_end_ms": window.end_ms,
        "expected_cash": totals.expected_cash,
        "expected_card": totals.expected_card,
        "expected_total": totals.expected_cash + totals.expected_card,
        "counted_cash": request.counted_cash,
        "cash_difference": cash_difference,
        "order_count": totals.order_count,
        "item_count": totals.item_count,
        "product_sales": product_sales,
    })
    .to_string();

    connection
        .execute(
            "
            INSERT INTO day_closes (
              id, date, total_cash, total_card, order_count, item_count, report_json, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(date) DO UPDATE SET
              total_cash = excluded.total_cash,
              total_card = excluded.total_card,
              order_count = excluded.order_count,
              item_count = excluded.item_count,
              report_json = excluded.report_json,
              created_at = excluded.created_at
            ",
            params![
                format!("day_close_{}", window.business_date),
                window.business_date,
                totals.expected_cash,
                totals.expected_card,
                totals.order_count,
                totals.item_count,
                report_json,
                now,
            ],
        )
        .map_err(|error| format!("Could not save day close: {error}"))?;

    Ok(SavedDayClose {
        business_date: request.business_date,
        total_cash: totals.expected_cash,
        total_card: totals.expected_card,
        counted_cash: request.counted_cash,
        cash_difference,
        order_count: totals.order_count,
        item_count: totals.item_count,
        created_at: now,
    })
}

#[tauri::command]
pub(crate) fn get_current_business_date(
    request: CurrentBusinessDateRequest,
) -> Result<CurrentBusinessDate, String> {
    Ok(CurrentBusinessDate {
        business_date: current_business_date(&request.business_day_cutover_time)?,
    })
}

pub(crate) fn current_business_date(cutover_time: &str) -> Result<String, String> {
    let cutover_minutes = parse_cutover_minutes(cutover_time)?;
    let now = Local::now();
    let minutes_after_midnight = now.time().num_seconds_from_midnight() as i64 / 60;

    Ok(business_date_for_local(
        now.date_naive(),
        minutes_after_midnight,
        cutover_minutes,
    ))
}

fn query_day_close_totals(
    connection: &Connection,
    window: &DayCloseWindow,
) -> Result<DayCloseTotals, String> {
    let (expected_cash, expected_card) = connection
        .query_row(
            "
            SELECT
              COALESCE(SUM(CASE WHEN method = 'CASH' THEN amount ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN method IN ('CARD_MANUAL', 'WALLEE') THEN amount ELSE 0 END), 0)
            FROM payments
            WHERE status = 'COMPLETED'
              AND created_at >= ?1
              AND created_at < ?2
            ",
            params![window.start_ms, window.end_ms],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|error| format!("Could not calculate payment totals: {error}"))?;

    let order_count = connection
        .query_row(
            "
            SELECT COUNT(DISTINCT orders.id)
            FROM orders
            INNER JOIN payments ON payments.order_id = orders.id
            WHERE orders.status = 'CLOSED'
              AND orders.payment_status = 'PAID'
              AND payments.status = 'COMPLETED'
              AND payments.created_at >= ?1
              AND payments.created_at < ?2
            ",
            params![window.start_ms, window.end_ms],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Could not count closed orders: {error}"))?;

    let item_count = connection
        .query_row(
            "
            SELECT COALESCE(SUM(order_items.quantity), 0)
            FROM order_items
            INNER JOIN orders ON orders.id = order_items.order_id
            INNER JOIN payments ON payments.order_id = orders.id
            WHERE orders.status = 'CLOSED'
              AND orders.payment_status = 'PAID'
              AND payments.status = 'COMPLETED'
              AND payments.created_at >= ?1
              AND payments.created_at < ?2
            ",
            params![window.start_ms, window.end_ms],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Could not count closed order items: {error}"))?;

    Ok(DayCloseTotals {
        expected_cash,
        expected_card,
        order_count,
        item_count,
    })
}

fn query_day_close_product_sales(
    connection: &Connection,
    window: &DayCloseWindow,
) -> Result<Vec<DayCloseProductSale>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              COALESCE(order_items.product_id, ''),
              order_items.product_name,
              order_items.product_category,
              COALESCE(SUM(order_items.quantity), 0),
              COALESCE(SUM(order_items.total_price), 0)
            FROM order_items
            INNER JOIN orders ON orders.id = order_items.order_id
            INNER JOIN payments ON payments.order_id = orders.id
            WHERE orders.status = 'CLOSED'
              AND orders.payment_status = 'PAID'
              AND payments.status = 'COMPLETED'
              AND payments.created_at >= ?1
              AND payments.created_at < ?2
            GROUP BY order_items.product_id, order_items.product_name, order_items.product_category
            ORDER BY SUM(order_items.total_price) DESC, order_items.product_name
            ",
        )
        .map_err(|error| format!("Could not prepare product sales query: {error}"))?;

    let product_sales = statement
        .query_map(params![window.start_ms, window.end_ms], |row| {
            Ok(DayCloseProductSale {
                product_id: row.get(0)?,
                product_name: row.get(1)?,
                product_category: row.get(2)?,
                quantity: row.get(3)?,
                total: row.get(4)?,
            })
        })
        .map_err(|error| format!("Could not query product sales: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read product sales row: {error}"))?;

    Ok(product_sales)
}

fn query_existing_day_close(
    connection: &Connection,
    business_date: &str,
) -> Result<Option<ExistingDayClose>, String> {
    connection
        .query_row(
            "
            SELECT report_json, created_at
            FROM day_closes
            WHERE date = ?1
            ",
            params![business_date],
            |row| {
                let report_json: String = row.get(0)?;
                let created_at = row.get(1)?;
                let report = serde_json::from_str::<serde_json::Value>(&report_json)
                    .unwrap_or_else(|_| serde_json::json!({}));
                let counted_cash = report
                    .get("counted_cash")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0);
                let cash_difference = report
                    .get("cash_difference")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0);

                Ok(ExistingDayClose {
                    counted_cash,
                    cash_difference,
                    created_at,
                })
            },
        )
        .optional()
        .map_err(|error| format!("Could not query existing day close: {error}"))
}

fn business_day_window(business_date: &str, cutover_time: &str) -> Result<DayCloseWindow, String> {
    let date = NaiveDate::parse_from_str(business_date, "%Y-%m-%d")
        .map_err(|_| "Business date must use YYYY-MM-DD.".to_string())?;
    let cutover = parse_cutover_time(cutover_time)?;
    let start_naive = date.and_time(cutover);
    let end_naive = start_naive + Duration::days(1);

    Ok(DayCloseWindow {
        business_date: business_date.to_string(),
        business_day_cutover_time: cutover_time.to_string(),
        start_ms: local_naive_to_ms(start_naive)?,
        end_ms: local_naive_to_ms(end_naive)?,
    })
}

fn local_naive_to_ms(datetime: chrono::NaiveDateTime) -> Result<i64, String> {
    let local_datetime = match Local.from_local_datetime(&datetime) {
        LocalResult::Single(datetime) => datetime,
        LocalResult::Ambiguous(earliest, _) => earliest,
        LocalResult::None => {
            return Err("Business day boundary does not exist in local time.".to_string())
        }
    };

    Ok(local_datetime.timestamp_millis())
}

fn parse_cutover_time(cutover_time: &str) -> Result<NaiveTime, String> {
    let cutover_minutes = parse_cutover_minutes(cutover_time)?;
    let hours = cutover_minutes / 60;
    let minutes = cutover_minutes % 60;

    NaiveTime::from_hms_opt(hours as u32, minutes as u32, 0)
        .ok_or_else(|| "Business day cutover time must use HH:mm.".to_string())
}

fn parse_cutover_minutes(cutover_time: &str) -> Result<i64, String> {
    let (hours, minutes) = cutover_time
        .split_once(':')
        .ok_or_else(|| "Business day cutover time must use HH:mm.".to_string())?;
    let hours = hours
        .parse::<i64>()
        .map_err(|_| "Business day cutover time must use HH:mm.".to_string())?;
    let minutes = minutes
        .parse::<i64>()
        .map_err(|_| "Business day cutover time must use HH:mm.".to_string())?;

    if !(0..=23).contains(&hours) || !(0..=59).contains(&minutes) {
        return Err("Business day cutover time must use HH:mm.".to_string());
    }

    Ok(hours * 60 + minutes)
}

fn business_date_for_local(
    local_date: NaiveDate,
    minutes_after_midnight: i64,
    cutover_minutes: i64,
) -> String {
    let business_date = if minutes_after_midnight < cutover_minutes {
        local_date - Duration::days(1)
    } else {
        local_date
    };

    business_date.format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midnight_cutover_keeps_current_date() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 28).expect("valid date");

        assert_eq!(business_date_for_local(date, 60, 0), "2026-06-28");
    }

    #[test]
    fn early_morning_before_cutover_belongs_to_previous_date() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 28).expect("valid date");

        assert_eq!(business_date_for_local(date, 60, 120), "2026-06-27");
    }

    #[test]
    fn early_morning_after_cutover_belongs_to_current_date() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 28).expect("valid date");

        assert_eq!(business_date_for_local(date, 180, 120), "2026-06-28");
    }
}
