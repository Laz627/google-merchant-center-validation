
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from typing import List, Dict, Any, Tuple
from pathlib import Path
import csv, io, json, re

app = FastAPI(title="Google Merchant Center Product Feed Validator", version="1.0.0")

# CORS (loose by default for internal tools)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ---- GMC Spec (US/English) ----
# Exact header match policy: only the keys listed below are accepted.
# Severity buckets:
# - required: missing -> error
# - conditional: evaluated with simple dependency rules (produces error if triggered and missing)
# - recommended: if missing -> warning
# - optional: opportunity
GMC_PROFILES = {
    "general": {
        "required": {
            "id", "title", "description", "link", "image_link", "availability", "price"
        },
        "conditional": {
            # when availability=preorder -> availability_date required
            "availability_date",
            # identifiers
            "brand", "gtin", "mpn",  # rules handled below
        },
        "recommended": {
            "additional_image_link", "mobile_link", "sale_price", "sale_price_effective_date",
            "google_product_category", "product_type", "identifier_exists",
            "unit_pricing_measure", "unit_pricing_base_measure",
            "shipping_weight", "shipping_length", "shipping_width", "shipping_height",
        },
        "optional": {
            "ads_redirect", "custom_label_0", "custom_label_1", "custom_label_2",
            "custom_label_3", "custom_label_4", "promotion_id",
            "short_title", "lifestyle_image_link",
            # dimensions
            "product_length", "product_width", "product_height", "product_weight",
            # misc
            "expiration_date", "cost_of_goods_sold", "minimum_price", "maximum_retail_price"
        }
    },
    "apparel": {
        # Inherits general, adds apparel specifics
        "required": {
            "id", "title", "description", "link", "image_link", "availability", "price",
            "color", "gender", "age_group", "size"
        },
        "conditional": {
            "availability_date", "brand", "gtin", "mpn", "item_group_id",
            "size_type", "size_system", "material", "pattern"
        },
        "recommended": {
            "additional_image_link", "mobile_link", "sale_price", "sale_price_effective_date",
            "google_product_category", "product_type", "identifier_exists",
        },
        "optional": {
            "ads_redirect", "custom_label_0", "custom_label_1", "custom_label_2",
            "custom_label_3", "custom_label_4", "promotion_id", "short_title"
        }
    },
    "local_inventory": {
        # For Local Inventory ads feeds (per-store offers)
        "required": {
            "id", "store_code", "availability", "price"
        },
        "conditional": {
            "sale_price", "pickup_method", "pickup_sla"
        },
        "recommended": {
            "quantity", "link"
        },
        "optional": {
            "mobile_link"
        }
    }
}

# Enums and simple validators
ENUMS = {
    "availability": {"in_stock", "out_of_stock", "preorder", "backorder"},
    "gender": {"male", "female", "unisex"},
    "age_group": {"newborn", "infant", "toddler", "kids", "adult"},
}

CURRENCY_RE = re.compile(r"^\s*\d+(\.\d{2})?\s+[A-Z]{3}\s*$")  # e.g., 10.00 USD
ISO8601_RANGE_RE = re.compile(r"^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+\-]\d{2}:?\d{2})\s*/\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+\-]\d{2}:?\d{2})\s*$")
ISO8601_RE = re.compile(r"^\s*\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?:Z|[+\-]\d{2}:?\d{2})?)?\s*$")
NUMERIC_RE = re.compile(r"^\d+$")

