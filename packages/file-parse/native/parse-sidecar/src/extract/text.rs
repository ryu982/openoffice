use encoding_rs::{BIG5, EUC_KR, Encoding, GB18030, SHIFT_JIS, UTF_16BE, UTF_16LE, WINDOWS_1252};

/// Returns true if `bytes` opens with a UTF-32BE or UTF-32LE BOM.
/// Must be checked before UTF-16LE handling because `FF FE 00 00` shares the
/// `FF FE` prefix of UTF-16LE.
pub fn is_utf32_bom_declared(bytes: &[u8]) -> bool {
    (bytes.len() >= 4
        && bytes[0] == 0x00
        && bytes[1] == 0x00
        && bytes[2] == 0xFE
        && bytes[3] == 0xFF)
        || (bytes.len() >= 4
            && bytes[0] == 0xFF
            && bytes[1] == 0xFE
            && bytes[2] == 0x00
            && bytes[3] == 0x00)
}

fn decode_utf16_le(bytes: &[u8]) -> String {
    let (decoded, _) = UTF_16LE.decode_without_bom_handling(bytes);
    decoded.into_owned()
}

fn decode_utf16_be(bytes: &[u8]) -> String {
    let (decoded, _) = UTF_16BE.decode_without_bom_handling(bytes);
    decoded.into_owned()
}

/// BOM-aware text decode for non-CSV plain formats (`xml`, `log`, `py`).
/// Returns `None` only for BOM-declared UTF-32.
/// Matches `packages/file-parse/src/parse.ts` `decodeTextBytes`.
pub fn decode_text_bytes(bytes: &[u8]) -> Option<String> {
    if is_utf32_bom_declared(bytes) {
        return None;
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Some(decode_utf16_le(&bytes[2..]));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Some(decode_utf16_be(&bytes[2..]));
    }
    let payload = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };
    match std::str::from_utf8(payload) {
        Ok(s) => Some(s.to_owned()),
        Err(_) => {
            let (decoded, _) = WINDOWS_1252.decode_without_bom_handling(payload);
            Some(decoded.into_owned())
        }
    }
}

// The 700 most frequent Hangul syllables in general Korean prose, matching
// `packages/xlsx-gateway/src/gateway/csv-import.ts`.
const COMMON_HANGUL: &str = concat!(
    "이다는의에한로을하가서기은대지고사어으국를인도시년과적수자정구제있부리학교전나일주되해스장역경라었화들원아중만공상계와며성관문동등여그보개선",
    "유식용세비영민위조명회했게터산분치연소면방반거통된울미발음생업재행법월단진육체간드러운우포피종요것였양르할차무당강모신데실작커후오마심프현료",
    "물내트따병표설특남외초야점같른력각타축건권함본또술형출안천립많때준려두류별더래바예록카급입호평금매태근능임크향불추최레목환결약파독루및군노까",
    "합말북속않광배석론열격니직히처았언품판컴퓨달험증키받악활령규곳철디련접질편알존람높메족든확집청복습량늘없감변헌승저졌필던율총토난새항채택럽져",
    "골쓰버팀름측순페코란쟁네박송림탄올날범번린칙참션볼베줄퍼브온창책투견백맞뒤균쳐황패글겨절색쪽농랑담티플효누억객칭넘픽왔득너뜻워께징률왕써갈찰",
    "얻협밀낮탐츠획례앙암벌돌탈테랜념램충큰났검논망혁취응착친밖삼층융잡될완곡궁즈김락갖휘폐킥극널걸넓컵애살럼블침클못맥훈탕꾸케머앞움길찾먹링센떤",
    "므막롯텔잔맹빈잠폭닌런털엔혼봉빌옮손슬잘찬허륙팅몇숙압킨템좌뿐염좋떻풍즉렸빠겼핵촉갔놓느잉웨넷끝희켰덕첫틴볶익윤욱켜먼녹턴잇춘씨팔째퇴긴흐둘",
    "낸홍힘괄둔흔흥몰맛풋휴척릴맡톤렵슈헤렇괴섭쇄혹씩끼콩뉴캐넣섰릉웃뀌렌븐쳤몽밍벨즘벽떨엄섬냉콘돈옥액읍혈떠묘옛헐눈텍숫덜킹렀붙략귀뉘쿠겪촌녀쓴",
    "읽푸틀밝앗랐웠싸값롭뉜갑왜졸랫콜셈킬잎혀룬혜곤슷텐욕랍컨릭큼홈칼얼듬헬셀끌엑님델폴놀십몸칠짓짧춰셔빛좁촬낱삶땅붕맺엇힌빼낙됨썼멘궐죄핑즐돕핸",
    "윈뢰짐룹멸탁겸답뤄싱봄켓굴춤롤곽죽흑쇼냈닥낳핀혔섞샤멀꽃흡듣쉬폰뜨쿨굽뛰옐곧맨됐벗돼빚섯늦컬꼽풀칸밤꺼멈팬앤즌튜낼짜깔렬낀눌깊뚜싼찍빨젠뽑톨"
);

