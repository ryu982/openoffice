use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use flate2::Compression;
use flate2::write::DeflateEncoder;
use serde_json::{Value, json};
use tempfile::tempdir;

fn sidecar_bin() -> &'static str {
    env!("CARGO_BIN_EXE_ieum-parse-sidecar")
}

#[test]
fn sidecar_json_rpc_commands_concurrency_cancel_and_shutdown() {
    let dir = tempdir().unwrap();
    let csv_path = dir.path().join("sample.csv");
    fs::write(&csv_path, "이름,코드\n김철수,02139\n").unwrap();
    let log_path = dir.path().join("app.log");
    fs::write(&log_path, b"hello \xe9 world").unwrap(); // Windows-1252 fallback
    let md_path = dir.path().join("doc.md");
    fs::write(&md_path, "# Markdown\n").unwrap();

    let mut child = Command::new(sidecar_bin())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn ieum-parse-sidecar");

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    // Send multiple requests concurrently, including invalid JSON, wrong version,
    // extract_file, scan_dir, tokenize_text, cancel, and shutdown.
    let requests = vec![
        "not-valid-json".to_owned(),
        json!({ "version": 99, "requestId": "bad-ver", "command": "tokenize_text", "text": "a" }).to_string(),
        json!({
            "version": 1,
            "requestId": "req-csv",
            "command": "extract_file",
            "path": csv_path,
            "ext": "csv",
            "tokenize": true,
            "maxBodyChars": 100
        }).to_string(),
        json!({
            "version": 1,
            "requestId": "req-log",
            "command": "extract_file",
            "path": log_path,
            "ext": "log"
        }).to_string(),
        json!({
            "version": 1,
            "requestId": "req-md",
            "command": "extract_file",
            "path": md_path,
            "ext": "md"
        }).to_string(),
        json!({
            "version": 1,
            "requestId": "req-scan",
            "command": "scan_dir",
            "root": dir.path()
        }).to_string(),
        json!({
            "version": 1,
            "requestId": "req-tok",
            "command": "tokenize_text",
            "text": "ＡＢＣ 한글검색"
        }).to_string(),
        json!({
            "version": 1,
            "requestId": "req-cancel",
            "command": "cancel",
            "targetRequestId": "nonexistent-id"
        }).to_string(),
    ];

    for line in &requests {
        writeln!(stdin, "{line}").unwrap();
    }
    stdin.flush().unwrap();

    let mut reader = BufReader::new(stdout);
    let mut by_id: HashMap<String, Value> = HashMap::new();
    let mut saw_invalid_json = false;

    for _ in 0..requests.len() {
        let mut line = String::new();
        let n = reader.read_line(&mut line).unwrap();
        assert!(n > 0, "unexpected EOF before all responses arrived");
        let val: Value = serde_json::from_str(&line).expect("stdout must only contain JSON lines");
        assert_eq!(val["version"], 1);
        let id = val["requestId"].as_str().unwrap().to_owned();
        if id.is_empty() {
            assert_eq!(val["ok"], false);
            assert_eq!(val["error"]["code"], "invalid_json");
            saw_invalid_json = true;
        } else {
            by_id.insert(id, val);
        }
    }

    assert!(saw_invalid_json);
    assert_eq!(by_id["bad-ver"]["ok"], false);
    assert_eq!(by_id["bad-ver"]["error"]["code"], "unsupported_version");

    // CSV extraction + tokenization
    let csv_res = &by_id["req-csv"];
    assert_eq!(csv_res["ok"], true);
    assert_eq!(csv_res["result"]["status"], "ok");
    assert_eq!(csv_res["result"]["text"], "이름,코드\n김철수,02139\n");
    assert_eq!(csv_res["result"]["tokens"]["bi"], "이름 코드 김철 철수 02139");
    assert_eq!(csv_res["result"]["tokens"]["uni"], "이 름 코 드 김 철 수 02139");

    // Windows-1252 log fallback
    assert_eq!(by_id["req-log"]["result"]["status"], "ok");
    assert_eq!(by_id["req-log"]["result"]["text"], "hello \u{00e9} world");
    assert!(by_id["req-log"]["result"].get("tokens").is_none());

    // Markdown fallback with no text/tokens leaked
    assert_eq!(by_id["req-md"]["result"]["status"], "fallback");
    assert_eq!(by_id["req-md"]["result"]["fallbackReason"], "unsupported_format");
    assert!(by_id["req-md"]["result"].get("text").is_none());
    assert!(by_id["req-md"]["result"].get("tokens").is_none());

    // scan_dir finds sample.csv and doc.md (app.log is not in TREE_FILE_EXTENSIONS)
    assert_eq!(by_id["req-scan"]["ok"], true);
    assert_eq!(by_id["req-scan"]["result"]["truncated"], false);
    assert_eq!(by_id["req-scan"]["result"]["files"].as_array().unwrap().len(), 2);

    // tokenize_text
    assert_eq!(by_id["req-tok"]["result"]["bi"], "abc 한글 글검 검색");
    assert_eq!(by_id["req-tok"]["result"]["uni"], "abc 한 글 검 색");

    // cancel of unknown request
    assert_eq!(by_id["req-cancel"]["ok"], true);
    assert_eq!(by_id["req-cancel"]["result"]["cancelled"], false);

    // Send shutdown and verify response + clean exit code 0
    writeln!(
        stdin,
        "{}",
        json!({ "version": 1, "requestId": "req-shut", "command": "shutdown" })
    )
    .unwrap();
    stdin.flush().unwrap();

    let mut shut_line = String::new();
    reader.read_line(&mut shut_line).unwrap();
    let shut_val: Value = serde_json::from_str(&shut_line).unwrap();
    assert_eq!(shut_val["ok"], true);
    assert_eq!(shut_val["result"]["shutdown"], true);

    drop(stdin);
    let status = child.wait().unwrap();
    assert!(status.success(), "sidecar did not exit 0 on shutdown: {status}");
}

