use crate::error::{EditError, EditErrorCode};
use crate::rich_text::{RichText, plain_to_rich_text, rich_text_to_plain};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MAX_TABLE_ROWS: usize = 100;
pub const MAX_TABLE_COLS: usize = 50;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableProps {
    pub row_ids: Vec<String>,
    pub col_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col_widths: Option<Vec<f64>>,
    #[serde(default = "default_header_row")]
    pub header_row: bool,
    #[serde(default)]
    pub cells: BTreeMap<String, RichText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
}

fn default_header_row() -> bool {
    true
}

pub fn table_cell_key(row_id: &str, col_id: &str) -> String {
    format!("{row_id}:{col_id}")
}

/// Builds a fresh deterministic table with `rows` rows (`r1..rN`) and `cols` columns (`c1..cM`).
pub fn new_table_props(rows: usize, cols: usize, header_row: bool) -> Result<TableProps, EditError> {
    if rows == 0 || rows > MAX_TABLE_ROWS {
        return Err(EditError::new(
            EditErrorCode::InvalidArgument,
            format!("table rows must be in 1..={MAX_TABLE_ROWS}"),
        ));
    }
    if cols == 0 || cols > MAX_TABLE_COLS {
        return Err(EditError::new(
            EditErrorCode::InvalidArgument,
            format!("table cols must be in 1..={MAX_TABLE_COLS}"),
        ));
    }
    let row_ids = (1..=rows).map(|i| format!("r{i}")).collect();
    let col_ids = (1..=cols).map(|i| format!("c{i}")).collect();
    Ok(TableProps {
        row_ids,
        col_ids,
        col_widths: None,
        header_row,
        cells: BTreeMap::new(),
        font_size: None,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCellUpdate {
    pub row: usize,
    pub col: usize,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TablePatch {
    pub rows: Option<usize>,
    pub cols: Option<usize>,
    pub header_row: Option<bool>,
    pub font_size: Option<f64>,
    pub cells: Option<Vec<TableCellUpdate>>,
}

fn next_id(existing: &[String], prefix: char) -> String {
    let mut n = existing.len() + 1;
    loop {
        let candidate = format!("{prefix}{n}");
        if !existing.iter().any(|x| x == &candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Applies row/col resizes first, then cell text updates (preserving untouched cells).
pub fn apply_table_patch(table: &TableProps, patch: &TablePatch) -> Result<TableProps, EditError> {
    let mut next = table.clone();

    if let Some(target_rows) = patch.rows {
        if target_rows == 0 || target_rows > MAX_TABLE_ROWS {
            return Err(EditError::new(
                EditErrorCode::InvalidArgument,
                format!("table rows must be in 1..={MAX_TABLE_ROWS}"),
            ));
        }
        while next.row_ids.len() < target_rows {
            let id = next_id(&next.row_ids, 'r');
            next.row_ids.push(id);
        }
        if next.row_ids.len() > target_rows {
            let removed: Vec<String> = next.row_ids.drain(target_rows..).collect();
            next.cells.retain(|k, _| {
                let row_part = k.split(':').next().unwrap_or("");
                !removed.iter().any(|r| r == row_part)
            });
        }
    }

    if let Some(target_cols) = patch.cols {
        if target_cols == 0 || target_cols > MAX_TABLE_COLS {
            return Err(EditError::new(
                EditErrorCode::InvalidArgument,
                format!("table cols must be in 1..={MAX_TABLE_COLS}"),
            ));
        }
        while next.col_ids.len() < target_cols {
            let id = next_id(&next.col_ids, 'c');
            next.col_ids.push(id);
            if let Some(widths) = &mut next.col_widths {
                widths.push(160.0);
            }
        }
        if next.col_ids.len() > target_cols {
            let removed: Vec<String> = next.col_ids.drain(target_cols..).collect();
            if let Some(widths) = &mut next.col_widths {
                widths.truncate(target_cols);
            }
            next.cells.retain(|k, _| {
                let col_part = k.split(':').nth(1).unwrap_or("");
                !removed.iter().any(|c| c == col_part)
            });
        }
    }

    if let Some(header_row) = patch.header_row {
        next.header_row = header_row;
    }
    if let Some(font_size) = patch.font_size {
        if !font_size.is_finite() || font_size <= 0.0 || font_size > 200.0 {
            return Err(EditError::new(
                EditErrorCode::InvalidArgument,
                "table fontSize must be in (0, 200]",
            ));
        }
        next.font_size = Some(font_size);
    }

    if let Some(cell_updates) = &patch.cells {
        for upd in cell_updates {
            let row_id = next.row_ids.get(upd.row).ok_or_else(|| {
                EditError::new(
                    EditErrorCode::InvalidArgument,
                    format!("cell row index {} out of range", upd.row),
                )
            })?;
            let col_id = next.col_ids.get(upd.col).ok_or_else(|| {
                EditError::new(
                    EditErrorCode::InvalidArgument,
                    format!("cell col index {} out of range", upd.col),
                )
            })?;
            let key = table_cell_key(row_id, col_id);
            if upd.text.is_empty() {
                next.cells.remove(&key);
            } else {
                next.cells.insert(key, plain_to_rich_text(&upd.text));
            }
        }
    }

    Ok(next)
}

/// Renders a table as pipe-separated plain text rows (suitable for outline/markdown).
pub fn table_plain_text(table: &TableProps) -> Vec<Vec<String>> {
    table
        .row_ids
        .iter()
        .map(|r| {
            table
                .col_ids
                .iter()
                .map(|c| {
                    table
                        .cells
                        .get(&table_cell_key(r, c))
                        .map(rich_text_to_plain)
                        .unwrap_or_default()
                })
                .collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_and_patches_table_preserving_untouched_cells() {
        let t = new_table_props(2, 2, true).unwrap();
        let t = apply_table_patch(
            &t,
            &TablePatch {
                cells: Some(vec![
                    TableCellUpdate {
                        row: 0,
                        col: 0,
                        text: "Name".into(),
                    },
                    TableCellUpdate {
                        row: 1,
                        col: 1,
                        text: "42".into(),
                    },
                ]),
                ..TablePatch::default()
            },
        )
        .unwrap();
        let t = apply_table_patch(
            &t,
            &TablePatch {
                rows: Some(3),
                cols: Some(2),
                cells: Some(vec![TableCellUpdate {
                    row: 2,
                    col: 0,
                    text: "Added".into(),
                }]),
                ..TablePatch::default()
            },
        )
        .unwrap();
        let grid = table_plain_text(&t);
        assert_eq!(grid.len(), 3);
        assert_eq!(grid[0][0], "Name");
        assert_eq!(grid[1][1], "42");
        assert_eq!(grid[2][0], "Added");
    }

    #[test]
    fn shrinking_table_drops_removed_cells() {
        let t = new_table_props(2, 2, true).unwrap();
        let t = apply_table_patch(
            &t,
            &TablePatch {
                cells: Some(vec![TableCellUpdate {
                    row: 1,
                    col: 1,
                    text: "Bye".into(),
                }]),
                ..TablePatch::default()
            },
        )
        .unwrap();
        let t = apply_table_patch(
            &t,
            &TablePatch {
                rows: Some(1),
                ..TablePatch::default()
            },
        )
        .unwrap();
        assert!(t.cells.is_empty());
    }
}