fn looks_korean(text: &str) -> bool {
    let mut non_ascii = 0usize;
    let mut hangul = 0usize;
    let mut common = 0usize;
    for ch in text.chars() {
        let code = ch as u32;
        if code < 0x80 {
            continue;
        }
        non_ascii += 1;
        if !(0xAC00..=0xD7A3).contains(&code) {
            continue;
        }
        hangul += 1;
        if COMMON_HANGUL.contains(ch) {
            common += 1;
        }
    }
    hangul >= 6
        && (hangul as f64) / (non_ascii as f64) >= 0.8
        && (common as f64) / (hangul as f64) >= 0.75
}

fn score_decoded(text: &str) -> i64 {
    let mut value: i64 = 0;
    for ch in text.chars() {
        let code = ch as u32;
        if ch == '\u{FFFD}' {
            value -= 20;
        } else if code < 0x20 && ch != '\n' && ch != '\r' && ch != '\t' {
            value -= 10;
        } else if code < 0x7f {
            value += 1;
        } else if (0xFF61..=0xFF9F).contains(&code) {
            value -= 2;
        } else if (0x3000..=0x9FFF).contains(&code)
            || (0xAC00..=0xD7AF).contains(&code)
            || (0xFF00..=0xFFEF).contains(&code)
        {
            value += 2;
        }
    }
    value
}

fn sniff_utf16_without_bom(bytes: &[u8]) -> Option<&'static Encoding> {
    let sample = &bytes[..bytes.len().min(1024)];
    let mut pairs = 0usize;
    let mut even_nul = 0usize;
    let mut odd_nul = 0usize;
    let mut i = 0;
    while i + 1 < sample.len() {
        pairs += 1;
        if sample[i] == 0 {
            even_nul += 1;
        }
        if sample[i + 1] == 0 {
            odd_nul += 1;
        }
        i += 2;
    }
    if pairs < 2 {
        return None;
    }
    if ((even_nul + odd_nul) as f64) / ((pairs * 2) as f64) < 0.05 {
        return None;
    }
    Some(if odd_nul >= even_nul {
        UTF_16LE
    } else {
        UTF_16BE
    })
}

/// Decodes CSV/TSV bytes using BOM, BOM-less UTF-16 sniffer, strict UTF-8,
/// Korean EUC-KR heuristic, and legacy charset scoring.
/// Returns `None` only for BOM-declared UTF-32.
/// Matches `packages/xlsx-gateway/src/gateway/csv-import.ts` `decodeCsvBuffer`.
pub fn decode_csv_bytes(bytes: &[u8]) -> Option<String> {
    if is_utf32_bom_declared(bytes) {
        return None;
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Some(String::from_utf8_lossy(&bytes[3..]).into_owned());
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Some(decode_utf16_le(&bytes[2..]));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Some(decode_utf16_be(&bytes[2..]));
    }
    if let Some(enc) = sniff_utf16_without_bom(bytes) {
        let (decoded, _) = enc.decode_without_bom_handling(bytes);
        return Some(decoded.into_owned());
    }
    if let Ok(utf8) = std::str::from_utf8(bytes) {
        return Some(utf8.to_owned());
    }

    // Korean Excel CSV (CP949 / EUC-KR) heuristic before legacy scoring.
    let (korean, had_errors) = EUC_KR.decode_without_bom_handling(bytes);
    if !had_errors && looks_korean(&korean) {
        return Some(korean.into_owned());
    }

    let mut best = String::from_utf8_lossy(bytes).into_owned();
    let mut best_score = score_decoded(&best);
    let candidates: [&'static Encoding; 7] = [
        UTF_16LE,
        UTF_16BE,
        GB18030,
        SHIFT_JIS,
        BIG5,
        EUC_KR,
        WINDOWS_1252,
    ];
    for enc in candidates {
        let (candidate, _) = enc.decode_without_bom_handling(bytes);
        let candidate_score = score_decoded(&candidate);
        if candidate_score > best_score {
            best = candidate.into_owned();
            best_score = candidate_score;
        }
    }
    Some(best)
}
