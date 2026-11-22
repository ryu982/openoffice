use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::protocol::{ScanDirResult, ScannedFile};

pub const SCAN_MAX_DEPTH: usize = 32;
pub const SCAN_MAX_FILES: usize = 200_000;

const MD_ASSET_MANIFEST: &str = ".genoffice-assets.json";

/// Lowercased extension without leading dot, honoring `.drawio.svg` / `.drawio.png`.
/// Matches `apps/shell/src/main/app-routing.ts` `documentExtension`.
pub fn document_extension(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".drawio.svg") {
        return "drawio.svg".to_owned();
    }
    if lower.ends_with(".drawio.png") {
        return "drawio.png".to_owned();
    }
    // Match Node's path.extname(name).slice(1).toLowerCase():
    // a leading dot (e.g. ".hidden") or trailing dot ("foo.") has no extension.
    let base = match name.rfind(['/', '\\']) {
        Some(idx) => &name[idx + 1..],
        None => name,
    };
    let Some(dot) = base.rfind('.') else {
        return String::new();
    };
    if dot == 0 || dot + 1 >= base.len() {
        return String::new();
    }
    base[dot + 1..].to_ascii_lowercase()
}

/// Matches `TREE_FILE_EXTENSIONS` in `apps/shell/src/main/folder-tree.ts`.
pub fn is_supported_tree_file(name: &str) -> bool {
    matches!(
        document_extension(name).as_str(),
        "docx"
            | "doc"
            | "odt"
            | "xlsx"
            | "xlsm"
            | "xls"
            | "csv"
            | "tsv"
            | "ods"
            | "pptx"
            | "ppt"
            | "pdf"
            | "md"
            | "markdown"
            | "txt"
            | "json"
            | "html"
            | "htm"
            | "xmind"
            | "mm"
            | "hwp"
            | "hwpx"
            | "epub"
            | "drawio"
            | "dio"
            | "vsdx"
            | "drawio.svg"
            | "drawio.png"
    )
}

/// Matches `isHiddenEntry` in `apps/shell/src/main/folder-tree.ts`.
pub fn is_hidden_entry(dir: &Path, name: &str, is_dir: bool) -> bool {
    if name.starts_with('.') || name.starts_with("~$") {
        return true;
    }
    let lower = name.to_lowercase();
    if is_dir {
        if lower == "node_modules" || lower == "__macosx" {
            return true;
        }
        if lower == "assets" && dir.join(name).join(MD_ASSET_MANIFEST).exists() {
            return true;
        }
        return false;
    }
    lower == "thumbs.db" || lower == "desktop.ini"
}

fn system_time_to_ms(time: SystemTime) -> f64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(d) => (d.as_secs() as f64) * 1000.0 + (d.subsec_nanos() as f64) / 1_000_000.0,
        Err(err) => {
            let d = err.duration();
            -((d.as_secs() as f64) * 1000.0 + (d.subsec_nanos() as f64) / 1_000_000.0)
        }
    }
}

fn stat_file(path: &Path) -> Option<ScannedFile> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let mtime_ms = meta.modified().ok().map(system_time_to_ms).unwrap_or(0.0);
    Some(ScannedFile {
        path: path.to_string_lossy().into_owned(),
        mtime_ms,
        size_bytes: meta.len(),
    })
}

/// Recursively scans `root` for supported, visible files without following symlinks.
/// Matches `apps/shell/src/main/file-index/scan.ts`.
pub fn scan_dir(
    root: &Path,
    max_depth: Option<usize>,
    max_files: Option<usize>,
    cancelled: &AtomicBool,
) -> Result<ScanDirResult, ()> {
    let max_depth = max_depth.unwrap_or(SCAN_MAX_DEPTH);
    let max_files = max_files.unwrap_or(SCAN_MAX_FILES);
    let mut files = Vec::new();
    let mut truncated = false;

    fn walk(
        dir: &Path,
        depth: usize,
        max_depth: usize,
        max_files: usize,
        files: &mut Vec<ScannedFile>,
        truncated: &mut bool,
        cancelled: &AtomicBool,
    ) -> Result<(), ()> {
        if cancelled.load(Ordering::Acquire) {
            return Err(());
        }
        if depth > max_depth {
            *truncated = true;
            return Ok(());
        }
        let entries = match fs::read_dir(dir) {
            Ok(iter) => iter,
            Err(_) => return Ok(()),
        };
        for entry_res in entries {
            if cancelled.load(Ordering::Acquire) {
                return Err(());
            }
            if files.len() >= max_files {
                *truncated = true;
                return Ok(());
            }
            let Ok(entry) = entry_res else {
                continue;
            };
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            // Do not follow symlinks (matching Node Dirent isDirectory/isFile behavior).
            if ft.is_symlink() {
                continue;
            }
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                continue;
            };
            let path = entry.path();
            if ft.is_dir() {
                if !is_hidden_entry(dir, name, true) {
                    walk(
                        &path,
                        depth + 1,
                        max_depth,
                        max_files,
                        files,
                        truncated,
                        cancelled,
                    )?;
                }
            } else if ft.is_file()
                && is_supported_tree_file(name)
                && !is_hidden_entry(dir, name, false)
            {
                if let Some(st) = stat_file(&path) {
                    files.push(st);
                }
            }
        }
        Ok(())
    }

    walk(
        root,
        0,
        max_depth,
        max_files,
        &mut files,
        &mut truncated,
        cancelled,
    )?;

    Ok(ScanDirResult { files, truncated })
}
