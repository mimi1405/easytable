use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;
use crate::util::{calculate_included_tax, scoped_id};

#[derive(Serialize)]
pub(crate) struct OpenTableOrderBasket {
    order_id: String,
    order_number: String,
    lines: Vec<OpenTableOrderBasketLine>,
}

#[derive(Serialize)]
struct OpenTableOrderBasketLine {
    id: String,
    product_id: String,
    product_type: String,
    product_name: String,
    product_category: String,
    base_price: i64,
    tax_code_id: String,
    tax_code_name: String,
    tax_rate_bps: i64,
    station: String,
    variants: Vec<OpenTableOrderBasketLineVariant>,
    unit_total: i64,
    quantity: i64,
    line_total: i64,
}

#[derive(Serialize)]
struct OpenTableOrderBasketLineVariant {
    variant_group_id: String,
    variant_group_name: String,
    variant_item_id: String,
    variant_item_name: String,
    price_delta: i64,
}

#[derive(Deserialize)]
pub(crate) struct CreateOrderSnapshotRequest {
    lines: Vec<CreateOrderSnapshotLine>,
    table_context: Option<CreateOrderSnapshotTableContext>,
}

#[derive(Deserialize)]
struct CreateOrderSnapshotTableContext {
    tenant_id: String,
    location_id: String,
    floor_id: String,
    area_id: String,
    table_id: String,
    table_name: String,
}

#[derive(Deserialize)]
struct CreateOrderSnapshotLine {
    product_id: String,
    product_type: String,
    product_name: String,
    product_category: String,
    base_price: i64,
    tax_code_id: String,
    tax_code_name: String,
    tax_rate_bps: i64,
    station: String,
    variants: Vec<CreateOrderSnapshotLineVariant>,
    unit_total: i64,
    quantity: i64,
    line_total: i64,
}

#[derive(Deserialize)]
struct CreateOrderSnapshotLineVariant {
    variant_group_id: String,
    variant_group_name: String,
    variant_item_id: String,
    variant_item_name: String,
    price_delta: i64,
}

#[derive(Serialize)]
pub(crate) struct CreatedOrderSnapshot {
    id: String,
    order_number: String,
    status: String,
    payment_status: String,
    subtotal: i64,
    tax_total: i64,
    total: i64,
    created_at: i64,
    table_id: Option<String>,
    table_name: Option<String>,
    continued_existing_order: bool,
}

#[derive(Deserialize)]
pub(crate) struct CompleteMockPaymentRequest {
    lines: Vec<CreateOrderSnapshotLine>,
    table_context: Option<CreateOrderSnapshotTableContext>,
    payment_method: String,
    received_cash: Option<i64>,
    change_given: Option<i64>,
}

#[derive(Serialize)]
pub(crate) struct CompletedMockPayment {
    order_id: String,
    order_number: String,
    payment_id: String,
    payment_method: String,
    amount: i64,
    received_cash: Option<i64>,
    change_given: Option<i64>,
    status: String,
    paid_at: i64,
}

struct OpenOrder {
    id: String,
    order_number: String,
}

struct SavedOrderSnapshot {
    id: String,
    order_number: String,
    subtotal: i64,
    tax_total: i64,
    total: i64,
    continued_existing_order: bool,
}

