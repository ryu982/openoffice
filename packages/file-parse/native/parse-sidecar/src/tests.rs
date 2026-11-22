use std::fs;
use std::io::{Cursor, Write};
use std::path::Path;
use std::sync::atomic::AtomicBool;

use flate2::Compression;
use flate2::write::DeflateEncoder;
use serde_json::Value;
use tempfile::tempdir;

use crate::extract::thumbnail::{encode_base64, extract_thumbnail, sniff_image_mime};
use crate::extract::{ExtractOptions, extract_file, rels};
use crate::protocol::{
    ExtractResult, FallbackReason, RejectCode, ThumbnailResult, TokenizedStrings,
};
use crate::scan::{document_extension, is_hidden_entry, is_supported_tree_file, scan_dir};
use crate::tokenize::{is_cjk, tokenize_text, truncate_utf16_units};
use crate::zip_gate::{DEFAULT_ZIP_LIMITS, ZipArchive, ZipGateError, ZipLimits, is_text_part};

/// Minimal test ZIP builder supporting stored/deflated entries and deliberate header tampering.
struct TestZipEntry {
    name: Vec<u8>,
    data: Vec<u8>,
    method: u16,
    flags: u16,
    declared_usize: Option<u32>,
    declared_csize: Option<u32>,
}

impl TestZipEntry {
    fn deflate(name: &str, data: &[u8]) -> Self {
        Self {
            name: name.as_bytes().to_vec(),
            data: data.to_vec(),
            method: 8,
            flags: 0x0800,
            declared_usize: None,
            declared_csize: None,
        }
    }

    fn stored(name: &str, data: &[u8]) -> Self {
        Self {
            name: name.as_bytes().to_vec(),
            data: data.to_vec(),
            method: 0,
            flags: 0x0800,
            declared_usize: None,
            declared_csize: None,
        }
    }
}

fn build_test_zip(entries: &[TestZipEntry]) -> Vec<u8> {
    let mut local_buf = Vec::new();
    let mut central_buf = Vec::new();

    for entry in entries {
        let compressed = if entry.method == 8 {
            let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
            enc.write_all(&entry.data).unwrap();
            enc.finish().unwrap()
        } else {
            entry.data.clone()
        };
        let csize = entry.declared_csize.unwrap_or(compressed.len() as u32);
        let usize_val = entry.declared_usize.unwrap_or(entry.data.len() as u32);
        let local_offset = local_buf.len() as u32;

        // Local file header
        local_buf.extend_from_slice(&0x04034b50u32.to_le_bytes());
        local_buf.extend_from_slice(&20u16.to_le_bytes());
        local_buf.extend_from_slice(&entry.flags.to_le_bytes());
        local_buf.extend_from_slice(&entry.method.to_le_bytes());
        local_buf.extend_from_slice(&0u16.to_le_bytes());
        local_buf.extend_from_slice(&0u16.to_le_bytes());
        local_buf.extend_from_slice(&0u32.to_le_bytes());
        local_buf.extend_from_slice(&csize.to_le_bytes());
        local_buf.extend_from_slice(&usize_val.to_le_bytes());
        local_buf.extend_from_slice(&(entry.name.len() as u16).to_le_bytes());
        local_buf.extend_from_slice(&0u16.to_le_bytes());
        local_buf.extend_from_slice(&entry.name);
        local_buf.extend_from_slice(&compressed);

        // Central directory header
        central_buf.extend_from_slice(&0x02014b50u32.to_le_bytes());
        central_buf.extend_from_slice(&20u16.to_le_bytes());
        central_buf.extend_from_slice(&20u16.to_le_bytes());
        central_buf.extend_from_slice(&entry.flags.to_le_bytes());
        central_buf.extend_from_slice(&entry.method.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u32.to_le_bytes());
        central_buf.extend_from_slice(&csize.to_le_bytes());
        central_buf.extend_from_slice(&usize_val.to_le_bytes());
        central_buf.extend_from_slice(&(entry.name.len() as u16).to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u16.to_le_bytes());
        central_buf.extend_from_slice(&0u32.to_le_bytes());
        central_buf.extend_from_slice(&local_offset.to_le_bytes());
        central_buf.extend_from_slice(&entry.name);
    }

    let cd_offset = local_buf.len() as u32;
    let cd_size = central_buf.len() as u32;
    let count = entries.len() as u16;

    let mut out = local_buf;
    out.extend_from_slice(&central_buf);
    // EOCD
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

fn write_temp_file(dir: &Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let path = dir.join(name);
    fs::write(&path, bytes).unwrap();
    path
}

#[test]
fn fallback_result_never_serializes_text_or_tokens() {
    let res = ExtractResult::Fallback {
        fallback_reason: FallbackReason::RedactionPresent,
    };
    let val: Value = serde_json::to_value(&res).unwrap();
    assert_eq!(val["status"], "fallback");
    assert_eq!(val["fallbackReason"], "redaction_present");
    assert!(val.get("text").is_none());
    assert!(val.get("tokens").is_none());
}

#[test]
fn rels_resolve_target_matches_opc_rules() {
    assert_eq!(rels::resolve_target("word/document.xml", "styles.xml"), "word/styles.xml");
    assert_eq!(
        rels::resolve_target("ppt/slides/slide1.xml", "../notesSlides/notesSlide1.xml"),
        "ppt/notesSlides/notesSlide1.xml"
    );
    assert_eq!(
        rels::resolve_target("ppt/slides/slide1.xml", "../../../../etc/passwd"),
        "etc/passwd"
    );
    assert_eq!(
        rels::resolve_target("ppt/slides/slide1.xml", "\\ppt\\slides\\slide2.xml"),
        "ppt/slides/slide2.xml"
    );
    assert_eq!(rels::resolve_target("word/document.xml", "https://example.com/a"), "");
    assert_eq!(rels::resolve_target("word/document.xml", "file:///etc/passwd"), "");
    assert_eq!(rels::resolve_target("word/document.xml", "%ZZbad"), "");
    assert_eq!(
        rels::resolve_target("word/document.xml", "media/hello%20world.xml"),
        "word/media/hello world.xml"
    );
}

#[test]
fn zip_gate_rejects_forged_declared_size() {
    let payload = vec![b'A'; 4096];
    let mut entry = TestZipEntry::deflate("word/document.xml", &payload);
    entry.declared_usize = Some(100);
    let zip_bytes = build_test_zip(&[entry]);
    let err = ZipArchive::open_and_verify(
        Cursor::new(zip_bytes),
        DEFAULT_ZIP_LIMITS,
        &AtomicBool::new(false),
    )
    .err()
    .expect("forged usize must fail");
    match err {
        ZipGateError::Rejected(msg) => {
            assert!(msg.starts_with("zip rejected:"), "unexpected message: {msg}");
        }
        other => panic!("expected ZipGateError::Rejected, got {other:?}"),
    }
}

#[test]
fn zip_gate_rejects_zip64_encrypted_and_unsupported_method() {
    let mut enc_entry = TestZipEntry::stored("a.xml", b"hello");
    enc_entry.flags |= 0x1;
    let enc_zip = build_test_zip(&[enc_entry]);
    let err = ZipArchive::open_and_verify(
        Cursor::new(enc_zip),
        DEFAULT_ZIP_LIMITS,
        &AtomicBool::new(false),
    )
    .err()
    .unwrap();
    assert!(matches!(err, ZipGateError::Rejected(_)));

    let mut bad_method = TestZipEntry::stored("a.xml", b"hello");
    bad_method.method = 99;
    let bad_zip = build_test_zip(&[bad_method]);
    let err = ZipArchive::open_and_verify(
        Cursor::new(bad_zip),
        DEFAULT_ZIP_LIMITS,
        &AtomicBool::new(false),
    )
    .err()
    .unwrap();
    assert!(matches!(err, ZipGateError::Rejected(_)));

    // Zip64 sentinel count 0xffff
    let mut z64 = build_test_zip(&[TestZipEntry::stored("a.xml", b"hi")]);
    let len = z64.len();
    z64[len - 12] = 0xff;
    z64[len - 11] = 0xff;
    let err = ZipArchive::open_and_verify(
        Cursor::new(z64),
        DEFAULT_ZIP_LIMITS,
        &AtomicBool::new(false),
    )
    .err()
    .unwrap();
    assert!(matches!(err, ZipGateError::Rejected(_)));
}

#[test]
fn zip_gate_enforces_part_and_total_limits() {
    let zip_bytes = build_test_zip(&[
        TestZipEntry::deflate("a.xml", b"0123456789"),
        TestZipEntry::deflate("b.xml", b"0123456789"),
    ]);
    let small_limits = ZipLimits {
        max_parts: 1,
        max_part_bytes: 1024,
        max_total_bytes: 1024,
    };
    assert!(matches!(
        ZipArchive::open_and_verify(Cursor::new(zip_bytes.clone()), small_limits, &AtomicBool::new(false)),
        Err(ZipGateError::Rejected(_))
    ));

    let small_total = ZipLimits {
        max_parts: 10,
        max_part_bytes: 1024,
        max_total_bytes: 15,
    };
    assert!(matches!(
        ZipArchive::open_and_verify(Cursor::new(zip_bytes), small_total, &AtomicBool::new(false)),
        Err(ZipGateError::Rejected(_))
    ));

    assert!(is_text_part("mimetype"));
    assert!(is_text_part("word/document.xml"));
    assert!(is_text_part("word/_rels/document.xml.rels"));
    assert!(!is_text_part("word/media/image1.png"));
    assert!(!is_text_part("ppt/media/video1.mp4"));
}

#[test]
fn tokenize_cjk_nfkc_and_combining_marks() {
    assert!(is_cjk('한' as u32));
    assert!(is_cjk('字' as u32));
    assert!(!is_cjk('A' as u32));

    // Fullwidth NFKC folding + Korean bigrams + single Han char + combining mark (e + acute)
    let input = "ＡＢＣ ２０２６ 회의록 e\u{0301}x 單";
    let tok = tokenize_text(input);
    assert_eq!(
        tok,
        TokenizedStrings {
            bi: "abc 2026 회의 의록 \u{00e9}x 單".to_owned(),
            uni: "abc 2026 회 의 록 \u{00e9}x 單".to_owned(),
        }
    );

    // Combining mark that does NOT precompose under NFKC (a + U+0323 + U+0302 or x + U+0301)
    let non_precomposed = tokenize_text("x\u{0301}y");
    assert_eq!(non_precomposed.bi, "x\u{0301}y");
    assert_eq!(non_precomposed.uni, "x\u{0301}y");

    // UTF-16 truncation must not split surrogate pairs
    let emoji = "a😀b"; // 'a'=1, '😀'=2, 'b'=1 UTF-16 units
    assert_eq!(truncate_utf16_units(emoji, 2), "a");
    assert_eq!(truncate_utf16_units(emoji, 3), "a😀");
}

#[test]
fn scan_dir_rules_extensions_hidden_and_limits() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    assert_eq!(document_extension("flow.drawio.svg"), "drawio.svg");
    assert_eq!(document_extension("flow.DRAWIO.PNG"), "drawio.png");
    assert_eq!(document_extension("Report.DOCX"), "docx");
    assert_eq!(document_extension(".hidden"), "");
    assert!(is_supported_tree_file("notes.md"));
    assert!(is_supported_tree_file("chart.drawio.png"));
    assert!(!is_supported_tree_file("photo.png"));

    fs::write(root.join("report.docx"), b"x").unwrap();
    fs::write(root.join("diagram.drawio.svg"), b"x").unwrap();
    fs::write(root.join("~$lock.docx"), b"x").unwrap();
    fs::write(root.join(".dotfile.md"), b"x").unwrap();
    fs::write(root.join("Thumbs.db"), b"x").unwrap();
    fs::write(root.join("ignore.png"), b"x").unwrap();

    fs::create_dir(root.join("node_modules")).unwrap();
    fs::write(root.join("node_modules/a.md"), b"x").unwrap();
    fs::create_dir(root.join("assets")).unwrap();
    fs::write(root.join("assets/.genoffice-assets.json"), b"{}").unwrap();
    fs::write(root.join("assets/inside.md"), b"x").unwrap();
    fs::create_dir(root.join("sub")).unwrap();
    fs::write(root.join("sub/notes.txt"), b"hello").unwrap();

    assert!(is_hidden_entry(root, "assets", true));
    assert!(is_hidden_entry(root, "node_modules", true));
    assert!(is_hidden_entry(root, "Thumbs.db", false));

    let res = scan_dir(root, None, None, &AtomicBool::new(false)).unwrap();
    assert!(!res.truncated);
    let mut names: Vec<String> = res
        .files
        .iter()
        .map(|f| Path::new(&f.path).file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, vec!["diagram.drawio.svg", "notes.txt", "report.docx"]);

    let limited = scan_dir(root, Some(0), None, &AtomicBool::new(false)).unwrap();
    assert!(limited.truncated);
    let max_one = scan_dir(root, None, Some(1), &AtomicBool::new(false)).unwrap();
    assert!(max_one.truncated);
    assert_eq!(max_one.files.len(), 1);
}