def allowed_headers_for_profile(profile: str) -> set:
    spec = GMC_PROFILES[profile]
    return set().union(spec["required"], spec["conditional"], spec["recommended"], spec["optional"])

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
    spec = GMC_PROFILES[profile]
    allowed = allowed_headers_for_profile(profile)

    errors, warnings, opps = [], [], []

    # Header-level checks
    unknown = [h for h in headers if h not in allowed]
    for h in unknown:
        errors.append({"row": "-", "field": h, "message": "Unknown header (not accepted by GMC for this profile)"})
    # Missing required headers (at header level)
    for h in sorted(spec["required"]):
        if h not in headers:
            errors.append({"row": "-", "field": h, "message": "Missing required header"})

    # Row-level checks
    # Simple identifier rule: prefer GTIN where available; if no GTIN then brand+mpn required for many categories
    for idx, row in enumerate(rows, start=2):  # assuming header at row 1 in CSV
        # Required non-empty
        for h in spec["required"]:
            if h in headers:
                v = (row.get(h, "") or "").strip()
                if v == "":
                    errors.append({"row": idx, "field": h, "message": "Required value is empty"})

        # Conditional: availability_date if preorder
        avail = (row.get("availability") or "").strip().lower()
        if avail == "preorder":
            if "availability_date" in headers:
                if not (row.get("availability_date") or "").strip():
                    errors.append({"row": idx, "field": "availability_date", "message": "Required when availability=preorder"})
            else:
                errors.append({"row": idx, "field": "availability_date", "message": "Header missing (required when availability=preorder)"})

        # Identifier logic (general/apparel): if gtin absent, brand+mpn should exist
        if profile in ("general", "apparel"):
            gtin = (row.get("gtin") or "").strip()
            brand = (row.get("brand") or "").strip()
            mpn = (row.get("mpn") or "").strip()
            if not gtin:
                # Recommend GTIN
                warnings.append({"row": idx, "field": "gtin", "message": "GTIN strongly recommended for better match quality"})
                # If either brand or mpn missing, raise error
                if not (brand and mpn):
                    missing = "brand and mpn" if (not brand and not mpn) else ("brand" if not brand else "mpn")
                    errors.append({"row": idx, "field": "identifier", "message": f"Missing {missing}. Provide GTIN or brand+mpn."})

        # Enumerations
        if avail and avail not in ENUMS["availability"]:
            errors.append({"row": idx, "field": "availability", "message": f"Invalid availability '{avail}'. Must be one of {sorted(ENUMS['availability'])}"})
        gender = (row.get("gender") or "").strip().lower()
        if profile == "apparel" and gender and gender not in ENUMS["gender"]:
            errors.append({"row": idx, "field": "gender", "message": f"Invalid gender '{gender}'. Must be one of {sorted(ENUMS['gender'])}"})
        age = (row.get("age_group") or "").strip().lower()
        if profile == "apparel" and age and age not in ENUMS["age_group"]:
            errors.append({"row": idx, "field": "age_group", "message": f"Invalid age_group '{age}'. Must be one of {sorted(ENUMS['age_group'])}"})

        # Price formats
        for key in ("price", "sale_price"):
            if key in headers and (row.get(key) or "").strip():
                val = (row.get(key) or "").strip()
                if not CURRENCY_RE.match(val):
                    errors.append({"row": idx, "field": key, "message": "Price must be '<amount> <ISO4217>' (e.g., '15.00 USD')"})
        # sale_price_effective_date range format
        if "sale_price_effective_date" in headers and (row.get("sale_price_effective_date") or "").strip():
            if not ISO8601_RANGE_RE.match(row["sale_price_effective_date"].strip()):
                warnings.append({"row": idx, "field": "sale_price_effective_date", "message": "Expected ISO-8601 range 'start/end' (best practice)"})
        # availability_date ISO format
        if "availability_date" in headers and (row.get("availability_date") or "").strip():
            if not ISO8601_RE.match(row["availability_date"].strip()):
                errors.append({"row": idx, "field": "availability_date", "message": "Expected ISO-8601 date/time"})

        # Local inventory simple checks
        if profile == "local_inventory":
            if "store_code" in headers and not (row.get("store_code") or "").strip():
                errors.append({"row": idx, "field": "store_code", "message": "Required for local inventory"})
            # Optional pickup fields
            # No strict enum enforcement here; just presence if provided

        # Opportunities: if recommended field missing/empty
        for h in spec["recommended"]:
            if h in headers:
                v = (row.get(h, "") or "").strip()
                if v == "":
                    opps.append({"row": idx, "field": h, "message": "Add to improve CTR/relevance/completeness"})

    # Feed-level warnings: missing recommended headers entirely
    for h in sorted(spec["recommended"]):
        if h not in headers:
            # informational recommendation
            opps.append({"row": "-", "field": h, "message": "Header not present. Consider adding for better coverage."})

    # Deduplicate messages
    def dedupe(items):
        seen = set()
        out = []
        for it in items:
            key = (it.get("row"), it.get("field"), it.get("message"))
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

@app.post("/api/validate-csv")
async def validate_csv(file: UploadFile = File(...), profile: str = Form("general")):
    content = await file.read()
    rows, headers = parse_csv_bytes(content)
    profile_key = profile if profile in GMC_PROFILES else "general"
    report = validate_feed(rows, headers, profile_key)
    return JSONResponse(report)

@app.post("/api/validate-json")
async def validate_json(file: UploadFile = File(...), profile: str = Form("general")):
    content = await file.read()
    rows, headers = parse_json_bytes(content)
    profile_key = profile if profile in GMC_PROFILES else "general"
    report = validate_feed(rows, headers, profile_key)
    return JSONResponse(report)