#[tauri::command]
pub(crate) fn get_open_table_order_basket(
    state: State<DbState>,
    table_id: String,
) -> Result<Option<OpenTableOrderBasket>, String> {
    let connection = state.0.lock().map_err(|_| "Database lock poisoned".to_string())?;

    let open_order = connection
        .query_row(
            "
            SELECT id, order_number
            FROM orders
            WHERE table_id = ?1
              AND service_mode = 'TABLE'
              AND status = 'OPEN'
              AND payment_status = 'UNPAID'
            ORDER BY created_at DESC
            LIMIT 1
            ",
            params![table_id],
            |row| {
                Ok(OpenOrder {
                    id: row.get(0)?,
                    order_number: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("Could not query open table order basket: {error}"))?;

    let Some(open_order) = open_order else {
        return Ok(None);
    };

    let mut statement = connection
        .prepare(
            "
            SELECT
              id,
              product_id,
              product_type,
              product_name,
              product_category,
              quantity,
              unit_price,
              tax_code_id,
              tax_code_name,
              tax_rate_bps,
              total_price,
              station
            FROM order_items
            WHERE order_id = ?1
            ORDER BY created_at, id
            ",
        )
        .map_err(|error| format!("Could not prepare open table order item query: {error}"))?;

    let item_rows = statement
        .query_map(params![open_order.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                row.get::<_, String>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, Option<String>>(11)?
                    .unwrap_or_else(|| "KITCHEN".to_string()),
            ))
        })
        .map_err(|error| format!("Could not query open table order items: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read open table order item row: {error}"))?;

    let mut lines = Vec::with_capacity(item_rows.len());

    for (
        order_item_id,
        product_id,
        product_type,
        product_name,
        product_category,
        quantity,
        unit_total,
        tax_code_id,
        tax_code_name,
        tax_rate_bps,
        line_total,
        station,
    ) in item_rows
    {
        let variants = list_order_item_variant_snapshots(&connection, &order_item_id)?;
        let base_price = unit_total
            - variants
                .iter()
                .map(|variant| variant.price_delta)
                .sum::<i64>();
        let id = basket_line_id(&product_id, &variants);

        lines.push(OpenTableOrderBasketLine {
            id,
            product_id,
            product_type,
            product_name,
            product_category,
            base_price,
            tax_code_id,
            tax_code_name,
            tax_rate_bps,
            station,
            variants,
            unit_total,
            quantity,
            line_total,
        });
    }

    Ok(Some(OpenTableOrderBasket {
        order_id: open_order.id,
        order_number: open_order.order_number,
        lines,
    }))
}

#[tauri::command]
pub(crate) fn create_order_snapshot(
    state: State<DbState>,
    request: CreateOrderSnapshotRequest,
) -> Result<CreatedOrderSnapshot, String> {
    validate_order_snapshot_request(&request)?;
    let table_context = request
        .table_context
        .as_ref()
        .ok_or_else(|| "Cannot create a table order snapshot without table context.".to_string())?;

    let mut connection = state.0.lock().map_err(|_| "Database lock poisoned".to_string())?;

    let now = crate::util::current_timestamp_ms();
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not start order transaction: {error}"))?;
    let saved_order = save_table_order_snapshot(&transaction, &request, now)?;

    transaction
        .commit()
        .map_err(|error| format!("Could not commit order snapshot: {error}"))?;

    Ok(CreatedOrderSnapshot {
        id: saved_order.id,
        order_number: saved_order.order_number,
        status: "OPEN".to_string(),
        payment_status: "UNPAID".to_string(),
        subtotal: saved_order.subtotal,
        tax_total: saved_order.tax_total,
        total: saved_order.total,
        created_at: now,
        table_id: Some(table_context.table_id.clone()),
        table_name: Some(table_context.table_name.clone()),
        continued_existing_order: saved_order.continued_existing_order,
    })
}

#[tauri::command]
pub(crate) fn complete_mock_payment(
    state: State<DbState>,
    request: CompleteMockPaymentRequest,
) -> Result<CompletedMockPayment, String> {
    validate_mock_payment_request(&request)?;

    let mut connection = state.0.lock().map_err(|_| "Database lock poisoned".to_string())?;

    let now = crate::util::current_timestamp_ms();
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not start mock payment transaction: {error}"))?;
    let payment_method = request.payment_method.clone();
    let request_received_cash = request.received_cash;
    let request_change_given = request.change_given;
    let order_request = CreateOrderSnapshotRequest {
        lines: request.lines,
        table_context: request.table_context,
    };
    let saved_order = save_table_order_snapshot(&transaction, &order_request, now)?;
    validate_mock_payment_amounts(
        &payment_method,
        request_received_cash,
        request_change_given,
        saved_order.total,
    )?;
    let payment_id = scoped_id("pay", now, 0);
    let (received_cash, change_given) = if payment_method == "CASH" {
        (request_received_cash, request_change_given)
    } else {
        (None, None)
    };

    // Mock payment: this only records a successful local payment.
    // No terminal, Wallee, acquirer or cash drawer integration is called here yet.
    transaction
        .execute(
            "
            INSERT INTO payments (
              id, order_id, amount, received_cash, change_given, method, status,
              provider, provider_transaction_id, provider_status, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'COMPLETED', 'MOCK', NULL, 'MOCK_COMPLETED', ?7)
            ",
            params![
                payment_id,
                saved_order.id,
                saved_order.total,
                received_cash,
                change_given,
                payment_method,
                now
            ],
        )
        .map_err(|error| format!("Could not create mock payment: {error}"))?;

    // Mock payment completion: closing the order frees the table in list_table_layout.
    transaction
        .execute(
            "
            UPDATE orders
            SET payment_status = 'PAID',
                status = 'CLOSED',
                updated_at = ?1,
                closed_at = ?1
            WHERE id = ?2
            ",
            params![now, saved_order.id],
        )
        .map_err(|error| format!("Could not mark order as paid: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("Could not commit mock payment: {error}"))?;

    Ok(CompletedMockPayment {
        order_id: saved_order.id,
        order_number: saved_order.order_number,
        payment_id,
        payment_method: request.payment_method,
        amount: saved_order.total,
        received_cash,
        change_given,
        status: "COMPLETED".to_string(),
        paid_at: now,
    })
}

fn save_table_order_snapshot(
    transaction: &Transaction,
    request: &CreateOrderSnapshotRequest,
    now: i64,
) -> Result<SavedOrderSnapshot, String> {
    let table_context = request
        .table_context
        .as_ref()
        .ok_or_else(|| "Cannot save a table order snapshot without table context.".to_string())?;
    let total = request
        .lines
        .iter()
        .map(|line| line.line_total)
        .sum::<i64>();
    let tax_total = request
        .lines
        .iter()
        .map(|line| calculate_included_tax(line.line_total, line.tax_rate_bps))
        .sum::<i64>();
    let subtotal = total - tax_total;
    let open_order = find_open_table_order(&transaction, &table_context.table_id)?;
    let continued_existing_order = open_order.is_some();

    let (order_id, order_number) = if let Some(open_order) = open_order {
        transaction
            .execute(
                "
                DELETE FROM order_item_variant_snapshots
                WHERE order_item_id IN (
                  SELECT id FROM order_items WHERE order_id = ?1
                )
                ",
                params![open_order.id],
            )
            .map_err(|error| format!("Could not clear open table order variants: {error}"))?;

        transaction
            .execute(
                "DELETE FROM order_items WHERE order_id = ?1",
                params![open_order.id],
            )
            .map_err(|error| format!("Could not clear open table order items: {error}"))?;

        transaction
            .execute(
                "
                UPDATE orders
                SET tenant_id = ?1,
                    location_id = ?2,
                    floor_id = ?3,
                    area_id = ?4,
                    table_id = ?5,
                    table_name = ?6,
                    service_mode = 'TABLE',
                    subtotal = ?7,
                    tax_total = ?8,
                    total = ?9,
                    updated_at = ?10
                WHERE id = ?11
                ",
                params![
                    table_context.tenant_id,
                    table_context.location_id,
                    table_context.floor_id,
                    table_context.area_id,
                    table_context.table_id,
                    table_context.table_name,
                    subtotal,
                    tax_total,
                    total,
                    now,
                    open_order.id
                ],
            )
            .map_err(|error| format!("Could not update open table order: {error}"))?;

        (open_order.id, open_order.order_number)
    } else {
        let order_id = scoped_id("ord", now, 0);
        let order_number = next_order_number(&transaction)?;

        transaction
                .execute(
                    "
                    INSERT INTO orders (
                      id, order_number, tenant_id, location_id, floor_id, area_id,
                      table_id, table_name, service_mode, status, subtotal, tax_total, total,
                      payment_status, created_at, updated_at, closed_at
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'TABLE', 'OPEN', ?9, ?10, ?11, 'UNPAID', ?12, ?12, NULL)
                    ",
                    params![
                        order_id,
                        order_number,
                        table_context.tenant_id,
                        table_context.location_id,
                        table_context.floor_id,
                        table_context.area_id,
                        table_context.table_id,
                        table_context.table_name,
                        subtotal,
                        tax_total,
                        total,
                        now
                    ],
                )
                .map_err(|error| format!("Could not create order snapshot: {error}"))?;

        (order_id, order_number)
    };

    for (line_index, line) in request.lines.iter().enumerate() {
        let order_item_id = scoped_id("orit", now, line_index);
        let tax_amount = calculate_included_tax(line.line_total, line.tax_rate_bps);

        transaction
            .execute(
                "
                INSERT INTO order_items (
                  id, order_id, product_id, product_type, product_name, product_category,
                  quantity, unit_price, tax_code_id, tax_code_name, tax_rate_bps,
                  tax_amount, total_price, station, notes, created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL, ?15)
                ",
                params![
                    order_item_id,
                    order_id,
                    line.product_id,
                    line.product_type,
                    line.product_name,
                    line.product_category,
                    line.quantity,
                    line.unit_total,
                    line.tax_code_id,
                    line.tax_code_name,
                    line.tax_rate_bps,
                    tax_amount,
                    line.line_total,
                    line.station,
                    now
                ],
            )
            .map_err(|error| {
                format!(
                    "Could not snapshot order item {}: {error}",
                    line.product_name
                )
            })?;

        for (variant_index, variant) in line.variants.iter().enumerate() {
            let variant_snapshot_id = scoped_id(
                "oris",
                now,
                line_index
                    .checked_mul(100)
                    .and_then(|base| base.checked_add(variant_index))
                    .unwrap_or(variant_index),
            );

            transaction
                .execute(
                    "
                    INSERT INTO order_item_variant_snapshots (
                      id, order_item_id, variant_group_id, variant_group_name,
                      variant_item_id, variant_item_name, price_delta, created_at
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                    ",
                    params![
                        variant_snapshot_id,
                        order_item_id,
                        variant.variant_group_id,
                        variant.variant_group_name,
                        variant.variant_item_id,
                        variant.variant_item_name,
                        variant.price_delta,
                        now
                    ],
                )
                .map_err(|error| {
                    format!(
                        "Could not snapshot variant {}: {error}",
                        variant.variant_item_name
                    )
                })?;
        }
    }

    Ok(SavedOrderSnapshot {
        id: order_id,
        order_number,
        subtotal,
        tax_total,
        total,
        continued_existing_order,
    })
}

fn next_order_number(transaction: &Transaction) -> Result<String, String> {
    let next_number = transaction
        .query_row(
            "SELECT COALESCE(MAX(CAST(SUBSTR(order_number, 2) AS INTEGER)), 0) + 1 FROM orders WHERE order_number LIKE 'R%'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Could not reserve order number: {error}"))?;

    Ok(format!("R{next_number:05}"))
}

fn validate_order_snapshot_request(request: &CreateOrderSnapshotRequest) -> Result<(), String> {
    validate_order_lines(&request.lines)?;

    if request.table_context.is_none() {
        return Err("Cannot create a table order snapshot without table context.".to_string());
    }

    Ok(())
}

fn validate_mock_payment_request(request: &CompleteMockPaymentRequest) -> Result<(), String> {
    validate_order_lines(&request.lines)?;

    if request.table_context.is_none() {
        return Err("Cannot complete a mock payment without table context.".to_string());
    }

    if request.payment_method != "CASH" && request.payment_method != "CARD_MANUAL" {
        return Err("Unsupported mock payment method.".to_string());
    }

    Ok(())
}

fn validate_mock_payment_amounts(
    payment_method: &str,
    received_cash: Option<i64>,
    change_given: Option<i64>,
    order_total: i64,
) -> Result<(), String> {
    if payment_method != "CASH" {
        return Ok(());
    }

    let received_cash = received_cash
        .ok_or_else(|| "Cash payments require received_cash.".to_string())?;
    let change_given = change_given
        .ok_or_else(|| "Cash payments require change_given.".to_string())?;

    if received_cash < order_total {
        return Err("Cash received cannot be lower than the order total.".to_string());
    }

    if change_given != received_cash - order_total {
        return Err("Cash change_given must equal received_cash minus order total.".to_string());
    }

    Ok(())
}

fn validate_order_lines(lines: &[CreateOrderSnapshotLine]) -> Result<(), String> {
    if lines.is_empty() {
        return Err("Cannot create an order snapshot without basket lines.".to_string());
    }

    for line in lines {
        if line.quantity <= 0 {
            return Err(format!(
                "Cannot create order snapshot with invalid quantity for {}.",
                line.product_name
            ));
        }

        if line.unit_total < 0 || line.line_total < 0 {
            return Err(format!(
                "Cannot create order snapshot with negative price for {}.",
                line.product_name
            ));
        }

        let expected_unit_total = line.base_price
            + line
                .variants
                .iter()
                .map(|variant| variant.price_delta)
                .sum::<i64>();

        if expected_unit_total != line.unit_total {
            return Err(format!(
                "Cannot create order snapshot because {} has an inconsistent unit price.",
                line.product_name
            ));
        }

        let expected_line_total = line.unit_total * line.quantity;

        if expected_line_total != line.line_total {
            return Err(format!(
                "Cannot create order snapshot because {} has an inconsistent total.",
                line.product_name
            ));
        }
    }

    Ok(())
}

fn find_open_table_order(
    transaction: &Transaction,
    table_id: &str,
) -> Result<Option<OpenOrder>, String> {
    transaction
        .query_row(
            "
            SELECT id, order_number
            FROM orders
            WHERE table_id = ?1
              AND service_mode = 'TABLE'
              AND status = 'OPEN'
              AND payment_status = 'UNPAID'
            ORDER BY created_at DESC
            LIMIT 1
            ",
            params![table_id],
            |row| {
                Ok(OpenOrder {
                    id: row.get(0)?,
                    order_number: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("Could not query open table order: {error}"))
}

fn basket_line_id(product_id: &str, variants: &[OpenTableOrderBasketLineVariant]) -> String {
    let variant_ids = variants
        .iter()
        .map(|variant| variant.variant_item_id.as_str())
        .collect::<Vec<_>>()
        .join("|");

    format!("{product_id}:{variant_ids}")
}

fn list_order_item_variant_snapshots(
    connection: &Connection,
    order_item_id: &str,
) -> Result<Vec<OpenTableOrderBasketLineVariant>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              variant_group_id,
              variant_group_name,
              variant_item_id,
              variant_item_name,
              price_delta
            FROM order_item_variant_snapshots
            WHERE order_item_id = ?1
            ORDER BY created_at, id
            ",
        )
        .map_err(|error| format!("Could not prepare order item variant query: {error}"))?;

    let variants = statement
        .query_map(params![order_item_id], |row| {
            Ok(OpenTableOrderBasketLineVariant {
                variant_group_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                variant_group_name: row.get(1)?,
                variant_item_id: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                variant_item_name: row.get(3)?,
                price_delta: row.get(4)?,
            })
        })
        .map_err(|error| format!("Could not query order item variants: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read order item variant row: {error}"))?;

    Ok(variants)
}