#[test]
fn extract_docx_headings_lists_tables_footnotes_images_and_max_chars() {
    let dir = tempdir().unwrap();
    let styles = r#"<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="H1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Bullet"><w:numPr><w:numId w:val="2"/></w:numPr></w:style>
</w:styles>"#;
    let doc = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Bullet"/></w:pPr><w:r><w:t>Item 02139</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Secret</w:t></w:r><w:r><w:t>Visible</w:t></w:r><w:r><w:drawing><wp:docPr descr="Chart A"/></w:drawing></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body>
</w:document>"#;
    let footnotes = r#"<?xml version="1.0"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator"><w:p><w:r><w:t>---</w:t></w:r></w:p></w:footnote>
  <w:footnote w:id="1"><w:p><w:r><w:t>Note one</w:t></w:r></w:p></w:footnote>
</w:footnotes>"#;
    let zip = build_test_zip(&[
        TestZipEntry::deflate("word/document.xml", doc.as_bytes()),
        TestZipEntry::deflate("word/styles.xml", styles.as_bytes()),
        TestZipEntry::deflate("word/footnotes.xml", footnotes.as_bytes()),
    ]);
    let path = write_temp_file(dir.path(), "sample.docx", &zip);
    let res = extract_file(&path, "docx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    match res {
        ExtractResult::Ok { text, tokens } => {
            assert!(tokens.is_none());
            assert_eq!(
                text,
                "# Title\n- Item 02139\nVisible[image: Chart A]\nA | B\n## Footnotes\nNote one"
            );
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // .doc with ZIP magic parses as OOXML docx
    let doc_path = write_temp_file(dir.path(), "renamed.doc", &zip);
    let res = extract_file(&doc_path, "doc", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    assert!(matches!(res, ExtractResult::Ok { .. }));
}

#[test]
fn extract_pptx_order_notes_comments_and_redaction_fail_closed() {
    let dir = tempdir().unwrap();
    let pres = r#"<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst>
</p:presentation>"#;
    let pres_rels = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>"#;
    let slide1 = r#"<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Second </a:t></a:r><a:r><a:t>02139</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>"#;
    let slide2 = r#"<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>"#;
    let slide2_rels = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment2.xml"/>
</Relationships>"#;
    let notes2 = r#"<?xml version="1.0"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Speaker note</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:notes>"#;
    let authors = r#"<?xml version="1.0"?>
<p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cmAuthor id="0" name="Alice"/>
</p:cmAuthorLst>"#;
    let comments2 = r#"<?xml version="1.0"?>
<p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cm authorId="0" dt="2026-01-01T00:00:00"><p:text>Looks good</p:text></p:cm>
</p:cmLst>"#;

    let zip = build_test_zip(&[
        TestZipEntry::deflate("ppt/presentation.xml", pres.as_bytes()),
        TestZipEntry::deflate("ppt/_rels/presentation.xml.rels", pres_rels.as_bytes()),
        TestZipEntry::deflate("ppt/slides/slide1.xml", slide1.as_bytes()),
        TestZipEntry::deflate("ppt/slides/slide2.xml", slide2.as_bytes()),
        TestZipEntry::deflate("ppt/slides/_rels/slide2.xml.rels", slide2_rels.as_bytes()),
        TestZipEntry::deflate("ppt/notesSlides/notesSlide2.xml", notes2.as_bytes()),
        TestZipEntry::deflate("ppt/commentAuthors.xml", authors.as_bytes()),
        TestZipEntry::deflate("ppt/comments/comment2.xml", comments2.as_bytes()),
    ]);
    let path = write_temp_file(dir.path(), "deck.pptx", &zip);
    let res = extract_file(&path, "pptx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    match res {
        ExtractResult::Ok { text, .. } => {
            assert_eq!(
                text,
                "## Slide 1\nFirst slide\n### Notes\nSpeaker note\n### Comments\n- Alice (2026-01-01T00:00:00): Looks good\n\n## Slide 2\nSecond 02139"
            );
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // Redaction trace via EXT URI, :redact, or runtime redactNamespaces must fail closed!
    let redacted_slide = r#"<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:rPr><a:extLst><a:ext uri="{9F1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D}"><x:mark/></a:ext></a:extLst></a:rPr><a:t>TOP SECRET</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>"#;
    let red_zip = build_test_zip(&[TestZipEntry::deflate(
        "ppt/slides/slide1.xml",
        redacted_slide.as_bytes(),
    )]);
    let red_path = write_temp_file(dir.path(), "redacted.pptx", &red_zip);
    let res = extract_file(&red_path, "pptx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    assert_eq!(
        res,
        ExtractResult::Fallback {
            fallback_reason: FallbackReason::RedactionPresent
        }
    );

    let ns_slide = r#"<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:custom="https://example.invalid/custom-redact-ns">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>SECRET2</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>"#;
    let ns_zip = build_test_zip(&[TestZipEntry::deflate(
        "ppt/slides/slide1.xml",
        ns_slide.as_bytes(),
    )]);
    let ns_path = write_temp_file(dir.path(), "redacted_ns.pptx", &ns_zip);
    let opts = ExtractOptions {
        redact_namespaces: vec!["https://example.invalid/custom-redact-ns".to_owned()],
        ..Default::default()
    };
    let res = extract_file(&ns_path, "pptx", &opts, &AtomicBool::new(false)).unwrap();
    assert_eq!(
        res,
        ExtractResult::Fallback {
            fallback_reason: FallbackReason::RedactionPresent
        }
    );
}

#[test]
fn extract_xlsx_shared_strings_dates_formulas_and_empty_runs() {
    let dir = tempdir().unwrap();
    let wb = r#"<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#;
    let rels = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#;
    let sst = r#"<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>02139</t></si>
</sst>"#;
    let styles = r#"<?xml version="1.0"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cellXfs count="2">
    <xf numFmtId="0"/>
    <xf numFmtId="14"/>
  </cellXfs>
</styleSheet>"#;
    let sheet1 = r#"<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" s="1"><v>45292</v></c>
      <c r="C1"><f t="shared" si="0">A1+1</f></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Start</t></is></c>
      <c r="C2"><f t="shared" si="0"/></c>
      <c r="M2" t="inlineStr"><is><t>Far</t></is></c>
    </row>
  </sheetData>
</worksheet>"#;
    let zip = build_test_zip(&[
        TestZipEntry::deflate("xl/workbook.xml", wb.as_bytes()),
        TestZipEntry::deflate("xl/_rels/workbook.xml.rels", rels.as_bytes()),
        TestZipEntry::deflate("xl/sharedStrings.xml", sst.as_bytes()),
        TestZipEntry::deflate("xl/styles.xml", styles.as_bytes()),
        TestZipEntry::deflate("xl/worksheets/sheet1.xml", sheet1.as_bytes()),
    ]);
    let path = write_temp_file(dir.path(), "book.xlsx", &zip);
    let res = extract_file(&path, "xlsx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    match res {
        ExtractResult::Ok { text, .. } => {
            assert_eq!(
                text,
                "# Sales\n02139 | 2024-01-01 | =A1+1\nStart |  | =A2+1 | (9 empty) | Far"
            );
        }
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn extract_odt_paragraphs_tables_notes_and_encryption_check() {
    let dir = tempdir().unwrap();
    let mimetype = b"application/vnd.oasis.opendocument.text";
    let content = r#"<?xml version="1.0"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
  <office:body><office:text>
    <text:h>Heading</text:h>
    <text:p>Hello<text:s text:c="2"/>world<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>Foot</text:p></text:note-body></text:note></text:p>
    <table:table><table:table-row><table:table-cell><text:p>C1</text:p></table:table-cell><table:table-cell><text:p>C2</text:p></table:table-cell></table:table-row></table:table>
  </office:text></office:body>
</office:document-content>"#;
    let zip = build_test_zip(&[
        TestZipEntry::stored("mimetype", mimetype),
        TestZipEntry::deflate("content.xml", content.as_bytes()),
    ]);
    let path = write_temp_file(dir.path(), "doc.odt", &zip);
    let res = extract_file(&path, "odt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    match res {
        ExtractResult::Ok { text, .. } => {
            assert_eq!(text, "Heading\nHello  world1\nC1\tC2\n\n1 Foot");
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // Encrypted ODT
    let enc_manifest = r#"<?xml version="1.0"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="content.xml"><manifest:encryption-data/></manifest:file-entry>
</manifest:manifest>"#;
    let enc_zip = build_test_zip(&[
        TestZipEntry::stored("mimetype", mimetype),
        TestZipEntry::deflate("META-INF/manifest.xml", enc_manifest.as_bytes()),
        TestZipEntry::deflate("content.xml", content.as_bytes()),
    ]);
    let enc_path = write_temp_file(dir.path(), "enc.odt", &enc_zip);
    let res = extract_file(&enc_path, "odt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    assert!(matches!(
        res,
        ExtractResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));
}

#[test]
fn extract_epub_spine_html_and_drm_rejection() {
    let dir = tempdir().unwrap();
    let container = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;
    let opf = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>"#;
    let ch1 = r#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Skip</title></head><body>
  <h1>Chapter 1</h1>
  <p>Hello <b>world</b></p>
  <table><tr><td>A</td><td>B</td></tr></table>
</body></html>"#;
    let zip = build_test_zip(&[
        TestZipEntry::deflate("META-INF/container.xml", container.as_bytes()),
        TestZipEntry::deflate("OEBPS/content.opf", opf.as_bytes()),
        TestZipEntry::deflate("OEBPS/ch1.xhtml", ch1.as_bytes()),
    ]);
    let path = write_temp_file(dir.path(), "book.epub", &zip);
    let res = extract_file(&path, "epub", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    match res {
        ExtractResult::Ok { text, .. } => {
            assert_eq!(text, "# Chapter 1\n\nHello world\n\nA\tB");
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // DRM via rights.xml
    let drm_zip = build_test_zip(&[
        TestZipEntry::deflate("META-INF/container.xml", container.as_bytes()),
        TestZipEntry::deflate("META-INF/rights.xml", b"<rights/>"),
        TestZipEntry::deflate("OEBPS/content.opf", opf.as_bytes()),
        TestZipEntry::deflate("OEBPS/ch1.xhtml", ch1.as_bytes()),
    ]);
    let drm_path = write_temp_file(dir.path(), "drm.epub", &drm_zip);
    let res = extract_file(&drm_path, "epub", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    assert!(matches!(
        res,
        ExtractResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));
}

#[test]
fn extract_xmind_outline_legacy_and_encrypted() {
    let dir = tempdir().unwrap();
    let content = r#"[
  {
    "id": "s1",
    "title": "Plan",
    "rootTopic": {
      "id": "t1",
      "title": "Root",
      "children": {
        "attached": [
          {
            "id": "t2",
            "title": "Child",
            "labels": ["tag1", "tag2"],
            "href": "https://example.com/a b",
            "notes": { "plain": { "content": "Line 1\nLine 2\n" } }
          }
        ]
      }
    }
  }
]"#;
    let zip = build_test_zip(&[TestZipEntry::deflate("content.json", content.as_bytes())]);
    let path = write_temp_file(dir.path(), "map.xmind", &zip);
    let res = extract_file(&path, "xmind", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap();
    match res {
        ExtractResult::Ok { text, .. } => {
            assert_eq!(
                text,
                "# Plan\n\n- Root\n  - Child [tag1, tag2] <https://example.com/a%20b>\n    > Line 1\n    > Line 2\n"
            );
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // Legacy content.xml only -> corrupt
    let legacy_zip = build_test_zip(&[TestZipEntry::deflate("content.xml", b"<xmap/>")]);
    let legacy_path = write_temp_file(dir.path(), "legacy.xmind", &legacy_zip);
    assert!(matches!(
        extract_file(&legacy_path, "xmind", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::Corrupt,
            ..
        }
    ));

    // Encrypted manifest.json -> password_protected
    let enc_manifest = r#"{"file-entries":{"content.json":{"encryption-data":{"algorithm-name":"AES"}}}}"#;
    let enc_zip = build_test_zip(&[
        TestZipEntry::deflate("content.json", b"encrypted"),
        TestZipEntry::deflate("manifest.json", enc_manifest.as_bytes()),
    ]);
    let enc_path = write_temp_file(dir.path(), "enc.xmind", &enc_zip);
    assert!(matches!(
        extract_file(&enc_path, "xmind", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));
}

#[test]
fn extract_plain_csv_utf32_magic_mismatch_and_unsupported_fallback() {
    let dir = tempdir().unwrap();

    // UTF-32LE BOM rejected
    let utf32_path = write_temp_file(dir.path(), "bad.csv", &[0xFF, 0xFE, 0x00, 0x00, b'a', 0, 0, 0]);
    assert!(matches!(
        extract_file(&utf32_path, "csv", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::UnsupportedEncoding,
            ..
        }
    ));

    // UTF-8 CSV with tokenize=true
    let csv_path = write_temp_file(dir.path(), "data.csv", "이름,점수\n철수,100".as_bytes());
    let opts = ExtractOptions {
        tokenize: true,
        ..Default::default()
    };
    match extract_file(&csv_path, "csv", &opts, &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, tokens } => {
            assert_eq!(text, "이름,점수\n철수,100");
            let tok = tokens.expect("tokens requested");
            assert_eq!(tok.bi, "이름 점수 철수 100");
            assert_eq!(tok.uni, "이 름 점 수 철 수 100");
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // Password-protected OOXML (OLE2 + UTF-16LE EncryptedPackage)
    let mut ole2 = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    for ch in "EncryptedPackage".encode_utf16() {
        ole2.extend_from_slice(&ch.to_le_bytes());
    }
    let pw_path = write_temp_file(dir.path(), "secret.docx", &ole2);
    assert!(matches!(
        extract_file(&pw_path, "docx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));

    // Truncated OLE2 .doc -> rejected as corrupt (never fallback to TS)
    let legacy_doc = write_temp_file(dir.path(), "old.doc", &[0xD0, 0xCF, 0x11, 0xE0, 0, 0]);
    assert!(matches!(
        extract_file(&legacy_doc, "doc", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::Corrupt,
            ..
        }
    ));

    // Unsupported format (md / html / pdf / hwp) -> fallback unsupported_format
    let md_path = write_temp_file(dir.path(), "note.md", b"# hi");
    assert_eq!(
        extract_file(&md_path, "md", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Fallback {
            fallback_reason: FallbackReason::UnsupportedFormat
        }
    );
}

#[test]
fn extract_docx_edge_cases_hidden_images_headers_image_only_and_max_chars() {
    let dir = tempdir().unwrap();

    // Image-only document notice
    let img_only_doc = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
    <w:p><w:r><w:drawing><wp:docPr hidden="1" descr="ShouldNotAppear"/></w:drawing></w:r></w:p>
    <w:p><w:r><w:drawing><wp:docPr/></w:drawing></w:r></w:p>
  </w:body>
</w:document>"#;
    let zip = build_test_zip(&[TestZipEntry::deflate(
        "word/document.xml",
        img_only_doc.as_bytes(),
    )]);
    let path = write_temp_file(dir.path(), "imgonly.docx", &zip);
    match extract_file(&path, "docx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, .. } => {
            assert_eq!(text, "[image-only document: 2 images, no extractable text]");
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // Related header/footer/comments + maxChars early stop
    let body = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Line One</w:t></w:r></w:p>
    <w:p><w:r><w:t>Line Two</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
    let rels = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>"#;
    let header1 = r#"<?xml version="1.0"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>Top Banner</w:t></w:r></w:p>
</w:hdr>"#;
    let zip2 = build_test_zip(&[
        TestZipEntry::deflate("word/document.xml", body.as_bytes()),
        TestZipEntry::deflate("word/_rels/document.xml.rels", rels.as_bytes()),
        TestZipEntry::deflate("word/header1.xml", header1.as_bytes()),
    ]);
    let p2 = write_temp_file(dir.path(), "hdr.docx", &zip2);
    match extract_file(&p2, "docx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, .. } => {
            assert_eq!(text, "Line One\nLine Two\n## Header\nTop Banner");
        }
        other => panic!("expected Ok, got {other:?}"),
    }
    let opts = ExtractOptions {
        max_chars: Some(9),
        ..Default::default()
    };
    match extract_file(&p2, "docx", &opts, &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, .. } => assert_eq!(text, "Line One"),
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn extract_pptx_threaded_comments_picture_only_and_redact_in_notes_or_comments() {
    let dir = tempdir().unwrap();

    // Picture-only slide deck notice
    let pic_slide = r#"<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:pic/></p:spTree></p:cSld>
</p:sld>"#;
    let pic_zip = build_test_zip(&[TestZipEntry::deflate(
        "ppt/slides/slide1.xml",
        pic_slide.as_bytes(),
    )]);
    let pic_path = write_temp_file(dir.path(), "pics.pptx", &pic_zip);
    match extract_file(&pic_path, "pptx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, .. } => {
            assert!(text.starts_with("[No extractable text: none of the 1 slide carries text;"));
            assert!(text.contains("[picture-only slide: 1 image, no extractable text]"));
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // :redact inside notes must abort entire deck with zero text leaked
    let clean_slide = r#"<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Public</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>"#;
    let slide_rels = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>"#;
    let redacted_notes = r#"<?xml version="1.0"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:rPr><go:redact label="SSN"/></a:rPr><a:t>123-45-6789</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>"#;
    let red_notes_zip = build_test_zip(&[
        TestZipEntry::deflate("ppt/slides/slide1.xml", clean_slide.as_bytes()),
        TestZipEntry::deflate("ppt/slides/_rels/slide1.xml.rels", slide_rels.as_bytes()),
        TestZipEntry::deflate("ppt/notesSlides/notesSlide1.xml", redacted_notes.as_bytes()),
    ]);
    let red_notes_path = write_temp_file(dir.path(), "rednotes.pptx", &red_notes_zip);
    assert_eq!(
        extract_file(&red_notes_path, "pptx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Fallback {
            fallback_reason: FallbackReason::RedactionPresent
        }
    );

    // Threaded Office 365 comments with reply
    let cm_rels = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2018/10/relationships/comments" Target="../comments/comment1.xml"/>
</Relationships>"#;
    let authors = r#"<p188:authorLst xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main"><p188:author id="{A}" name="Bob"/></p188:authorLst>"#;
    let threaded = r#"<p188:cmLst xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p188:cm authorId="{A}" created="2026-02-01">
    <p188:txBody><a:p><a:r><a:t>Parent comment</a:t></a:r></a:p></p188:txBody>
    <p188:replyLst>
      <p188:reply authorId="{MISSING}"><p188:txBody><a:p><a:r><a:t>Reply text</a:t></a:r></a:p></p188:txBody></p188:reply>
    </p188:replyLst>
  </p188:cm>
</p188:cmLst>"#;
    let t_zip = build_test_zip(&[
        TestZipEntry::deflate("ppt/slides/slide1.xml", clean_slide.as_bytes()),
        TestZipEntry::deflate("ppt/slides/_rels/slide1.xml.rels", cm_rels.as_bytes()),
        TestZipEntry::deflate("ppt/authors.xml", authors.as_bytes()),
        TestZipEntry::deflate("ppt/comments/comment1.xml", threaded.as_bytes()),
    ]);
    let t_path = write_temp_file(dir.path(), "threaded.pptx", &t_zip);
    match extract_file(&t_path, "pptx", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, .. } => {
            assert_eq!(
                text,
                "## Slide 1\nPublic\n### Comments\n- Bob (2026-02-01): Parent comment\n- Unknown author: Reply text"
            );
        }
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn extract_odt_textbox_table_custom_prefix_and_wrong_mimetype() {
    let dir = tempdir().unwrap();
    let mimetype = b"application/vnd.oasis.opendocument.text";
    let content = r#"<?xml version="1.0"?>
<o:document-content
  xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:t="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:tb="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:d="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
  <o:body><o:text>
    <t:p><d:frame><d:text-box><tb:table><tb:table-row><tb:table-cell><t:p>BoxA</t:p></tb:table-cell><tb:table-cell><t:p>BoxB</t:p></tb:table-cell></tb:table-row></tb:table></d:text-box></d:frame></t:p>
  </o:text></o:body>
</o:document-content>"#;
    let zip = build_test_zip(&[
        TestZipEntry::stored("mimetype", mimetype),
        TestZipEntry::deflate("content.xml", content.as_bytes()),
    ]);
    let path = write_temp_file(dir.path(), "hancom.odt", &zip);
    match extract_file(&path, "odt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, .. } => assert_eq!(text, "BoxA\tBoxB"),
        other => panic!("expected Ok, got {other:?}"),
    }

    // Wrong mimetype -> ContentMismatch
    let ods_zip = build_test_zip(&[
        TestZipEntry::stored("mimetype", b"application/vnd.oasis.opendocument.spreadsheet"),
        TestZipEntry::deflate("content.xml", content.as_bytes()),
    ]);
    let ods_path = write_temp_file(dir.path(), "wrong.odt", &ods_zip);
    assert!(matches!(
        extract_file(&ods_path, "odt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::ContentMismatch,
            ..
        }
    ));
}

#[test]
fn extract_epub_html_fallback_font_obfuscation_and_invalid_encoding_chapter() {
    let dir = tempdir().unwrap();
    let container = r#"<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;
    let opf = r#"<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>"#;
    // Allowed font obfuscation only (NOT DRM)
    let font_enc = r#"<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></enc:EncryptedData>
</encryption>"#;
    // Malformed XML (unclosed <p>, bare <br>, <script> skipped)
    let c1_html = b"<html><body><h2>Part&nbsp;1</h2><p>First<br>Second<p>Third<script>bad()</script></body></html>";
    let c2_invalid_utf8 = &[0xFF, 0xFE, 0x00]; // odd-length invalid UTF-16LE

    let zip = build_test_zip(&[
        TestZipEntry::deflate("META-INF/container.xml", container.as_bytes()),
        TestZipEntry::deflate("META-INF/encryption.xml", font_enc.as_bytes()),
        TestZipEntry::deflate("content.opf", opf.as_bytes()),
        TestZipEntry::deflate("c1.xhtml", c1_html),
        TestZipEntry::deflate("c2.xhtml", c2_invalid_utf8),
    ]);
    let path = write_temp_file(dir.path(), "mixed.epub", &zip);
    match extract_file(&path, "epub", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, .. } => {
            assert_eq!(
                text,
                "## Part\u{00A0}1\n\nFirst\nSecond\n\nThird\n\n[Chapter 2 (c2.xhtml) left out: its bytes are not valid utf-16le text]"
            );
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // 0 readable chapters -> Corrupt
    let bad_opf = r#"<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c2"/></spine>
</package>"#;
    let zero_zip = build_test_zip(&[
        TestZipEntry::deflate("META-INF/container.xml", container.as_bytes()),
        TestZipEntry::deflate("content.opf", bad_opf.as_bytes()),
        TestZipEntry::deflate("c2.xhtml", &[0x80, 0x81, 0x82]),
    ]);
    let zero_path = write_temp_file(dir.path(), "zero.epub", &zero_zip);
    assert!(matches!(
        extract_file(&zero_path, "epub", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::Corrupt,
            ..
        }
    ));
}

#[test]
fn extract_csv_euc_kr_and_utf16_bom() {
    let dir = tempdir().unwrap();

    // Korean prose in EUC-KR (CP949)
    let korean_text = "이름,부서,비고\n대한민국은 아름다운 나라입니다. 오늘 회의록을 작성하고 있습니다.";
    let (euc_kr_bytes, _, _) = encoding_rs::EUC_KR.encode(korean_text);
    let kr_path = write_temp_file(dir.path(), "kr.csv", &euc_kr_bytes);
    match extract_file(&kr_path, "csv", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, .. } => assert_eq!(text, korean_text),
        other => panic!("expected Ok, got {other:?}"),
    }

    // UTF-16BE BOM in .xml
    let mut utf16be = vec![0xFE, 0xFF];
    for u in "<a/>".encode_utf16() {
        utf16be.extend_from_slice(&u.to_be_bytes());
    }
    let xml_path = write_temp_file(dir.path(), "be.xml", &utf16be);
    match extract_file(&xml_path, "xml", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap() {
        ExtractResult::Ok { text, .. } => assert_eq!(text, "<a/>"),
        other => panic!("expected Ok, got {other:?}"),
    }

    // UTF-32BE BOM rejected
    let utf32be = write_temp_file(dir.path(), "u32.py", &[0x00, 0x00, 0xFE, 0xFF, 0, 0, 0, b'x']);
    assert!(matches!(
        extract_file(&utf32be, "py", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::UnsupportedEncoding,
            ..
        }
    ));
}

#[test]
fn base64_encoder_matches_rfc4648_vectors() {
    assert_eq!(encode_base64(b""), "");
    assert_eq!(encode_base64(b"f"), "Zg==");
    assert_eq!(encode_base64(b"fo"), "Zm8=");
    assert_eq!(encode_base64(b"foo"), "Zm9v");
    assert_eq!(encode_base64(b"foob"), "Zm9vYg==");
    assert_eq!(encode_base64(b"fooba"), "Zm9vYmE=");
    assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
}

#[test]
fn sniff_image_mime_detects_supported_formats_and_rejects_junk() {
    assert_eq!(
        sniff_image_mime(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        Some("image/png")
    );
    assert_eq!(
        sniff_image_mime(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00]),
        Some("image/jpeg")
    );
    assert_eq!(sniff_image_mime(b"GIF89a\x01\x00"), Some("image/gif"));
    assert_eq!(sniff_image_mime(b"BM\x36\x00\x00\x00"), Some("image/bmp"));
    assert_eq!(sniff_image_mime(b"RIFF\x20\x00\x00\x00WEBP"), Some("image/webp"));
    assert_eq!(sniff_image_mime(b"NOT_AN_IMAGE"), None);
    assert_eq!(sniff_image_mime(&[0x89, 0x50]), None);
}

#[test]
fn extract_thumbnail_handles_all_zip_formats_case_insensitivity_and_priority() {
    let dir = tempdir().unwrap();
    let png = [0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02];
    let jpg = [0xFFu8, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
    let bmp = [0x42u8, 0x4D, 0x1E, 0x00, 0x00, 0x00, 0x00, 0x00];
    let gif = b"GIF89a\x01\x00\x01\x00";

    // HWPX Preview/PrvImage.bmp (case-insensitive)
    let hwpx = build_test_zip(&[TestZipEntry::deflate("preview/PRVIMAGE.BMP", &bmp)]);
    let hwpx_path = write_temp_file(dir.path(), "sample.hwpx", &hwpx);
    assert_eq!(
        extract_thumbnail(&hwpx_path, "hwpx", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Ok {
            mime: "image/bmp".to_owned(),
            data_base64: encode_base64(&bmp),
            entry: "preview/PRVIMAGE.BMP".to_owned(),
        }
    );

    // ZIP-based .hwp (HWPX saved under .hwp extension)
    let hwp_zip_path = write_temp_file(dir.path(), "renamed.hwp", &hwpx);
    assert!(matches!(
        extract_thumbnail(&hwp_zip_path, "hwp", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Ok { ref mime, .. } if mime == "image/bmp"
    ));

    // ODT / XMind Thumbnails/thumbnail.png
    let odt = build_test_zip(&[
        TestZipEntry::stored("mimetype", b"application/vnd.oasis.opendocument.text"),
        TestZipEntry::deflate("Thumbnails/thumbnail.png", &png),
    ]);
    let odt_path = write_temp_file(dir.path(), "sample.odt", &odt);
    assert_eq!(
        extract_thumbnail(&odt_path, "odt", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Ok {
            mime: "image/png".to_owned(),
            data_base64: encode_base64(&png),
            entry: "Thumbnails/thumbnail.png".to_owned(),
        }
    );

    // OOXML docProps/thumbnail.jpeg + invalid higher-priority candidate skipped
    let docx = build_test_zip(&[
        TestZipEntry::deflate("docProps/thumbnail.png", b"corrupt-not-png"),
        TestZipEntry::deflate("docProps/thumbnail.jpeg", &jpg),
    ]);
    let docx_path = write_temp_file(dir.path(), "sample.docx", &docx);
    assert_eq!(
        extract_thumbnail(&docx_path, "docx", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Ok {
            mime: "image/jpeg".to_owned(),
            data_base64: encode_base64(&jpg),
            entry: "docProps/thumbnail.jpeg".to_owned(),
        }
    );

    // Priority: Preview/PrvImage.png wins over docProps/thumbnail.gif
    let multi = build_test_zip(&[
        TestZipEntry::deflate("docProps/thumbnail.gif", gif),
        TestZipEntry::stored("Preview/PrvImage.png", &png),
    ]);
    let multi_path = write_temp_file(dir.path(), "multi.pptx", &multi);
    assert_eq!(
        extract_thumbnail(&multi_path, "pptx", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Ok {
            mime: "image/png".to_owned(),
            data_base64: encode_base64(&png),
            entry: "Preview/PrvImage.png".to_owned(),
        }
    );

    // No thumbnail entry -> NotFound
    let empty_zip = build_test_zip(&[TestZipEntry::deflate("word/document.xml", b"<w:document/>")]);
    let empty_path = write_temp_file(dir.path(), "no-thumb.docx", &empty_zip);
    assert_eq!(
        extract_thumbnail(&empty_path, "docx", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::NotFound {}
    );

    // Oversized thumbnail skipped when exceeding max_bytes
    let mut big_png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    big_png.resize(2048, 0xAA);
    let capped_zip = build_test_zip(&[
        TestZipEntry::deflate("docProps/thumbnail.png", &big_png),
        TestZipEntry::deflate("docProps/thumbnail.gif", gif),
    ]);
    let capped_path = write_temp_file(dir.path(), "capped.xlsx", &capped_zip);
    assert_eq!(
        extract_thumbnail(&capped_path, "xlsx", Some(512), &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Ok {
            mime: "image/gif".to_owned(),
            data_base64: encode_base64(gif),
            entry: "docProps/thumbnail.gif".to_owned(),
        }
    );
}

#[test]
fn extract_thumbnail_enforces_security_gates_and_never_falls_back_on_rejects() {
    let dir = tempdir().unwrap();
    let png = [0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02];

    // 1. Lying-declaration ZIP bomb -> ZipRejected
    let mut bomb_entry = TestZipEntry::deflate("word/media/bomb.bin", &vec![0u8; 256 * 1024]);
    bomb_entry.declared_usize = Some(64);
    let bomb_zip = build_test_zip(&[
        TestZipEntry::deflate("docProps/thumbnail.png", &png),
        bomb_entry,
    ]);
    let bomb_path = write_temp_file(dir.path(), "bomb.docx", &bomb_zip);
    assert!(matches!(
        extract_thumbnail(&bomb_path, "docx", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Rejected {
            reject_code: RejectCode::ZipRejected,
            ..
        }
    ));

    // 2. Encrypted entry flag -> ZipRejected
    let mut enc_entry = TestZipEntry::deflate("docProps/thumbnail.png", &png);
    enc_entry.flags |= 0x0001;
    let enc_zip = build_test_zip(&[enc_entry]);
    let enc_path = write_temp_file(dir.path(), "enc.pptx", &enc_zip);
    assert!(matches!(
        extract_thumbnail(&enc_path, "pptx", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Rejected {
            reject_code: RejectCode::ZipRejected,
            ..
        }
    ));

    // 3. Path traversal entry -> ZipRejected
    let trav_zip = build_test_zip(&[
        TestZipEntry::deflate("../evil.txt", b"escape"),
        TestZipEntry::deflate("docProps/thumbnail.png", &png),
    ]);
    let trav_path = write_temp_file(dir.path(), "trav.docx", &trav_zip);
    assert!(matches!(
        extract_thumbnail(&trav_path, "docx", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Rejected {
            reject_code: RejectCode::ZipRejected,
            ..
        }
    ));

    // 4. Encrypted ODT manifest -> PasswordProtected
    let enc_manifest = r#"<?xml version="1.0"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml">
    <manifest:encryption-data manifest:checksum-type="SHA256"/>
  </manifest:file-entry>
</manifest:manifest>"#;
    let enc_odt = build_test_zip(&[
        TestZipEntry::stored("mimetype", b"application/vnd.oasis.opendocument.text"),
        TestZipEntry::deflate("META-INF/manifest.xml", enc_manifest.as_bytes()),
        TestZipEntry::deflate("Thumbnails/thumbnail.png", &png),
    ]);
    let enc_odt_path = write_temp_file(dir.path(), "locked.odt", &enc_odt);
    assert!(matches!(
        extract_thumbnail(&enc_odt_path, "odt", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));

    // 5. Encrypted OOXML (OLE2 + EncryptedPackage) -> PasswordProtected
    let mut ole_enc = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    ole_enc.extend_from_slice(&[0u8; 32]);
    for ch in "EncryptedPackage".encode_utf16() {
        ole_enc.extend_from_slice(&ch.to_le_bytes());
    }
    let ole_enc_path = write_temp_file(dir.path(), "locked.docx", &ole_enc);
    assert!(matches!(
        extract_thumbnail(&ole_enc_path, "docx", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));

    // 6. Content mismatch (plain text disguised as .hwpx) -> ContentMismatch
    let mismatch_path = write_temp_file(dir.path(), "fake.hwpx", b"not a zip at all");
    assert!(matches!(
        extract_thumbnail(&mismatch_path, "hwpx", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Rejected {
            reject_code: RejectCode::ContentMismatch,
            ..
        }
    ));

    // 7. OLE2 .hwp -> Fallback(UnsupportedFormat) (handled by HWP5 WASM)
    let ole_hwp_path = write_temp_file(
        dir.path(),
        "real.hwp",
        &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0],
    );
    assert_eq!(
        extract_thumbnail(&ole_hwp_path, "hwp", None, &AtomicBool::new(false)).unwrap(),
        ThumbnailResult::Fallback {
            fallback_reason: FallbackReason::UnsupportedFormat,
        }
    );
}

fn build_ole_bytes(streams: &[(&str, &[u8])]) -> Vec<u8> {
    let mut comp =
        cfb::CompoundFile::create_with_version(cfb::Version::V3, Cursor::new(Vec::new())).unwrap();
    for (name, data) in streams {
        let mut s = comp.create_stream(name).unwrap();
        s.write_all(data).unwrap();
    }
    comp.flush().unwrap();
    comp.into_inner().into_inner()
}

fn ppt_record(ver: u8, inst: u16, rec_type: u16, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + payload.len());
    let ver_inst = (u16::from(ver) & 0x000F) | (inst << 4);
    out.extend_from_slice(&ver_inst.to_le_bytes());
    out.extend_from_slice(&rec_type.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out
}

fn utf16le_bytes(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() * 2);
    for u in s.encode_utf16() {
        out.extend_from_slice(&u.to_le_bytes());
    }
    out
}

struct SyntheticDocSpec<'a> {
    n_fib: u16,
    flags: u16,
    body_cp1252: &'a [u8],
    body_utf16: &'a str,
    header_utf16: &'a str,
    textbox_utf16: &'a str,
    hdr_textbox_utf16: &'a str,
    delete_first_body_bytes: Option<(usize, usize)>,
    ttp_last_body_byte: bool,
}

fn build_synthetic_doc(spec: &SyntheticDocSpec<'_>) -> Vec<u8> {
    // Build WordDocument stream with 512-byte-aligned text and optional FKP pages.
    let mut word_doc = vec![0u8; 512];
    word_doc[0..2].copy_from_slice(&0xA5ECu16.to_le_bytes());
    word_doc[2..4].copy_from_slice(&spec.n_fib.to_le_bytes());
    word_doc[10..12].copy_from_slice(&spec.flags.to_le_bytes());

    // FibRgW97 (14 words = 28 bytes), FibRgLw97 (22 dwords = 88 bytes), FibRgFcLcb97 (34 pairs = 272 bytes)
    let mut off = 32usize;
    word_doc[off..off + 2].copy_from_slice(&14u16.to_le_bytes());
    off += 2 + 28;

    word_doc[off..off + 2].copy_from_slice(&22u16.to_le_bytes());
    let lw_start = off + 2;
    off = lw_start + 88;

    word_doc[off..off + 2].copy_from_slice(&34u16.to_le_bytes());
    let pairs_start = off + 2;

    // Text payload starts at byte 512 (even offset so compressed fc = byte_off * 2 works cleanly).
    let p0_start = word_doc.len();
    word_doc.extend_from_slice(spec.body_cp1252);
    if word_doc.len() % 2 == 1 {
        word_doc.push(0);
    }

    let p1_start = word_doc.len();
    let body_u16 = utf16le_bytes(spec.body_utf16);
    word_doc.extend_from_slice(&body_u16);

    let p2_start = word_doc.len();
    let hdr_u16 = utf16le_bytes(spec.header_utf16);
    word_doc.extend_from_slice(&hdr_u16);

    let p3_start = word_doc.len();
    let txbx_u16 = utf16le_bytes(spec.textbox_utf16);
    word_doc.extend_from_slice(&txbx_u16);

    let p4_start = word_doc.len();
    let hdr_txbx_u16 = utf16le_bytes(spec.hdr_textbox_utf16);
    word_doc.extend_from_slice(&hdr_txbx_u16);

    // Pad to 512-byte boundary for optional FKP pages.
    while word_doc.len() % 512 != 0 {
        word_doc.push(0);
    }

    let mut table = Vec::new();

    // Optional CHPX FKP page marking a deleted range inside body_cp1252.
    if let Some((del_rel_start, del_rel_end)) = spec.delete_first_body_bytes {
        let chpx_pn = (word_doc.len() / 512) as u32;
        let mut fkp = vec![0u8; 512];
        let rg0 = (p0_start + del_rel_start) as u32;
        let rg1 = (p0_start + del_rel_end) as u32;
        fkp[0..4].copy_from_slice(&rg0.to_le_bytes());
        fkp[4..8].copy_from_slice(&rg1.to_le_bytes());
        // crun = 1 -> rgb offset at (1 + 1) * 4 = 8; point to word offset 20 (byte 40)
        fkp[8] = 20;
        // chpx at byte 40: cb = 3, sprmCFRMarkDel (0x0800), operand = 1
        fkp[40] = 3;
        fkp[41..43].copy_from_slice(&0x0800u16.to_le_bytes());
        fkp[43] = 1;
        fkp[511] = 1;
        word_doc.extend_from_slice(&fkp);

        let fc_chpx = table.len() as u32;
        table.extend_from_slice(&rg0.to_le_bytes());
        table.extend_from_slice(&rg1.to_le_bytes());
        table.extend_from_slice(&chpx_pn.to_le_bytes());
        let lcb_chpx = 12u32;
        let pair12 = pairs_start + 12 * 8;
        word_doc[pair12..pair12 + 4].copy_from_slice(&fc_chpx.to_le_bytes());
        word_doc[pair12 + 4..pair12 + 8].copy_from_slice(&lcb_chpx.to_le_bytes());
    }

    // Optional PAPX FKP page marking the last byte of body_cp1252 with sprmPFTtp (0x2417).
    if spec.ttp_last_body_byte && !spec.body_cp1252.is_empty() {
        let papx_pn = (word_doc.len() / 512) as u32;
        let mut fkp = vec![0u8; 512];
        let rg0 = (p0_start + spec.body_cp1252.len() - 1) as u32;
        let rg1 = (p0_start + spec.body_cp1252.len()) as u32;
        fkp[0..4].copy_from_slice(&rg0.to_le_bytes());
        fkp[4..8].copy_from_slice(&rg1.to_le_bytes());
        // bx at (1 + 1) * 4 = 8: bOffset = 20 (byte 40)
        fkp[8] = 20;
        // papx at byte 40: cb = 3 -> len = 2*3 - 1 = 5 bytes: istd(2) + sprmPFTtp(2) + op(1)
        fkp[40] = 3;
        fkp[41..43].copy_from_slice(&0u16.to_le_bytes());
        fkp[43..45].copy_from_slice(&0x2417u16.to_le_bytes());
        fkp[45] = 1;
        fkp[511] = 1;
        word_doc.extend_from_slice(&fkp);

        let fc_papx = table.len() as u32;
        table.extend_from_slice(&rg0.to_le_bytes());
        table.extend_from_slice(&rg1.to_le_bytes());
        table.extend_from_slice(&papx_pn.to_le_bytes());
        let lcb_papx = 12u32;
        let pair13 = pairs_start + 13 * 8;
        word_doc[pair13..pair13 + 4].copy_from_slice(&fc_papx.to_le_bytes());
        word_doc[pair13 + 4..pair13 + 8].copy_from_slice(&lcb_papx.to_le_bytes());
    }

    let c0 = spec.body_cp1252.len() as u32;
    let c1 = spec.body_utf16.encode_utf16().count() as u32;
    let c_body = c0 + c1;
    let c_hdr = spec.header_utf16.encode_utf16().count() as u32;
    let c_txbx = spec.textbox_utf16.encode_utf16().count() as u32;
    let c_hdr_txbx = spec.hdr_textbox_utf16.encode_utf16().count() as u32;

    word_doc[lw_start + 3 * 4..lw_start + 4 * 4].copy_from_slice(&c_body.to_le_bytes());
    word_doc[lw_start + 5 * 4..lw_start + 6 * 4].copy_from_slice(&c_hdr.to_le_bytes());
    word_doc[lw_start + 9 * 4..lw_start + 10 * 4].copy_from_slice(&c_txbx.to_le_bytes());
    word_doc[lw_start + 10 * 4..lw_start + 11 * 4].copy_from_slice(&c_hdr_txbx.to_le_bytes());

    // Build piece entries (only non-empty stories).
    let mut pieces: Vec<(u32, u32, bool)> = Vec::new();
    if c0 > 0 {
        pieces.push((c0, p0_start as u32, true));
    }
    if c1 > 0 {
        pieces.push((c1, p1_start as u32, false));
    }
    if c_hdr > 0 {
        pieces.push((c_hdr, p2_start as u32, false));
    }
    if c_txbx > 0 {
        pieces.push((c_txbx, p3_start as u32, false));
    }
    if c_hdr_txbx > 0 {
        pieces.push((c_hdr_txbx, p4_start as u32, false));
    }

    let fc_clx = table.len() as u32;
    // Include one Prc record (0x01) before Pcdt (0x02) to exercise Prc skipping.
    table.push(0x01);
    table.extend_from_slice(&2u16.to_le_bytes());
    table.extend_from_slice(&[0u8, 0u8]);

    let plc_len = (4 + pieces.len() * 12) as u32;
    table.push(0x02);
    table.extend_from_slice(&plc_len.to_le_bytes());

    let mut cur_cp = 0u32;
    table.extend_from_slice(&cur_cp.to_le_bytes());
    for &(len, _, _) in &pieces {
        cur_cp += len;
        table.extend_from_slice(&cur_cp.to_le_bytes());
    }
    for &(_, byte_off, compressed) in &pieces {
        table.extend_from_slice(&0u16.to_le_bytes());
        let fc_field = if compressed {
            (byte_off * 2) | 0x4000_0000
        } else {
            byte_off
        };
        table.extend_from_slice(&fc_field.to_le_bytes());
        table.extend_from_slice(&0u16.to_le_bytes());
    }
    let lcb_clx = (table.len() as u32) - fc_clx;

    let pair33 = pairs_start + 33 * 8;
    word_doc[pair33..pair33 + 4].copy_from_slice(&fc_clx.to_le_bytes());
    word_doc[pair33 + 4..pair33 + 8].copy_from_slice(&lcb_clx.to_le_bytes());

    let table_name = if (spec.flags & 0x0200) != 0 {
        "/1Table"
    } else {
        "/0Table"
    };
    build_ole_bytes(&[("/WordDocument", &word_doc), (table_name, &table)])
}

#[test]
fn extract_legacy_doc_real_fixture_with_budget_and_tokenize() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/legacy-sample.doc");
    assert!(fixture.exists(), "missing fixture: {}", fixture.display());

    let res = extract_file(
        &fixture,
        "doc",
        &ExtractOptions {
            tokenize: true,
            ..ExtractOptions::default()
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    match res {
        ExtractResult::Ok { text, tokens } => {
            assert_eq!(
                text,
                "Legacy Report\nLegacy DOC body text\nSecond paragraph from Word 97-2003."
            );
            let toks = tokens.expect("tokens requested");
            assert!(toks.bi.contains("legacy"));
            assert!(toks.bi.contains("report"));
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    // maxChars: 0 returns empty string
    let zero = extract_file(
        &fixture,
        "doc",
        &ExtractOptions {
            max_chars: Some(0),
            ..ExtractOptions::default()
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        zero,
        ExtractResult::Ok {
            text: String::new(),
            tokens: None
        }
    );

    // Positive maxChars truncates cleanly by UTF-16 units
    let capped = extract_file(
        &fixture,
        "doc",
        &ExtractOptions {
            max_chars: Some(13),
            ..ExtractOptions::default()
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        capped,
        ExtractResult::Ok {
            text: "Legacy Report".to_owned(),
            tokens: None
        }
    );
}

#[test]
fn extract_legacy_doc_synthetic_unicode_cp1252_textboxes_fields_chpx_and_papx() {
    let dir = tempdir().unwrap();
    // CP1252: "DEL" (to be deleted by CHPX) + "Keep € \x93quote\x94\x07cell\x07" (last \x07 -> \n by PAPX sprmPFTtp)
    let body_cp1252 = b"DELKeep \x80 \x93quote\x94\x07cell\x07";
    // UTF-16LE with nested field + Korean text
    let body_utf16 = "\u{0013} HYPERLINK \"https://example.com\" \u{0014}한글 링크\u{0015}\r두 번째 문단\r";
    let header_utf16 = "Header Excluded\r";
    let textbox_utf16 = "본문 텍스트상자\r";
    let hdr_textbox_utf16 = "Header Textbox Excluded\r";

    let doc_bytes = build_synthetic_doc(&SyntheticDocSpec {
        n_fib: 0x00C1,
        flags: 0x0200, // 1Table
        body_cp1252,
        body_utf16,
        header_utf16,
        textbox_utf16,
        hdr_textbox_utf16,
        delete_first_body_bytes: Some((0, 3)),
        ttp_last_body_byte: true,
    });
    let path = write_temp_file(dir.path(), "synthetic.doc", &doc_bytes);

    let res = extract_file(
        &path,
        "doc",
        &ExtractOptions {
            tokenize: true,
            ..ExtractOptions::default()
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    match res {
        ExtractResult::Ok { text, tokens } => {
            assert!(!text.contains("DEL"), "CHPX deletion should be removed: {text:?}");
            assert!(text.contains("Keep \u{20AC} \u{201C}quote\u{201D}\tcell\n"));
            assert!(text.contains("한글 링크"));
            assert!(!text.contains("HYPERLINK"));
            assert!(text.contains("두 번째 문단"));
            assert!(text.contains("본문 텍스트상자"));
            assert!(!text.contains("Header Excluded"));
            assert!(!text.contains("Header Textbox Excluded"));
            let toks = tokens.unwrap();
            assert!(toks.bi.contains("한글"));
            assert!(toks.bi.contains("본문"));
        }
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn extract_legacy_doc_rejects_encrypted_pre97_and_corrupt_inputs() {
    let dir = tempdir().unwrap();

    // 1. Encrypted Word 97-2003 (FibBase.fEncrypted = 0x0100)
    let enc_doc = build_synthetic_doc(&SyntheticDocSpec {
        n_fib: 0x00C1,
        flags: 0x0300, // fEncrypted | 1Table
        body_cp1252: b"Secret\r",
        body_utf16: "",
        header_utf16: "",
        textbox_utf16: "",
        hdr_textbox_utf16: "",
        delete_first_body_bytes: None,
        ttp_last_body_byte: false,
    });
    let enc_path = write_temp_file(dir.path(), "enc.doc", &enc_doc);
    assert!(matches!(
        extract_file(&enc_path, "doc", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));

    // 2. Encrypted OOXML package disguised under .doc
    let enc_pkg = build_ole_bytes(&[("/EncryptedPackage", &[0u8; 64])]);
    let enc_pkg_path = write_temp_file(dir.path(), "enc-ooxml.doc", &enc_pkg);
    assert!(matches!(
        extract_file(&enc_pkg_path, "doc", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));

    // 3. Word 95 (nFib = 0x0065 < 0x00C1) -> Corrupt
    let pre97 = build_synthetic_doc(&SyntheticDocSpec {
        n_fib: 0x0065,
        flags: 0x0200,
        body_cp1252: b"Old\r",
        body_utf16: "",
        header_utf16: "",
        textbox_utf16: "",
        hdr_textbox_utf16: "",
        delete_first_body_bytes: None,
        ttp_last_body_byte: false,
    });
    let pre97_path = write_temp_file(dir.path(), "word95.doc", &pre97);
    assert!(matches!(
        extract_file(&pre97_path, "doc", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::Corrupt,
            ..
        }
    ));

    // 4. Malformed piece table with out-of-bounds offset -> Corrupt
    let mut bad_wd = vec![0u8; 512];
    bad_wd[0..2].copy_from_slice(&0xA5ECu16.to_le_bytes());
    bad_wd[2..4].copy_from_slice(&0x00C1u16.to_le_bytes());
    bad_wd[10..12].copy_from_slice(&0x0200u16.to_le_bytes());
    bad_wd[32..34].copy_from_slice(&14u16.to_le_bytes());
    let lw = 32 + 2 + 28;
    bad_wd[lw..lw + 2].copy_from_slice(&22u16.to_le_bytes());
    bad_wd[lw + 2 + 3 * 4..lw + 2 + 4 * 4].copy_from_slice(&5u32.to_le_bytes()); // ccpText = 5
    let ps = lw + 2 + 88;
    bad_wd[ps..ps + 2].copy_from_slice(&34u16.to_le_bytes());
    let mut bad_tbl = Vec::new();
    bad_tbl.push(0x02);
    bad_tbl.extend_from_slice(&16u32.to_le_bytes()); // 1 piece
    bad_tbl.extend_from_slice(&0u32.to_le_bytes());
    bad_tbl.extend_from_slice(&5u32.to_le_bytes());
    bad_tbl.extend_from_slice(&0u16.to_le_bytes());
    bad_tbl.extend_from_slice(&(999_999u32).to_le_bytes()); // way past WordDocument len
    bad_tbl.extend_from_slice(&0u16.to_le_bytes());
    let p33 = ps + 2 + 33 * 8;
    bad_wd[p33..p33 + 4].copy_from_slice(&0u32.to_le_bytes());
    bad_wd[p33 + 4..p33 + 8].copy_from_slice(&(bad_tbl.len() as u32).to_le_bytes());
    let bad_piece_path = write_temp_file(
        dir.path(),
        "bad-piece.doc",
        &build_ole_bytes(&[("/WordDocument", &bad_wd), ("/1Table", &bad_tbl)]),
    );
    assert!(matches!(
        extract_file(&bad_piece_path, "doc", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::Corrupt,
            ..
        }
    ));

    // 5. Non-OLE2 / non-ZIP plain text named .doc -> ContentMismatch
    let mismatch_path = write_temp_file(dir.path(), "plain.doc", b"plain text");
    assert!(matches!(
        extract_file(&mismatch_path, "doc", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::ContentMismatch,
            ..
        }
    ));
}

fn build_synthetic_ppt_with_notes_and_incremental() -> Vec<u8> {
    // Helper to wrap a textbox inside OfficeArtSpContainer -> OfficeArtSpgrContainer -> OfficeArtDgContainer -> RT_Drawing
    let make_sp_textbox = |inner: Vec<u8>, placeholder_id: Option<u8>| -> Vec<u8> {
        let mut sp_children = Vec::new();
        if let Some(ph) = placeholder_id {
            let mut ph_payload = vec![0u8; 8];
            ph_payload[4] = ph;
            let ph_atom = ppt_record(0, 0, 0x0BC3, &ph_payload);
            sp_children.extend_from_slice(&ppt_record(0xF, 0, 0xF011, &ph_atom));
        }
        sp_children.extend_from_slice(&ppt_record(0, 0, 0xF00D, &inner));
        ppt_record(0xF, 0, 0xF004, &sp_children)
    };

    let make_slide_atom = |notes_id_ref: u32| -> Vec<u8> {
        let mut payload = vec![0u8; 24];
        payload[16..20].copy_from_slice(&notes_id_ref.to_le_bytes());
        ppt_record(2, 0, 0x03EF, &payload)
    };

    // Slide 1 (stale generation, persistId 2) -> will be superseded by incremental edit
    let stale_tb = ppt_record(0, 0, 0x0FA0, &utf16le_bytes("STALE SLIDE TEXT"));
    let stale_sp = make_sp_textbox(stale_tb, None);
    let stale_dg = ppt_record(0xF, 0, 0xF002, &ppt_record(0xF, 0, 0xF003, &stale_sp));
    let mut stale_slide_body = make_slide_atom(0);
    stale_slide_body.extend_from_slice(&ppt_record(0xF, 0, 0x040C, &stale_dg));
    let stale_slide = ppt_record(0xF, 0, 0x03EE, &stale_slide_body);

    // Slide 1 (live generation, persistId 2): OutlineTextRefAtom(0) + nested group with CP1252 TextBytesAtom, notesIdRef = 500
    let s1_outline_tb = ppt_record(0, 0, 0x0F9E, &0u32.to_le_bytes());
    let s1_cp1252_tb = ppt_record(0, 0, 0x0FA8, b"Caf\xe9 \x8010");
    let nested_group = ppt_record(0xF, 0, 0xF003, &make_sp_textbox(s1_cp1252_tb, None));
    let mut outer_group_body = make_sp_textbox(s1_outline_tb, None);
    outer_group_body.extend_from_slice(&nested_group);
    let s1_dg = ppt_record(0xF, 0, 0xF002, &ppt_record(0xF, 0, 0xF003, &outer_group_body));
    let mut s1_body = make_slide_atom(500);
    s1_body.extend_from_slice(&ppt_record(0xF, 0, 0x040C, &s1_dg));
    let live_slide1 = ppt_record(0xF, 0, 0x03EE, &s1_body);

    // Slide 2 (persistId 3): UTF-16LE Korean body, no notes
    let s2_tb = ppt_record(0, 0, 0x0FA0, &utf16le_bytes("두 번째 슬라이드\r본문 줄"));
    let s2_dg = ppt_record(0xF, 0, 0xF002, &ppt_record(0xF, 0, 0xF003, &make_sp_textbox(s2_tb, None)));
    let mut s2_body = make_slide_atom(0);
    s2_body.extend_from_slice(&ppt_record(0xF, 0, 0x040C, &s2_dg));
    let slide2 = ppt_record(0xF, 0, 0x03EE, &s2_body);

    // Notes for Slide 1 (persistId 4, slideId 500): includes SlideNumber placeholder (skipped) + NotesBody placeholder (kept)
    let mut num_tb = ppt_record(0, 0, 0x0FA8, b"*");
    num_tb.extend_from_slice(&ppt_record(0, 0, 0x0FD8, &0u32.to_le_bytes()));
    let num_sp = make_sp_textbox(num_tb, Some(15));
    let notes_tb = ppt_record(0, 0, 0x0FA0, &utf16le_bytes("발표자 메모 내용"));
    let notes_sp = make_sp_textbox(notes_tb, Some(12));
    let mut notes_grp = num_sp;
    notes_grp.extend_from_slice(&notes_sp);
    let notes_dg = ppt_record(0xF, 0, 0xF002, &ppt_record(0xF, 0, 0xF003, &notes_grp));
    let notes_rec = ppt_record(0xF, 0, 0x03F0, &ppt_record(0xF, 0, 0x040C, &notes_dg));

    // DocumentContainer (persistId 1) with SlideListWithText (instance 0 = slides, instance 2 = notes)
    let make_persist_atom = |persist_id_ref: u32, slide_id: u32| -> Vec<u8> {
        let mut p = vec![0u8; 20];
        p[0..4].copy_from_slice(&persist_id_ref.to_le_bytes());
        p[12..16].copy_from_slice(&slide_id.to_le_bytes());
        ppt_record(0, 0, 0x03F3, &p)
    };
    let mut slwt_slides = Vec::new();
    slwt_slides.extend_from_slice(&make_persist_atom(2, 256));
    slwt_slides.extend_from_slice(&ppt_record(0, 0, 0x0FA0, &utf16le_bytes("발표 제목")));
    slwt_slides.extend_from_slice(&make_persist_atom(3, 257));
    let slwt0 = ppt_record(0xF, 0, 0x0FF0, &slwt_slides);

    let slwt2 = ppt_record(0xF, 2, 0x0FF0, &make_persist_atom(4, 500));
    let mut doc_body = slwt0;
    doc_body.extend_from_slice(&slwt2);
    let doc_rec = ppt_record(0xF, 0, 0x03E8, &doc_body);

    // Assemble PowerPoint Document stream with 2 edit generations.
    let mut ppt_doc = Vec::new();
    let doc_off = ppt_doc.len() as u32;
    ppt_doc.extend_from_slice(&doc_rec);
    let stale_s1_off = ppt_doc.len() as u32;
    ppt_doc.extend_from_slice(&stale_slide);
    let s2_off = ppt_doc.len() as u32;
    ppt_doc.extend_from_slice(&slide2);
    let notes_off = ppt_doc.len() as u32;
    ppt_doc.extend_from_slice(&notes_rec);

    // Generation 1 PersistDirectoryAtom (persistIds 1..=4 -> doc, stale_s1, s2, notes)
    let pd1_off = ppt_doc.len() as u32;
    let mut pd1_payload = Vec::new();
    pd1_payload.extend_from_slice(&((4u32 << 20) | 1u32).to_le_bytes());
    pd1_payload.extend_from_slice(&doc_off.to_le_bytes());
    pd1_payload.extend_from_slice(&stale_s1_off.to_le_bytes());
    pd1_payload.extend_from_slice(&s2_off.to_le_bytes());
    pd1_payload.extend_from_slice(&notes_off.to_le_bytes());
    ppt_doc.extend_from_slice(&ppt_record(0, 0, 0x1772, &pd1_payload));

    let uea1_off = ppt_doc.len() as u32;
    let mut uea1_payload = vec![0u8; 28];
    uea1_payload[8..12].copy_from_slice(&0u32.to_le_bytes()); // offsetLastEdit = 0
    uea1_payload[12..16].copy_from_slice(&pd1_off.to_le_bytes());
    uea1_payload[16..20].copy_from_slice(&1u32.to_le_bytes()); // docPersistIdRef = 1
    ppt_doc.extend_from_slice(&ppt_record(0, 0, 0x0FF5, &uea1_payload));

    // Generation 2: live Slide 1 overrides persistId 2
    let live_s1_off = ppt_doc.len() as u32;
    ppt_doc.extend_from_slice(&live_slide1);
    let pd2_off = ppt_doc.len() as u32;
    let mut pd2_payload = Vec::new();
    pd2_payload.extend_from_slice(&((1u32 << 20) | 2u32).to_le_bytes());
    pd2_payload.extend_from_slice(&live_s1_off.to_le_bytes());
    ppt_doc.extend_from_slice(&ppt_record(0, 0, 0x1772, &pd2_payload));

    let uea2_off = ppt_doc.len() as u32;
    let mut uea2_payload = vec![0u8; 28];
    uea2_payload[8..12].copy_from_slice(&uea1_off.to_le_bytes());
    uea2_payload[12..16].copy_from_slice(&pd2_off.to_le_bytes());
    uea2_payload[16..20].copy_from_slice(&1u32.to_le_bytes());
    ppt_doc.extend_from_slice(&ppt_record(0, 0, 0x0FF5, &uea2_payload));

    // Current User stream pointing to uea2_off
    let mut cu_payload = vec![0u8; 20];
    cu_payload[0..4].copy_from_slice(&20u32.to_le_bytes());
    cu_payload[4..8].copy_from_slice(&0xE391_C05Fu32.to_le_bytes());
    cu_payload[8..12].copy_from_slice(&uea2_off.to_le_bytes());
    cu_payload[14..16].copy_from_slice(&0x03F4u16.to_le_bytes());
    cu_payload[16] = 3;
    let cu = ppt_record(0, 0, 0x0FF6, &cu_payload);

    build_ole_bytes(&[("/Current User", &cu), ("/PowerPoint Document", &ppt_doc)])
}

#[test]
fn extract_legacy_ppt_real_fixture_with_budget_and_tokenize() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/legacy-sample.ppt");
    assert!(fixture.exists(), "missing fixture: {}", fixture.display());

    let res = extract_file(
        &fixture,
        "ppt",
        &ExtractOptions {
            tokenize: true,
            ..ExtractOptions::default()
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    match res {
        ExtractResult::Ok { text, tokens } => {
            assert_eq!(
                text,
                "## Slide 1\nLegacy PPT title\nFirst slide body\n\n## Slide 2\nSecond legacy slide"
            );
            let toks = tokens.expect("tokens requested");
            assert!(toks.bi.contains("legacy"));
            assert!(toks.bi.contains("slide"));
        }
        other => panic!("expected Ok, got {other:?}"),
    }

    let zero = extract_file(
        &fixture,
        "ppt",
        &ExtractOptions {
            max_chars: Some(0),
            ..ExtractOptions::default()
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        zero,
        ExtractResult::Ok {
            text: String::new(),
            tokens: None
        }
    );
}

#[test]
fn extract_legacy_ppt_synthetic_slides_cp1252_outline_incremental_and_notes() {
    let dir = tempdir().unwrap();
    let ppt_bytes = build_synthetic_ppt_with_notes_and_incremental();
    let path = write_temp_file(dir.path(), "synthetic.ppt", &ppt_bytes);

    let res = extract_file(
        &path,
        "ppt",
        &ExtractOptions {
            tokenize: true,
            ..ExtractOptions::default()
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    match res {
        ExtractResult::Ok { text, tokens } => {
            assert_eq!(
                text,
                "## Slide 1\n발표 제목\nCaf\u{00E9} \u{20AC}10\n### Notes\n발표자 메모 내용\n\n## Slide 2\n두 번째 슬라이드\n본문 줄"
            );
            assert!(!text.contains("STALE SLIDE TEXT"));
            let toks = tokens.unwrap();
            assert!(toks.bi.contains("발표"));
            assert!(toks.bi.contains("메모"));
        }
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn extract_legacy_ppt_rejects_encrypted_pre97_zip_and_corrupt_inputs() {
    let dir = tempdir().unwrap();

    // 1. ZIP named .ppt -> ContentMismatch
    let zip = build_test_zip(&[TestZipEntry::stored("test.txt", b"hello")]);
    let zip_ppt = write_temp_file(dir.path(), "fake.ppt", &zip);
    assert!(matches!(
        extract_file(&zip_ppt, "ppt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::ContentMismatch,
            ..
        }
    ));

    // 2. Encrypted CurrentUserAtom token (0xF3D1C4DF) -> PasswordProtected
    let mut enc_cu = vec![0u8; 20];
    enc_cu[4..8].copy_from_slice(&0xF3D1_C4DFu32.to_le_bytes());
    let enc_ppt1 = build_ole_bytes(&[
        ("/Current User", &ppt_record(0, 0, 0x0FF6, &enc_cu)),
        ("/PowerPoint Document", &[]),
    ]);
    let enc_path1 = write_temp_file(dir.path(), "enc-cu.ppt", &enc_ppt1);
    assert!(matches!(
        extract_file(&enc_path1, "ppt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));

    // 3. EncryptedSummary stream -> PasswordProtected
    let enc_ppt2 = build_ole_bytes(&[
        ("/EncryptedSummary", &[1, 2, 3, 4]),
        ("/PowerPoint Document", &[]),
    ]);
    let enc_path2 = write_temp_file(dir.path(), "enc-summary.ppt", &enc_ppt2);
    assert!(matches!(
        extract_file(&enc_path2, "ppt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));

    // 4. RT_CryptSession10Container (0x2F14) in PowerPoint Document -> PasswordProtected
    let mut valid_cu = vec![0u8; 20];
    valid_cu[4..8].copy_from_slice(&0xE391_C05Fu32.to_le_bytes());
    valid_cu[16] = 3;
    let crypt_rec = ppt_record(0xF, 0, 0x2F14, &[0u8; 8]);
    let enc_ppt3 = build_ole_bytes(&[
        ("/Current User", &ppt_record(0, 0, 0x0FF6, &valid_cu)),
        ("/PowerPoint Document", &crypt_rec),
    ]);
    let enc_path3 = write_temp_file(dir.path(), "enc-crypt10.ppt", &enc_ppt3);
    assert!(matches!(
        extract_file(&enc_path3, "ppt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::PasswordProtected,
            ..
        }
    ));

    // 5. PowerPoint 95 (PP40 stream only) -> Corrupt
    let pre97_ppt = build_ole_bytes(&[("/PP40", &[0u8; 64])]);
    let pre97_path = write_temp_file(dir.path(), "ppt95.ppt", &pre97_ppt);
    assert!(matches!(
        extract_file(&pre97_path, "ppt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::Corrupt,
            ..
        }
    ));

    // 6. Cyclic UserEditAtom chain -> Corrupt
    let mut cyc_uea = vec![0u8; 28];
    cyc_uea[8..12].copy_from_slice(&0u32.to_le_bytes()); // wait: 0 means end, point to self via non-zero offset
    let pad = ppt_record(0, 0, 0x03EA, &[]);
    let uea_off = pad.len() as u32;
    let pd_off = uea_off + 8 + 28;
    cyc_uea[8..12].copy_from_slice(&uea_off.to_le_bytes()); // self cycle
    cyc_uea[12..16].copy_from_slice(&pd_off.to_le_bytes());
    let mut pd_pay = Vec::new();
    pd_pay.extend_from_slice(&((1u32 << 20) | 1u32).to_le_bytes());
    pd_pay.extend_from_slice(&0u32.to_le_bytes());
    let mut cyc_doc = pad;
    cyc_doc.extend_from_slice(&ppt_record(0, 0, 0x0FF5, &cyc_uea));
    cyc_doc.extend_from_slice(&ppt_record(0, 0, 0x1772, &pd_pay));
    let mut cyc_cu = vec![0u8; 20];
    cyc_cu[4..8].copy_from_slice(&0xE391_C05Fu32.to_le_bytes());
    cyc_cu[8..12].copy_from_slice(&uea_off.to_le_bytes());
    cyc_cu[16] = 3;
    let cyc_path = write_temp_file(
        dir.path(),
        "cyclic.ppt",
        &build_ole_bytes(&[
            ("/Current User", &ppt_record(0, 0, 0x0FF6, &cyc_cu)),
            ("/PowerPoint Document", &cyc_doc),
        ]),
    );
    assert!(matches!(
        extract_file(&cyc_path, "ppt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::Corrupt,
            ..
        }
    ));

    // 7. Record claiming length past stream end -> Corrupt
    let mut trunc_doc = vec![0u8; 8];
    trunc_doc[2..4].copy_from_slice(&0x03EEu16.to_le_bytes());
    trunc_doc[4..8].copy_from_slice(&999_999u32.to_le_bytes());
    let trunc_path = write_temp_file(
        dir.path(),
        "trunc.ppt",
        &build_ole_bytes(&[
            ("/Current User", &ppt_record(0, 0, 0x0FF6, &valid_cu)),
            ("/PowerPoint Document", &trunc_doc),
        ]),
    );
    assert!(matches!(
        extract_file(&trunc_path, "ppt", &ExtractOptions::default(), &AtomicBool::new(false)).unwrap(),
        ExtractResult::Rejected {
            reject_code: RejectCode::Corrupt,
            ..
        }
    ));
}