#[test]
fn sidecar_exits_cleanly_on_stdin_eof() {
    let mut child = Command::new(sidecar_bin())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn ieum-parse-sidecar");

    // Close stdin immediately without sending shutdown
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "sidecar did not exit 0 on EOF");
    assert!(output.stdout.is_empty(), "unexpected stdout output on bare EOF");
}

fn build_deflated_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut local_buf = Vec::new();
    let mut central_buf = Vec::new();
    for (name, data) in entries {
        let mut enc = DeflateEncoder::new(Vec::new(), Compression::fast());
        enc.write_all(data).unwrap();
        let compressed = enc.finish().unwrap();
        let local_offset = local_buf.len() as u32;
        let name_bytes = name.as_bytes();
        let csize = compressed.len() as u32;
        let usize_val = data.len() as u32;

        local_buf.extend_from_slice(&0x04034b50u32.to_le_bytes());
        local_buf.extend_from_slice(&20u16.to_le_bytes());
        local_buf.extend_from_slice(&0x0800u16.to_le_bytes());
        local_buf.extend_from_slice(&8u16.to_le_bytes());
        local_buf.extend_from_slice(&0u16.to_le_bytes());
        local_buf.extend_from_slice(&0u16.to_le_bytes());
        local_buf.extend_from_slice(&0u32.to_le_bytes());
        local_buf.extend_from_slice(&csize.to_le_bytes());
        local_buf.extend_from_slice(&usize_val.to_le_bytes());
        local_buf.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        local_buf.extend_from_slice(&0u16.to_le_bytes());
        local_buf.extend_from_slice(name_bytes);
        local_buf.extend_from_slice(&compressed);

        central_buf.extend_from_slice(&0x02014b50u32.to_le_bytes());
        central_buf.extend_from_slice(&20u16.to_le_bytes());
        central_buf.extend_from_slice(&20u16.to_le_bytes());
        central_buf.extend_from_slice(&0x0800u16.to_le_bytes());
        central_buf.extend_from_slice(&8u16.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u32.to_le_bytes());
        central_buf.extend_from_slice(&csize.to_le_bytes());
        central_buf.extend_from_slice(&usize_val.to_le_bytes());
        central_buf.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u32.to_le_bytes());
        central_buf.extend_from_slice(&local_offset.to_le_bytes());
        central_buf.extend_from_slice(name_bytes);
    }
    let cd_offset = local_buf.len() as u32;
    let cd_size = central_buf.len() as u32;
    let count = entries.len() as u16;
    let mut out = local_buf;
    out.extend_from_slice(&central_buf);
    out.extend_from_slice(&0x06054b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

#[test]
fn sidecar_extract_thumbnail_command_round_trips() {
    let dir = tempdir().unwrap();
    let png = [0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xDE, 0xAD];
    let docx_bytes = build_deflated_zip(&[
        ("word/document.xml", b"<w:document/>"),
        ("docProps/thumbnail.png", &png),
    ]);
    let docx_path = dir.path().join("thumb.docx");
    fs::write(&docx_path, &docx_bytes).unwrap();

    let mut child = Command::new(sidecar_bin())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn ieum-parse-sidecar");

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);

    writeln!(
        stdin,
        "{}",
        json!({
            "version": 1,
            "requestId": "req-thumb",
            "command": "extract_thumbnail",
            "path": docx_path,
            "ext": "docx"
        })
    )
    .unwrap();
    stdin.flush().unwrap();

    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let val: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(val["ok"], true);
    assert_eq!(val["requestId"], "req-thumb");
    assert_eq!(val["result"]["status"], "ok");
    assert_eq!(val["result"]["mime"], "image/png");
    assert_eq!(val["result"]["entry"], "docProps/thumbnail.png");
    assert_eq!(val["result"]["dataBase64"], "iVBORw0KGgrerQ==");

    writeln!(
        stdin,
        "{}",
        json!({ "version": 1, "requestId": "req-shut", "command": "shutdown" })
    )
    .unwrap();
    stdin.flush().unwrap();
    line.clear();
    reader.read_line(&mut line).unwrap();
    let shut: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(shut["result"]["shutdown"], true);

    drop(stdin);
    let status = child.wait().unwrap();
    assert!(status.success(), "sidecar did not exit 0 on shutdown: {status}");
}

