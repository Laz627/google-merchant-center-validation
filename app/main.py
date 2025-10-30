
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from typing import List, Dict, Any, Tuple
import csv, io, json, re

from app.validators.gtin import is_valid_gtin

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
    "availability": {"in_stock","out_of_stock","preorder","backorder"},
    "gender": {"male","female","unisex"},
    "age_group": {"newborn","infant","toddler","kids","adult"},
}
CURRENCY_RE = re.compile(r"^\s*\d+(?:\.\d{2})?\s+[A-Z]{3}\s*$")
ISO8601_RANGE_RE = re.compile(r"^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+\-]\d{2}:?\d{2})\s*/\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+\-]\d{2}:?\d{2})\s*$")
ISO8601_RE = re.compile(r"^\s*\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?:Z|[+\-]\d{2}:?\d{2})?)?\s*$")

def load_spec() -> Dict[str, Any]:
    with open(SPEC_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def headers_by_profile(spec: Dict[str, Any], profile: str) -> Dict[str, set]:
    req, cond, rec, opt = set(), set(), set(), set()
    for a in spec["attributes"]:
        if profile in a["profiles"]:
            status = a["status"]
            if status == "required": req.add(a["name"])
            elif status == "conditional": cond.add(a["name"])
            elif status == "recommended": rec.add(a["name"])
            else: opt.add(a["name"])
    return {"required": req, "conditional": cond, "recommended": rec, "optional": opt}

def parse_csv_bytes(b: bytes):
    sio = io.StringIO(b.decode("utf-8", errors="replace"))
    reader = csv.DictReader(sio)
    return [dict(r) for r in reader], (reader.fieldnames or [])

def parse_json_bytes(b: bytes):
    data = json.loads(b.decode("utf-8", errors="replace"))
    if isinstance(data, dict):
        data = data.get("items") or data.get("products") or []
    rows = []; headers=set()
    for o in (data if isinstance(data,list) else []):
        if isinstance(o, dict):
            rows.append(o); headers.update(o.keys())
    return rows, list(headers)

def validate_feed(rows, headers, profile):
    spec = load_spec()
    if profile not in ("general","apparel","local_inventory"):
        profile = "general"
    buckets = headers_by_profile(spec, profile)
    allowed = set().union(*buckets.values())
    errors, warnings, opps = [], [], []

    for h in headers:
        if h not in allowed:
            errors.append({"row":"-", "field":h, "message":"Unknown header for this profile", "severity":"error"})
    for h in sorted(buckets["required"]):
        if h not in headers:
            errors.append({"row":"-", "field":h, "message":"Missing required header", "severity":"error"})

    for idx, row in enumerate(rows, start=2):
        for h in buckets["required"]:
            if h in headers and not (row.get(h) or "").strip():
                errors.append({"row":idx,"field":h,"message":"Required value is empty","severity":"error"})

        avail = (row.get("availability") or "").strip().lower()
        if avail and avail not in ENUMS["availability"]:
            errors.append({"row":idx,"field":"availability","message":f"Invalid availability '{avail}'","severity":"error"})
        if avail == "preorder":
            if "availability_date" in headers and not (row.get("availability_date") or "").strip():
                errors.append({"row":idx,"field":"availability_date","message":"Required when availability=preorder","severity":"error"})

        for k in ("price","sale_price"):
            if k in headers and (row.get(k) or "").strip() and not CURRENCY_RE.match((row.get(k) or "").strip()):
                errors.append({"row":idx,"field":k,"message":"Use '<amount> <ISO>' e.g. '15.00 USD'","severity":"error"})
        if "sale_price_effective_date" in headers and (row.get("sale_price_effective_date") or "").strip():
            if not ISO8601_RANGE_RE.match(row["sale_price_effective_date"].strip()):
                warnings.append({"row":idx,"field":"sale_price_effective_date","message":"Use ISO-8601 'start/end'","severity":"warning"})

        if profile in ("general","apparel"):
            gtin = (row.get("gtin") or "").strip()
            brand = (row.get("brand") or "").strip()
            mpn = (row.get("mpn") or "").strip()
            if gtin:
                if not is_valid_gtin(gtin):
                    errors.append({"row":idx,"field":"gtin","message":"Invalid GTIN checksum","severity":"error"})
            else:
                warnings.append({"row":idx,"field":"gtin","message":"GTIN strongly recommended","severity":"warning"})
                if not (brand and mpn):
                    errors.append({"row":idx,"field":"identifier","message":"Provide GTIN or brand+mpn","severity":"error"})

        if profile == "apparel":
            gender = (row.get("gender") or "").strip().lower()
            if gender and gender not in ENUMS["gender"]:
                errors.append({"row":idx,"field":"gender","message":f"Invalid gender '{gender}'","severity":"error"})
            age = (row.get("age_group") or "").strip().lower()
            if age and age not in ENUMS["age_group"]:
                errors.append({"row":idx,"field":"age_group","message":f"Invalid age_group '{age}'","severity":"error"})

        for h in buckets["recommended"]:
            if h in headers and not (row.get(h) or "").strip():
                opps.append({"row":idx,"field":h,"message":"Add for better coverage","severity":"opportunity"})

    for h in sorted(buckets["recommended"]):
        if h not in headers:
            opps.append({"row":"-", "field":h, "message":"Header not present (consider adding)","severity":"opportunity"})

    return {"errors":errors, "warnings":warnings, "opportunities":opps}

@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))

@app.get("/api/spec")
def get_spec():
    return FileResponse(str(SPEC_FILE))

@app.post("/api/validate-csv")
async def validate_csv(file: UploadFile = File(...), profile: str = Form("general")):
    rows, headers = parse_csv_bytes(await file.read())
    return JSONResponse(validate_feed(rows, headers, profile))

@app.post("/api/validate-json")
async def validate_json(file: UploadFile = File(...), profile: str = Form("general")):
    rows, headers = parse_json_bytes(await file.read())
    return JSONResponse(validate_feed(rows, headers, profile))
