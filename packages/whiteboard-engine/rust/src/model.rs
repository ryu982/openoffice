use crate::error::{OpenError, OpenErrorCode};
use crate::image_format::ImageMime;
use crate::ordering::{initial_order_key, is_valid_order_key};
use crate::rich_text::{RichText, TextAlign};
use crate::table::TableProps;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashSet};

pub const CURRENT_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_PAPER_COLOR: &str = "#FFFFFF";
pub const DEFAULT_FREEFORM_WIDTH: f64 = 1920.0;
pub const DEFAULT_FREEFORM_HEIGHT: f64 = 1080.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageFormat {
    Freeform,
    Wide169,
    A4Portrait,
    A4Landscape,
    Custom,
}

// Custom serde aliases so JSON uses exact `wide_16_9` spelling from spec §4.2.
impl PageFormat {
    pub fn default_size(self) -> (f64, f64) {
        match self {
            Self::Freeform => (DEFAULT_FREEFORM_WIDTH, DEFAULT_FREEFORM_HEIGHT),
            Self::Wide169 => (1920.0, 1080.0),
            Self::A4Portrait => (1123.0, 1587.0),
            Self::A4Landscape => (1587.0, 1123.0),
            Self::Custom => (1920.0, 1080.0),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PageFormatWire {
    #[serde(rename = "freeform")]
    Freeform,
    #[serde(rename = "wide_16_9")]
    Wide169,
    #[serde(rename = "a4_portrait")]
    A4Portrait,
    #[serde(rename = "a4_landscape")]
    A4Landscape,
    #[serde(rename = "custom")]
    Custom,
}

impl From<PageFormatWire> for PageFormat {
    fn from(v: PageFormatWire) -> Self {
        match v {
            PageFormatWire::Freeform => Self::Freeform,
            PageFormatWire::Wide169 => Self::Wide169,
            PageFormatWire::A4Portrait => Self::A4Portrait,
            PageFormatWire::A4Landscape => Self::A4Landscape,
            PageFormatWire::Custom => Self::Custom,
        }
    }
}

impl From<PageFormat> for PageFormatWire {
    fn from(v: PageFormat) -> Self {
        match v {
            PageFormat::Freeform => Self::Freeform,
            PageFormat::Wide169 => Self::Wide169,
            PageFormat::A4Portrait => Self::A4Portrait,
            PageFormat::A4Landscape => Self::A4Landscape,
            PageFormat::Custom => Self::Custom,
        }
    }
}

mod page_format_serde {
    use super::{PageFormat, PageFormatWire};
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(v: &PageFormat, s: S) -> Result<S::Ok, S::Error> {
        PageFormatWire::from(*v).serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<PageFormat, D::Error> {
        Ok(PageFormatWire::deserialize(d)?.into())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridPattern {
    Dot,
    Line,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PageBackground {
    Solid {
        color: String,
    },
    Grid {
        color: String,
        pattern: GridPattern,
    },
    Image {
        #[serde(rename = "resourceId")]
        resource_id: String,
        width: f64,
        height: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectKind {
    Sticky,
    Text,
    Shape,
    Connector,
    Stroke,
    Image,
    Table,
    Sticker,
    Link,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    Rectangle,
    RoundedRectangle,
    Ellipse,
    Triangle,
    Diamond,
    Star,
    SpeechBubble,
    BlockArrow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorRouting {
    #[default]
    Straight,
    Elbow,
    Curved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorHead {
    #[default]
    None,
    Arrow,
    Triangle,
    Circle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LineStyle {
    #[default]
    Solid,
    Dashed,
    Dotted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrokeTool {
    Pen,
    Highlighter,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConnectorEnd {
    Anchor {
        #[serde(rename = "objectId")]
        object_id: String,
        #[serde(rename = "anchorX", skip_serializing_if = "Option::is_none")]
        anchor_x: Option<f64>,
        #[serde(rename = "anchorY", skip_serializing_if = "Option::is_none")]
        anchor_y: Option<f64>,
    },
    Point {
        x: f64,
        y: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyProps {
    pub color: String,
    #[serde(default)]
    pub text: RichText,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<TextAlign>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextProps {
    #[serde(default)]
    pub text: RichText,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<TextAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeProps {
    pub shape: ShapeKind,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_style: Option<LineStyle>,
    #[serde(default)]
    pub text: RichText,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<TextAlign>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorProps {
    pub start: ConnectorEnd,
    pub end: ConnectorEnd,
    #[serde(default)]
    pub routing: ConnectorRouting,
    #[serde(default)]
    pub start_head: ConnectorHead,
    #[serde(default)]
    pub end_head: ConnectorHead,
    pub color: String,
    pub stroke_width: f64,
    #[serde(default)]
    pub line_style: LineStyle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<RichText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waypoints: Option<Vec<Point>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeProps {
    pub tool: StrokeTool,
    pub color: String,
    pub width: f64,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    pub points: Vec<[f64; 3]>,
}

fn default_opacity() -> f64 {
    1.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProps {
    pub resource_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerProps {
    pub sticker_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkProps {
    pub url: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_resource_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMeta {
    pub path: String,
    pub mime: ImageMime,
    pub width: u32,
    pub height: u32,
    pub byte_length: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub order_key: String,
    #[serde(with = "page_format_serde")]
    pub format: PageFormat,
    pub width: f64,
    pub height: f64,
    pub background: PageBackground,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardObject {
    pub id: String,
    pub page_id: String,
    pub kind: ObjectKind,
    pub order_key: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub props: Value,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardDocument {
    pub schema_version: u32,
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub pages: Vec<Page>,
    #[serde(default)]
    pub objects: Vec<BoardObject>,
    #[serde(default)]
    pub resources: BTreeMap<String, ResourceMeta>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Creates a blank v1 whiteboard starting with one freeform page.
pub fn create_new_board(id: String, page_id: String, title: String) -> BoardDocument {
    BoardDocument {
        schema_version: CURRENT_SCHEMA_VERSION,
        id,
        title,
        pages: vec![Page {
            id: page_id,
            title: String::new(),
            order_key: initial_order_key(),
            format: PageFormat::Freeform,
            width: DEFAULT_FREEFORM_WIDTH,
            height: DEFAULT_FREEFORM_HEIGHT,
            background: PageBackground::Solid {
                color: DEFAULT_PAPER_COLOR.to_string(),
            },
            extra: Map::new(),
        }],
        objects: Vec::new(),
        resources: BTreeMap::new(),
        extra: Map::new(),
    }
}

fn validate_object_props(obj: &BoardObject, resources: &BTreeMap<String, ResourceMeta>) -> Result<(), OpenError> {
    let err = |msg: String| OpenError::new(OpenErrorCode::InvalidSchema, msg);
    match obj.kind {
        ObjectKind::Sticky => {
            serde_json::from_value::<StickyProps>(obj.props.clone())
                .map_err(|e| err(format!("object {} sticky props: {e}", obj.id)))?;
        }
        ObjectKind::Text => {
            serde_json::from_value::<TextProps>(obj.props.clone())
                .map_err(|e| err(format!("object {} text props: {e}", obj.id)))?;
        }
        ObjectKind::Shape => {
            let p: ShapeProps = serde_json::from_value(obj.props.clone())
                .map_err(|e| err(format!("object {} shape props: {e}", obj.id)))?;
            if !p.stroke_width.is_finite() || p.stroke_width < 0.0 {
                return Err(err(format!("object {} invalid strokeWidth", obj.id)));
            }
        }
        ObjectKind::Connector => {
            let p: ConnectorProps = serde_json::from_value(obj.props.clone())
                .map_err(|e| err(format!("object {} connector props: {e}", obj.id)))?;
            if !p.stroke_width.is_finite() || p.stroke_width < 0.0 {
                return Err(err(format!("object {} invalid strokeWidth", obj.id)));
            }
        }
        ObjectKind::Stroke => {
            let p: StrokeProps = serde_json::from_value(obj.props.clone())
                .map_err(|e| err(format!("object {} stroke props: {e}", obj.id)))?;
            if !p.width.is_finite() || p.width <= 0.0 || !p.opacity.is_finite() || !(0.0..=1.0).contains(&p.opacity) {
                return Err(err(format!("object {} invalid stroke metrics", obj.id)));
            }
            if p.points.is_empty() {
                return Err(err(format!("object {} stroke has no points", obj.id)));
            }
            for pt in &p.points {
                if !pt[0].is_finite() || !pt[1].is_finite() || !pt[2].is_finite() {
                    return Err(err(format!("object {} non-finite stroke point", obj.id)));
                }
            }
        }
        ObjectKind::Image => {
            let p: ImageProps = serde_json::from_value(obj.props.clone())
                .map_err(|e| err(format!("object {} image props: {e}", obj.id)))?;
            if !resources.contains_key(&p.resource_id) {
                return Err(err(format!(
                    "object {} references missing resource {}",
                    obj.id, p.resource_id
                )));
            }
        }
        ObjectKind::Table => {
            let p: TableProps = serde_json::from_value(obj.props.clone())
                .map_err(|e| err(format!("object {} table props: {e}", obj.id)))?;
            if p.row_ids.is_empty() || p.col_ids.is_empty() {
                return Err(err(format!("object {} table must have >=1 row and col", obj.id)));
            }
        }
        ObjectKind::Sticker => {
            let p: StickerProps = serde_json::from_value(obj.props.clone())
                .map_err(|e| err(format!("object {} sticker props: {e}", obj.id)))?;
            if p.sticker_id.trim().is_empty() {
                return Err(err(format!("object {} stickerId must not be empty", obj.id)));
            }
        }
        ObjectKind::Link => {
            let p: LinkProps = serde_json::from_value(obj.props.clone())
                .map_err(|e| err(format!("object {} link props: {e}", obj.id)))?;
            if p.url.trim().is_empty() {
                return Err(err(format!("object {} link url must not be empty", obj.id)));
            }
            if let Some(res_id) = &p.preview_resource_id {
                if !resources.contains_key(res_id) {
                    return Err(err(format!(
                        "object {} references missing previewResourceId {res_id}",
                        obj.id
                    )));
                }
            }
        }
    }
    Ok(())
}

/// Validates schema version, page/object uniqueness, finite geometry, and resource references.
pub fn validate_board(doc: &BoardDocument) -> Result<(), OpenError> {
    if doc.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(OpenError::new(
            OpenErrorCode::UnsupportedSchemaVersion,
            format!("unsupported schemaVersion {}", doc.schema_version),
        ));
    }
    if doc.id.trim().is_empty() {
        return Err(OpenError::new(
            OpenErrorCode::InvalidSchema,
            "board id must not be empty",
        ));
    }
    if doc.pages.is_empty() {
        return Err(OpenError::new(
            OpenErrorCode::InvalidSchema,
            "board must have at least one page",
        ));
    }

    let mut page_ids = HashSet::new();
    for page in &doc.pages {
        if page.id.trim().is_empty() || !page_ids.insert(page.id.as_str()) {
            return Err(OpenError::new(
                OpenErrorCode::InvalidSchema,
                format!("duplicate or empty page id '{}'", page.id),
            ));
        }
        if !is_valid_order_key(&page.order_key) {
            return Err(OpenError::new(
                OpenErrorCode::InvalidSchema,
                format!("invalid page orderKey '{}'", page.order_key),
            ));
        }
        if !page.width.is_finite() || !page.height.is_finite() || page.width <= 0.0 || page.height <= 0.0 {
            return Err(OpenError::new(
                OpenErrorCode::InvalidSchema,
                format!("page '{}' dimensions must be positive finite numbers", page.id),
            ));
        }
        if let PageBackground::Image {
            resource_id,
            width,
            height,
        } = &page.background
        {
            if !doc.resources.contains_key(resource_id) {
                return Err(OpenError::new(
                    OpenErrorCode::InvalidSchema,
                    format!("page '{}' background references missing resource '{resource_id}'", page.id),
                ));
            }
            if !width.is_finite() || !height.is_finite() || *width <= 0.0 || *height <= 0.0 {
                return Err(OpenError::new(
                    OpenErrorCode::InvalidSchema,
                    format!("page '{}' background image dimensions must be positive", page.id),
                ));
            }
        }
    }

    let mut obj_ids = HashSet::new();
    for obj in &doc.objects {
        if obj.id.trim().is_empty() || !obj_ids.insert(obj.id.as_str()) {
            return Err(OpenError::new(
                OpenErrorCode::InvalidSchema,
                format!("duplicate or empty object id '{}'", obj.id),
            ));
        }
        if !page_ids.contains(obj.page_id.as_str()) {
            return Err(OpenError::new(
                OpenErrorCode::InvalidSchema,
                format!("object '{}' references unknown pageId '{}'", obj.id, obj.page_id),
            ));
        }
        if !is_valid_order_key(&obj.order_key) {
            return Err(OpenError::new(
                OpenErrorCode::InvalidSchema,
                format!("object '{}' invalid orderKey '{}'", obj.id, obj.order_key),
            ));
        }
        if !obj.x.is_finite()
            || !obj.y.is_finite()
            || !obj.width.is_finite()
            || !obj.height.is_finite()
            || !obj.rotation.is_finite()
        {
            return Err(OpenError::new(
                OpenErrorCode::InvalidSchema,
                format!("object '{}' has non-finite geometry", obj.id),
            ));
        }
        if obj.kind != ObjectKind::Connector && (obj.width <= 0.0 || obj.height <= 0.0) {
            return Err(OpenError::new(
                OpenErrorCode::InvalidSchema,
                format!("object '{}' width and height must be > 0", obj.id),
            ));
        }
        validate_object_props(obj, &doc.resources)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_board_is_valid_freeform_v1() {
        let board = create_new_board("b1".into(), "p1".into(), "".into());
        assert_eq!(board.schema_version, 1);
        assert_eq!(board.pages[0].format, PageFormat::Freeform);
        validate_board(&board).unwrap();
        let json = serde_json::to_string(&board).unwrap();
        assert!(json.contains("\"format\":\"freeform\""));
    }

    #[test]
    fn wide_16_9_serializes_with_spec_spelling() {
        let mut board = create_new_board("b1".into(), "p1".into(), "Deck".into());
        board.pages[0].format = PageFormat::Wide169;
        let json = serde_json::to_string(&board).unwrap();
        assert!(json.contains("\"format\":\"wide_16_9\""));
        let decoded: BoardDocument = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.pages[0].format, PageFormat::Wide169);
    }

    #[test]
    fn rejects_higher_schema_version() {
        let mut board = create_new_board("b1".into(), "p1".into(), "".into());
        board.schema_version = 2;
        let err = validate_board(&board).unwrap_err();
        assert_eq!(err.code, OpenErrorCode::UnsupportedSchemaVersion);
    }
}
