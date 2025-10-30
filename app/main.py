
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from typing import List, Dict, Any, Tuple
import csv, io, json, re

from validators.gtin import is_valid_gtin

app = FastAPI(title="Google Merchant Center Product Feed Validator", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent.parent / "static"
SPEC_FILE = STATIC_DIR / "spec" / "gmc_spec_us_en.json"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

ENUMS = {
    "availability": {"in_stock", "out_of_stock", "preorder", "backorder"},
    "gender": {"male", "female", "unisex"},
    "age_group": {"newborn", "infant", "toddler", "kids", "adult"},
}
CURRENCY_RE = re.compile(r"^\s*\d+(\.\d{2})?\s+[A-Z]{3}\s*$")
ISO8601_RANGE_RE = re.compile(r"^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+\-]\d{2}:?\d{2})\s*/\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+\-]\d{2}:?\d{2})\s*$")
ISO8601_RE = re.compile(r"^\s*\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?:Z|[+\-]\d{2}:?\d{2})?)?\s*$")

def load_spec() -> Dict[str, Any]:
    with open(SPEC_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def headers_by_profile(spec: Dict[str, Any], profile: str) -> Dict[str, set]:
    req, cond, rec, opt = set(), set(), set(), set()
    for a in spec["attributes"]:
        if profile in a["profiles"]:
            if a["status"] == "required":
                req.add(a["name"])
            elif a["status"] == "conditional":
                cond.add(a["name"])
            elif a["status"] == "recommended":
                rec.add(a["name"])
            else:
                opt.add(a["name"])
    return {"required": req, "conditional": cond, "recommended": rec, "optional": opt}

def parse_csv_bytes(b: bytes) -> Tuple[List[Dict[str, Any]], List[str]]:
    sio = io.StringIO(b.decode("utf-8", errors="replace"))
    reader = csv.DictReader(sio)
    rows = [dict(r) for r in reader]
    headers = reader.fieldnames or []
    return rows, list(headers)

def parse_json_bytes(b: bytes) -> Tuple[List[Dict[str, Any]], List[str]]:
    data = json.loads(b.decode("utf-8", errors="replace"))
    if isinstance(data, dict):
        data = data.get("items") or data.get("products") or []
    if not isinstance(data, list):
        raise ValueError("JSON must be an array of objects or an object with 'items'/'products'.")
    rows = []
    headers = set()
    for obj in data:
        if isinstance(obj, dict):
            rows.append(obj)
            headers.update(obj.keys())
    return rows, list(headers)

def validate_feed(rows: List[Dict[str, Any]], headers: List[str], profile: str) -> Dict[str, List[Dict[str, Any]]]:
    spec = load_spec()
    if profile not in ("general","apparel","local_inventory"):
        profile = "general"
    buckets = headers_by_profile(spec, profile)
    allowed = set().union(buckets["required"], buckets["conditional"], buckets["recommended"], buckets["optional"])

    errors, warnings, opps = [], [], []

    # Header-level checks
    for h in headers:
        if h not in allowed:
            errors.append({"row":"-", "field":h, "message":"Unknown header (not accepted by GMC for this profile)", "severity":"error"})
    for h in sorted(buckets["required"]):
        if h not in headers:
            errors.append({"row":"-", "field":h, "message":"Missing required header", "severity":"error"})

    # Row-level checks
    for idx, row in enumerate(rows, start=2):
        # Required non-empty
        for h in buckets["required"]:
            if h in headers:
                v = (row.get(h, "") or "").strip()
                if v == "":
                    errors.append({"row":idx, "field":h, "message":"Required value is empty", "severity":"error"})

        avail = (row.get("availability") or "").strip().lower()
        if avail:
            if avail not in ENUMS["availability"]:
                errors.append({"row":idx, "field":"availability", "message":f"Invalid availability '{avail}'", "severity":"error"})
        if avail == "preorder":
            if "availability_date" in headers:
                if not (row.get("availability_date") or "").strip():
                    errors.append({"row":idx, "field":"availability_date", "message":"Required when availability=preorder", "severity":"error"})
            else:
                errors.append({"row":idx, "field":"availability_date", "message":"Header missing (required when availability=preorder)", "severity":"error"})

        # Price formats
        for key in ("price","sale_price"):
            if key in headers and (row.get(key) or "").strip():
                val = (row.get(key) or "").strip()
                if not CURRENCY_RE.match(val):
                    errors.append({"row":idx, "field":key, "message":"Price must be '<amount> <ISO4217>' (e.g., '15.00 USD')", "severity":"error"})
        if "sale_price_effective_date" in headers and (row.get("sale_price_effective_date") or "").strip():
            if not ISO8601_RANGE_RE.match(row["sale_price_effective_date"].strip()):
                warnings.append({"row":idx, "field":"sale_price_effective_date", "message":"Expected ISO-8601 range 'start/end' (best practice)", "severity":"warning"})
        if "availability_date" in headers and (row.get("availability_date") or "").strip():
            if not ISO8601_RE.match(row["availability_date"].strip()):
                errors.append({"row":idx, "field":"availability_date", "message":"Expected ISO-8601 date/time", "severity":"error"})

        # Identifier logic
        if profile in ("general","apparel"):
            gtin = (row.get("gtin") or "").strip()
            brand = (row.get("brand") or "").strip()
            mpn = (row.get("mpn") or "").strip()
            if gtin:
                if not is_valid_gtin(gtin):
                    errors.append({"row":idx, "field":"gtin", "message":"Invalid GTIN checksum", "severity":"error"})
            else:
                warnings.append({"row":idx, "field":"gtin", "message":"GTIN strongly recommended for better match quality", "severity":"warning"})
                if not (brand and mpn):
                    missing = "brand and mpn" if (not brand and not mpn) else ("brand" if not brand else "mpn")
                    errors.append({"row":idx, "field":"identifier", "message":f"Missing {missing}. Provide GTIN or brand+mpn.", "severity":"error"})

        # Apparel enums
        if profile == "apparel":
            gender = (row.get("gender") or "").strip().lower()
            if gender and gender not in ENUMS["gender"]:
                errors.append({"row":idx, "field":"gender", "message":f"Invalid gender '{gender}'", "severity":"error"})
            age = (row.get("age_group") or "").strip().lower()
            if age and age not in ENUMS["age_group"]:
                errors.append({"row":idx, "field":"age_group", "message":f"Invalid age_group '{age}'", "severity":"error"})

        # Local inventory
        if profile == "local_inventory":
            if "store_code" in headers and not (row.get("store_code") or "").strip():
                errors.append({"row":idx, "field":"store_code", "message":"Required for local inventory", "severity":"error"})

        # Opportunities (missing recommended values)
        for h in buckets["recommended"]:
            if h in headers:
                v = (row.get(h, "") or "").strip()
                if v == "":
                    opps.append({"row":idx, "field":h, "message":"Add to improve CTR/relevance/completeness", "severity":"opportunity"})

    # Feed-level missing recommended headers
    for h in sorted(buckets["recommended"]):
        if h not in headers:
            opps.append({"row":"-", "field":h, "message":"Header not present. Consider adding for better coverage.", "severity":"opportunity"})

    # Dedup
    def dedupe(items):
        seen = set(); out = []
        for it in items:
            key = (it.get("row"), it.get("field"), it.get("message"), it.get("severity"))
            if key not in seen:
                seen.add(key); out.append(it)
        return out

    return {
        "errors": dedupe(errors),
        "warnings": dedupe(warnings),
        "opportunities": dedupe(opps)
    }

@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))

@app.get("/api/spec")
def get_spec():
    return FileResponse(str(SPEC_FILE))

@app.post("/api/validate-csv")
async def validate_csv(file: UploadFile = File(...), profile: str = Form("general")):
    content = await file.read()
    rows, headers = parse_csv_bytes(content)
    report = validate_feed(rows, headers, profile)
    return JSONResponse(report)

@app.post("/api/validate-json")
async def validate_json(file: UploadFile = File(...), profile: str = Form("general")):
    content = await file.read()
    rows, headers = parse_json_bytes(content)
    report = validate_feed(rows, headers, profile)
    return JSONResponse(report)