#[test]
fn sidecar_cancels_in_flight_heavy_work_and_exits_promptly_on_bare_stdin_eof() {
    let dir = tempdir().unwrap();
    // 64 MiB of zeros compresses to ~64 KiB on disk but requires full metered
    // stream inflation during open_and_verify. Queuing 40 copies would take many
    // seconds to drain if bare EOF did not cancel in-flight and queued tasks.
    let zeros = vec![0u8; 64 * 1024 * 1024];
    let heavy_zip = build_deflated_zip(&[
        ("word/document.xml", b"<w:document/>"),
        ("word/media/huge.bin", &zeros),
    ]);
    let heavy_path = dir.path().join("heavy.docx");
    fs::write(&heavy_path, &heavy_zip).unwrap();

    let mut child = Command::new(sidecar_bin())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn ieum-parse-sidecar");

    let mut stdin = child.stdin.take().unwrap();
    for idx in 0..40 {
        writeln!(
            stdin,
            "{}",
            json!({
                "version": 1,
                "requestId": format!("heavy-{idx}"),
                "command": "extract_thumbnail",
                "path": heavy_path,
                "ext": "docx"
            })
        )
        .unwrap();
    }
    stdin.flush().unwrap();

    // Allow workers to dequeue and enter the inflate verification loop.
    thread::sleep(Duration::from_millis(30));

    let started = Instant::now();
    // Simulate abrupt parent death: drop stdin without sending shutdown.
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    let elapsed = started.elapsed();

    assert!(
        output.status.success(),
        "sidecar did not exit 0 on bare EOF during heavy work: {:?}",
        output.status
    );
    assert!(
        elapsed < Duration::from_secs(3),
        "sidecar took too long ({elapsed:?}) to cancel in-flight work on bare EOF"
    );
}

#[test]
fn sidecar_extracts_legacy_doc_and_ppt_and_rejects_zip_as_ppt() {
    let dir = tempdir().unwrap();
    let doc_fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/legacy-sample.doc");
    let ppt_fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/legacy-sample.ppt");
    let fake_ppt = dir.path().join("fake.ppt");
    fs::write(&fake_ppt, build_deflated_zip(&[("a.txt", b"zip-not-ppt")])).unwrap();

    let mut child = Command::new(sidecar_bin())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn ieum-parse-sidecar");

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);

    let requests = [
        json!({
            "version": 1,
            "requestId": "req-doc",
            "command": "extract_file",
            "path": doc_fixture,
            "ext": "doc",
            "tokenize": true
        }),
        json!({
            "version": 1,
            "requestId": "req-ppt",
            "command": "extract_file",
            "path": ppt_fixture,
            "ext": "ppt",
            "tokenize": true
        }),
        json!({
            "version": 1,
            "requestId": "req-fake-ppt",
            "command": "extract_file",
            "path": fake_ppt,
            "ext": "ppt"
        }),
    ];

    for req in &requests {
        writeln!(stdin, "{req}").unwrap();
    }
    stdin.flush().unwrap();

    let mut by_id: HashMap<String, Value> = HashMap::new();
    for _ in 0..requests.len() {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let val: Value = serde_json::from_str(&line).unwrap();
        by_id.insert(val["requestId"].as_str().unwrap().to_owned(), val);
    }

    assert_eq!(by_id["req-doc"]["result"]["status"], "ok");
    assert!(
        by_id["req-doc"]["result"]["text"]
            .as_str()
            .unwrap()
            .contains("Legacy DOC body text")
    );
    assert!(by_id["req-doc"]["result"]["tokens"]["bi"].is_string());

    assert_eq!(by_id["req-ppt"]["result"]["status"], "ok");
    assert!(
        by_id["req-ppt"]["result"]["text"]
            .as_str()
            .unwrap()
            .contains("## Slide 1\nLegacy PPT title")
    );
    assert!(by_id["req-ppt"]["result"]["tokens"]["uni"].is_string());

    assert_eq!(by_id["req-fake-ppt"]["result"]["status"], "rejected");
    assert_eq!(by_id["req-fake-ppt"]["result"]["rejectCode"], "content_mismatch");

    writeln!(
        stdin,
        "{}",
        json!({ "version": 1, "requestId": "req-shut", "command": "shutdown" })
    )
    .unwrap();
    stdin.flush().unwrap();
    drop(stdin);
    assert!(child.wait().unwrap().success());
}
