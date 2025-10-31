# app/main.py

from typing import Any, Dict, List, Optional, Tuple
import csv
import io
import json
import re

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path

# =========================
# Models (kept to match UI)
# =========================

class Issue(BaseModel):
    row_index: Optional[int] = None
    item_id: Optional[str] = None
    field: str
    rule_id: str
    severity: str  # "error" | "warning" | "info" | "opportunity"
    message: str
    sample_value: Optional[str] = None
    remediation: Optional[List[str]] = None

class Summary(BaseModel):
    items_total: int = 0
    items_with_errors: int = 0
    items_with_warnings: int = 0
    items_with_opportunities: int = 0
    pass_rate: float = 0.0
    top_rules: Optional[List[Dict[str, Any]]] = None

class ValidateResponse(BaseModel):
    summary: Summary
    issues: List[Issue]

# =========================
# App / CORS
# =========================

app = FastAPI(title="Google Merchant Center Product Feed Validator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Spec loader (safe)
# =========================

GMC_SPEC_PATH = Path(__file__).parent / "specs" / "gmc_spec.json"
try:
    with open(GMC_SPEC_PATH, "r", encoding="utf-8") as f:
        GMC_SPEC = json.load(f)
except FileNotFoundError:
    # Boot without crashing; /api/spec will just be empty.
    GMC_SPEC = {"profiles": {"general": [], "apparel": [], "local_inventory": []}}

def gmc_fields_for_profile(profile: str) -> List[Dict[str, Any]]:
    profile = (profile or "general").strip().lower()
    profiles = GMC_SPEC.get("profiles", {})
    fields = profiles.get(profile, [])
    # Map to UI schema expected by Spec tab
    mapped: List[Dict[str, Any]] = []
    for f in fields:
        mapped.append({
            "name": f["name"],
            "description": f.get("desc", ""),
            "importance": {
                "required": "required",
                "conditional": "conditional",
                "recommended": "recommended",
                "optional": "optional",
            }[f["status"]],
            "dependencies": f.get("dependencies", "") or "—",
        })
    return mapped

# =========================
# Regex / enums / helpers
# =========================

BOOL_ENUM = {"true", "false"}
GMC_AVAIL = {"in_stock", "out_of_stock", "preorder", "backorder"}
GMC_GENDER = {"male", "female", "unisex"}
GMC_AGE = {"newborn", "infant", "toddler", "kids", "adult"}

ALNUM_RE = re.compile(r"^[A-Za-z0-9._\-]+$")
URL_RE = re.compile(r"^https?://", re.IGNORECASE)
CURRENCY_PRICE_RE = re.compile(r"^\d+(\.\d{1,2})?\s[A-Z]{3}$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATE_RANGE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\s*/\s*(\d{4}-\d{2}-\d{2})$")
COUNTRY_ALPHA2_RE = re.compile(r"^[A-Za-z]{2}$")
DIMENSION_RE = re.compile(r"^\s*\d+(\.\d+)?\s*(mm|cm|in|inch|inches)\s*$", re.IGNORECASE)
WEIGHT_RE = re.compile(r"^\s*\d+(\.\d+)?\s*(lb|lbs|kg|g|oz)\s*$", re.IGNORECASE)

ROW_CAP = 50000

HEADER_ALIASES: Dict[str, str] = {
    "image link": "image_link",
    "image-url": "image_link",
    "imageurl": "image_link",
    "product link": "link",
    "product-url": "link",
    "producturl": "link",
    "price_amount": "price",
    "availability_status": "availability",
    "sellername": "seller_name",
    "seller url": "seller_url",
    "sellerurl": "seller_url",
    "return policy": "return_policy",
    "return window": "return_window",
}

def _norm(v: Optional[str]) -> str:
    return (v or "").strip()

def _gtin_checksum_ok(s: str) -> bool:
    digits = [c for c in s if c.isdigit()]
    if len(digits) not in (8, 12, 13, 14):  # EAN-8, UPC-A, EAN-13, GTIN-14
        return False
    nums = list(map(int, digits))
    check = nums[-1]
    body = nums[:-1][::-1]
    total = 0
    for i, n in enumerate(body, start=1):
        total += n * (3 if i % 2 else 1)
    calc = (10 - (total % 10)) % 10
    return calc == check

def parse_price(value: str) -> Optional[Tuple[float, str]]:
    try:
        num, cur = value.strip().split()
        return float(num), cur
    except Exception:
        return None

def is_future_date(yyyy_mm_dd: str) -> bool:
    try:
        from datetime import date
        y, m, d = map(int, yyyy_mm_dd.split("-"))
        return date(y, m, d) > date.today()
    except Exception:
        return False

def guess_delimiter(sample: str) -> str:
    counts = {"\t": sample.count("\t"), ",": sample.count(","), ";": sample.count(";"), "|": sample.count("|")}
    return max(counts, key=counts.get) if counts else ","

def normalize_key(k: str) -> str:
    kk = (k or "").strip().lower().replace("-", "_").replace(" ", "_")
    return HEADER_ALIASES.get(kk, kk)

def normalize_headers(headers: List[str]) -> List[str]:
    return [normalize_key(h) for h in headers]

def normalize_record_keys(r: Dict[str, Any]) -> Dict[str, Any]:
    nr: Dict[str, Any] = {}
    for k, v in r.items():
        nr[normalize_key(str(k))] = v
    if isinstance(nr.get("additional_image_link"), list):
        nr["additional_image_link"] = ", ".join(map(str, nr["additional_image_link"]))
    return nr

def parse_as_json(data: bytes, encoding: str) -> Optional[List[Dict[str, Any]]]:
    try:
        text = data.decode(encoding or "utf-8", errors="replace")
        obj = json.loads(text)
        if isinstance(obj, list):
            return [normalize_record_keys(r) for r in obj if isinstance(r, dict)]
        if isinstance(obj, dict) and isinstance(obj.get("items"), list):
            return [normalize_record_keys(r) for r in obj["items"] if isinstance(r, dict)]
        if isinstance(obj, dict) and isinstance(obj.get("products"), list):
            return [normalize_record_keys(r) for r in obj["products"] if isinstance(r, dict)]
    except Exception:
        return None
    return None

def parse_as_csv_tsv(data: bytes, delimiter: str, encoding: str) -> List[Dict[str, Any]]:
    if data.startswith(b"\xef\xbb\xbf"):  # strip BOM
        data = data[3:]
    text = data.decode(encoding or "utf-8", errors="replace")
    delim = delimiter or guess_delimiter(text)
    sio = io.StringIO(text)
    reader = csv.reader(sio, delimiter=delim)
    raw_header = next(reader, None) or []
    norm_header = normalize_headers([str(h) for h in raw_header])
    # rewind and use DictReader with normalized headers
    sio.seek(0)
    dict_reader = csv.DictReader(sio, delimiter=delim)
    dict_reader.fieldnames = norm_header
    out: List[Dict[str, Any]] = []
    _ = next(dict_reader, None)  # skip header row once
    for row in dict_reader:
        out.append(normalize_record_keys({k: row.get(k, "") for k in norm_header}))
    return out

# =================================
# Validation core for GMC profiles
# =================================

def _push_issue(
    issues: List[Issue], error_rows: set[int], row_index: int, item_id: str,
    field: str, rule_id: str, severity: str, message: str, sample: Any
):
    issues.append(Issue(
        row_index=row_index if row_index is not None else None,
        item_id=item_id or None,
        field=field,
        rule_id=rule_id,
        severity=severity,
        message=message,
        sample_value=None if sample is None else str(sample),
        remediation=[],
    ))
    if severity == "error" and row_index is not None and row_index >= 0:
        error_rows.add(row_index)

def _bad_headers(headers: List[str], profile: str) -> List[str]:
    allowed = {f["name"] for f in GMC_SPEC.get("profiles", {}).get(profile, [])}
    return [h for h in headers if h not in allowed]

def validate_gmc_bytes(data: bytes, delimiter: str, encoding: str, profile: str) -> ValidateResponse:
    # Parse JSON first; else CSV/TSV
    records = parse_as_json(data, encoding)
    parsed_headers: List[str] = []

    if records is None:
        text = data.decode(encoding or "utf-8", errors="replace")
        delim = delimiter or guess_delimiter(text)
        sio = io.StringIO(text)
        reader = csv.DictReader(sio, delimiter=delim)
        headers = [normalize_key(h) for h in (reader.fieldnames or [])]
        parsed_headers = headers
        records = [{normalize_key(k): (v or "").strip() for k, v in row.items()} for row in reader]
    else:
        # normalize keys for JSON
        records = [{normalize_key(k): (("" if v is None else str(v)).strip()) for k, v in row.items()} for row in records]
        if records:
            parsed_headers = list(records[0].keys())

    # Enforce header allowlist per profile
    profile = (profile or "general").strip().lower()
    issues: List[Issue] = []
    error_rows: set[int] = set()

    for bad in _bad_headers(parsed_headers, profile):
        _push_issue(issues, error_rows, 0, "", bad, "GMC-001", "error",
                    f'Header "{bad}" is not allowed for profile "{profile}".', bad)

    # Per-row checks
    total_rows = 0
    for idx, r in enumerate(records):
        total_rows += 1
        rid = r.get("id", "")

        def req(field: str, code: str, msg: str):
            if not _norm(r.get(field, "")):
                _push_issue(issues, error_rows, idx, rid, field, code, "error", msg, "")

        # Required base
        if profile in ("general", "apparel"):
            for f in ["id", "title", "description", "link", "image_link", "availability", "price"]:
                req(f, "GMC-100", f"{f} is required.")

        if profile == "apparel":
            for f in ["item_group_id", "gender", "age_group", "color", "size"]:
                req(f, "GMC-101", f"{f} is required for apparel.")

        if profile == "local_inventory":
            for f in ["store_code", "id", "price", "availability"]:
                req(f, "GMC-102", f"{f} is required for local_inventory.")

        # Price format
        if _norm(r.get("price")) and not CURRENCY_PRICE_RE.match(r["price"]):
            _push_issue(issues, error_rows, idx, rid, "price", "GMC-200", "error",
                        'price must be "<amount> <ISO4217>", e.g., "15.00 USD".', r.get("price"))

        # Availability
        av = (r.get("availability", "") or "").lower()
        if av and av not in GMC_AVAIL:
            _push_issue(issues, error_rows, idx, rid, "availability", "GMC-210", "error",
                        "availability must be in_stock, out_of_stock, preorder, or backorder.", av)

        if av == "preorder":
            ad = r.get("availability_date", "")
            if not ad or not ISO_DATE_RE.match(ad):
                _push_issue(issues, error_rows, idx, rid, "availability_date", "GMC-211", "error",
                            "availability_date (ISO 8601) required when availability=preorder.", ad)

        # GTIN / brand+mpn
        gtin = _norm(r.get("gtin", ""))
        brand = _norm(r.get("brand", ""))
        mpn = _norm(r.get("mpn", ""))
        if gtin:
            if not _gtin_checksum_ok(gtin):
                _push_issue(issues, error_rows, idx, rid, "gtin", "GMC-220", "warning",
                            "GTIN checksum appears invalid.", gtin)
        else:
            if not (brand and mpn):
                _push_issue(issues, error_rows, idx, rid, "brand/mpn", "GMC-221", "error",
                            "Provide GTIN or brand + mpn.", f"{brand}|{mpn}")

        # Apparel enums
        if profile == "apparel":
            g = (r.get("gender", "") or "").lower()
            if g and g not in GMC_GENDER:
                _push_issue(issues, error_rows, idx, rid, "gender", "GMC-230", "error",
                            "gender must be male/female/unisex.", g)
            ag = (r.get("age_group", "") or "").lower()
            if ag and ag not in GMC_AGE:
                _push_issue(issues, error_rows, idx, rid, "age_group", "GMC-231", "error",
                            "age_group must be newborn/infant/toddler/kids/adult.", ag)

        # Local inventory recommendation
        if profile == "local_inventory":
            if not _norm(r.get("quantity", "")):
                _push_issue(issues, error_rows, idx, rid, "quantity", "GMC-240", "warning",
                            "quantity is recommended for local inventory.", "")

    # Aggregate (use attributes; not subscriptable)
    total_errors = sum(1 for i in issues if i.severity == "error")
    total_warnings = sum(1 for i in issues if i.severity == "warning")
    total_opps = sum(1 for i in issues if i.severity == "opportunity")
    unique_error_rows = len({i.row_index for i in issues if i.severity == "error" and i.row_index is not None})
    pass_rate = 0.0 if total_rows == 0 else round((total_rows - unique_error_rows) / total_rows, 4)

    # Return the declared model so the UI can read counters + issues
    return ValidateResponse(
        summary=Summary(
            items_total=total_rows,
            items_with_errors=total_errors,
            items_with_warnings=total_warnings,
            items_with_opportunities=total_opps,
            pass_rate=pass_rate,
        ),
        issues=issues[:1000],
    )

# =========================
# Routes
# =========================

@app.get("/health", include_in_schema=False)
def health() -> Dict[str, bool]:
    return {"ok": True}

@app.post("/validate/file", response_model=ValidateResponse)
async def validate_file(
    file: UploadFile = File(...),
    delimiter: str = Form(""),
    encoding: str = Form("utf-8"),
    profile: str = Form("general"),
):
    try:
        data = await file.read()
        return validate_gmc_bytes(data, delimiter, encoding, profile)
    except Exception as e:
        # Print full trace in logs for debugging, but return clean 400 to client
        import traceback
        traceback.print_exc()
        raise HTTPException(400, f"Validation failed: {e}")

@app.get("/api/spec")
def api_spec(profile: str = "general"):
    return gmc_fields_for_profile(profile)

@app.post("/api/validate-csv", response_model=ValidateResponse)
async def api_validate_csv(
    file: UploadFile = File(...),
    delimiter: str = Form(""),
    encoding: str = Form("utf-8"),
    profile: str = Form("general"),
):
    data = await file.read()
    return validate_gmc_bytes(data, delimiter, encoding, profile)

@app.post("/api/validate-json", response_model=ValidateResponse)
async def api_validate_json(
    file: UploadFile = File(...),
    encoding: str = Form("utf-8"),
    profile: str = Form("general"),
):
    data = await file.read()
    # delimiter unused for JSON
    return validate_gmc_bytes(data, "", encoding, profile)

# Keep static last. check_dir=False prevents startup failure if /static is missing.
app.mount("/", StaticFiles(directory="static", html=True, check_dir=False), name="static")
