
# =========================
# app/main.py (GMC version)
# =========================
from typing import Any, Dict, List, Optional, Tuple
import csv
import io
import json
import re
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Google Merchant Center Product Feed Validator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------
# Utility helpers
# ----------------------
URL_RE = re.compile(r"^https?://", re.IGNORECASE)
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
PRICE_RE = re.compile(r"^\s*(\d+(?:\.\d{1,2})?)\s*([A-Z]{3})\s*$")  # "15.00 USD"
SALE_PRICE_RANGE_RE = re.compile(
    r"^\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+\-]\d{4}))\s*/\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+\-]\d{4}))\s*$"
)
ISO_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(Z|[+\-]\d{4})$")
DIM_RE = re.compile(r"^\s*\d+(\.\d+)?\s*(in|cm|lb|oz|g|kg)\s*$", re.IGNORECASE)
UNIT_MEASURE_RE = re.compile(r"^\s*\d+(\.\d+)?\s*(oz|lb|mg|g|kg|floz|pt|qt|gal|ml|cl|l|cbm|in|ft|yd|cm|m|sqft|sqm|ct)\s*$", re.IGNORECASE)
UNIT_BASE_MEASURE_RE = re.compile(r"^\s*(1|2|4|8|10|75|100|750|1000)\s*(ml|cl|l|cbm|oz|lb|mg|g|kg|in|ft|yd|cm|m|sqft|sqm|ct)\s*$", re.IGNORECASE)

AVAIL_VALUES = {"in_stock","out_of_stock","preorder","backorder"}

# Profiles
PROFILE_GENERAL = "general"
PROFILE_APPAREL = "apparel"
PROFILE_LOCAL = "local_inventory"

# Severity mapping
ERR = "Error"
WARN = "Warning"
INFO = "Opportunity"

# Required attributes for general (US/English scope)
REQUIRED_GENERAL = [
    "id","title","description","link","image_link","availability","price"
]

# Apparel-specific requireds (US) for Clothing & Shoes style products
REQUIRED_APPAREL = [
    # Always required for variants in apparel groups:
    "item_group_id","color","gender","age_group","size"
]

# Local Inventory feed core attributes (simplified enforcement)
REQUIRED_LOCAL = [
    "id","store_code","price","availability"  # Google LI feeds also often include quantity, pickup_method, but we treat those as recommendations
]

# Fields that define a variant differentiation
VARIANT_ATTRS = ["color","size","pattern","material","age_group","gender"]

def parse_csv_bytes(data: bytes) -> List[Dict[str, str]]:
    txt = data.decode("utf-8-sig")  # handle BOM
    sniffer = csv.Sniffer()
    dialect = sniffer.sniff(txt.splitlines()[0]) if txt else csv.excel
    reader = csv.DictReader(io.StringIO(txt), dialect=dialect)
    rows = [ {k.strip(): (v.strip() if isinstance(v,str) else v) for k,v in row.items()} for row in reader ]
    return rows

def parse_json_bytes(data: bytes) -> List[Dict[str, Any]]:
    obj = json.loads(data.decode("utf-8"))
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict) and "items" in obj and isinstance(obj["items"], list):
        return obj["items"]
    raise ValueError("JSON must be an array of items or an object with an 'items' array.")

def add(issue_list: List[Dict[str,Any]], severity: str, row: int, field: str, message: str):
    issue_list.append({"severity": severity, "row": row, "field": field, "message": message})

def is_url(v: str) -> bool:
    return isinstance(v, str) and bool(URL_RE.match(v))

def is_price(v: str) -> bool:
    return isinstance(v, str) and bool(PRICE_RE.match(v))

def normalize_headers_exact(headers: List[str]) -> List[str]:
    # Exact match: do not change case; just trim whitespace
    return [h.strip() for h in headers]

def validate_identifiers(row: Dict[str,Any], issues: List[Dict[str,Any]], idx: int):
    gtin = (row.get("gtin") or "").strip()
    mpn = (row.get("mpn") or "").strip()
    brand = (row.get("brand") or "").strip()
    identifier_exists = (row.get("identifier_exists") or "yes").strip().lower()

    if identifier_exists not in {"yes","no"}:
        add(issues, WARN, idx, "identifier_exists", "Value should be 'yes' or 'no'. Default is 'yes'.")

    if identifier_exists == "no":
        # No identifiers required
        return

    # If identifier exists, prefer GTIN OR brand+mpn
    if gtin:
        # simple checksum for GTIN-14-ish (GS1). We'll validate length 8/12/13/14 and checksum.
        cleaned = re.sub(r"[^0-9]", "", gtin)
        if len(cleaned) not in (8,12,13,14):
            add(issues, ERR, idx, "gtin", "GTIN must be 8, 12, 13, or 14 digits (after removing dashes/spaces).")
        elif not _valid_gs1_checksum(cleaned):
            add(issues, ERR, idx, "gtin", "GTIN checksum is invalid per GS1 rules.")
    else:
        if not (brand and mpn):
            add(issues, ERR, idx, "brand/mpn", "Provide GTIN, or both brand and mpn when identifiers exist.")

def _valid_gs1_checksum(digits: str) -> bool:
    # GS1 checksum: rightmost is check digit
    if not digits.isdigit():
        return False
    nums = [int(c) for c in digits]
    check = nums[-1]
    body = nums[:-1]
    # weighting from rightmost body digit: 3,1,3,1...
    total = 0
    flip = True
    for d in reversed(body):
        total += d * (3 if flip else 1)
        flip = not flip
    calc = (10 - (total % 10)) % 10
    return calc == check

def validate_basic(row: Dict[str,Any], issues: List[Dict[str,Any]], idx: int, profile: str):
    # Required general
    for f in REQUIRED_GENERAL:
        if not (row.get(f) or "").strip():
            add(issues, ERR, idx, f, f"{f} is required for US feeds.")

    # title/description length
    title = (row.get("title") or "").strip()
    if title and len(title) > 150:
        add(issues, WARN, idx, "title", "Title exceeds 150 characters; may be truncated.")
    desc = (row.get("description") or "").strip()
    if desc and len(desc) > 5000:
        add(issues, WARN, idx, "description", "Description exceeds 5000 characters; may be truncated.")

    # URLs
    for f in ["link","image_link","mobile_link","additional_image_link","lifestyle_image_link"]:
        v = (row.get(f) or "").strip()
        if v:
            if not is_url(v):
                add(issues, ERR, idx, f, f"{f} must start with http:// or https://")
        # additional_image_link may be semi-colon or comma separated list; enforce <=10
        if f == "additional_image_link" and v:
            imgs = re.split(r"[;,]\s*", v)
            if len(imgs) > 10:
                add(issues, WARN, idx, f, "Provide at most 10 additional images.")

    # availability
    avail = (row.get("availability") or "").strip().lower()
    if avail and avail not in AVAIL_VALUES:
        add(issues, ERR, idx, "availability", f"availability must be one of {sorted(AVAIL_VALUES)}.")

    # price and sale logic
    price = (row.get("price") or "").strip()
    if price and not is_price(price):
        add(issues, ERR, idx, "price", "Price must be formatted as '<amount> <CURRENCY>', e.g., '15.00 USD'.")
    sale_price = (row.get("sale_price") or "").strip()
    if sale_price:
        if not is_price(sale_price):
            add(issues, ERR, idx, "sale_price", "Sale price must be '<amount> <CURRENCY>'.")
        # If sale price exists, check effective date if present
        spd = (row.get("sale_price_effective_date") or "").strip()
        if spd and not SALE_PRICE_RANGE_RE.match(spd):
            add(issues, ERR, idx, "sale_price_effective_date", "Use ISO8601 'start/end' format, e.g., 2016-02-24T11:07+0100/2016-02-29T23:07+0100.")

    # unit pricing
    upm = (row.get("unit_pricing_measure") or "").strip()
    if upm and not UNIT_MEASURE_RE.match(upm):
        add(issues, WARN, idx, "unit_pricing_measure", "Use a numeric value and supported unit (e.g., '1.5kg').")
    upbm = (row.get("unit_pricing_base_measure") or "").strip()
    if upbm and not UNIT_BASE_MEASURE_RE.match(upbm):
        add(issues, WARN, idx, "unit_pricing_base_measure", "Use allowed base units and integers (e.g., '100 ml').")

    # shipping dims & weight
    for f in ["shipping_weight","shipping_length","shipping_width","shipping_height"]:
        v = (row.get(f) or "").strip()
        if v and not DIM_RE.match(v):
            add(issues, WARN, idx, f, f"{f} should be '<number> <unit>' (units: in, cm, lb, oz, g, kg).")

def validate_apparel(row: Dict[str,Any], issues: List[Dict[str,Any]], idx: int):
    for f in REQUIRED_APPAREL:
        if not (row.get(f) or "").strip():
            add(issues, ERR, idx, f, f"{f} is required for Apparel (US).")

def validate_local_inventory_row(row: Dict[str,Any], issues: List[Dict[str,Any]], idx: int):
    for f in REQUIRED_LOCAL:
        if not (row.get(f) or "").strip():
            add(issues, ERR, idx, f, f"{f} is required for Local Inventory feeds (US).")
    # quantity: informational if missing
    if not (row.get("quantity") or "").strip():
        add(issues, INFO, idx, "quantity", "quantity is recommended for Local Inventory to reflect stock levels.")
    # pickup fields: informational recommendations
    if not (row.get("pickup_method") or "").strip():
        add(issues, INFO, idx, "pickup_method", "pickup_method recommended (e.g., 'buy, pickup later').")
    if not (row.get("pickup_sla") or "").strip():
        add(issues, INFO, idx, "pickup_sla", "pickup_sla recommended (e.g., 'same day', 'next day').")

def validate_variants(items: List[Dict[str,Any]], issues: List[Dict[str,Any]]):
    # Group by item_group_id
    groups: Dict[str, List[Tuple[int,Dict[str,Any]]]] = {}
    for idx, row in enumerate(items, start=2):  # CSV header is row 1
        ig = (row.get("item_group_id") or "").strip()
        if ig:
            groups.setdefault(ig, []).append((idx,row))
    for gid, rows in groups.items():
        # Check that within group, at least one VARIANT_ATTR differs
        differing = False
        base = rows[0][1]
        for _, r in rows[1:]:
            if any((r.get(a) or "").strip() != (base.get(a) or "").strip() for a in VARIANT_ATTRS):
                differing = True
                break
        if not differing:
            add(issues, WARN, rows[0][0], "item_group_id", f"All variants in group '{gid}' appear identical; ensure variant attributes differ (e.g., color or size).")

def evaluate_items(items: List[Dict[str,Any]], profile: str) -> Dict[str, Any]:
    issues: List[Dict[str,Any]] = []
    # Basic row-level checks
    for idx, row in enumerate(items, start=2):  # 1-based header + data rows start at 2
        validate_basic(row, issues, idx, profile)
        validate_identifiers(row, issues, idx)
        if profile == PROFILE_APPAREL:
            validate_apparel(row, issues, idx)
        if profile == PROFILE_LOCAL:
            validate_local_inventory_row(row, issues, idx)

        # Informational opportunities
        if not (row.get("additional_image_link") or "").strip():
            add(issues, INFO, idx, "additional_image_link", "Add up to 10 additional images to improve CTR.")
        if not (row.get("google_product_category") or "").strip():
            add(issues, INFO, idx, "google_product_category", "Set a precise Google product category to improve targeting.")
        if (row.get("gtin") or "").strip() == "" and (row.get("identifier_exists") or "yes").strip().lower() != "no":
            add(issues, INFO, idx, "gtin", "Provide a valid GTIN when available; products with GTINs generally perform better.")

    # Cross-row variant health
    if profile in (PROFILE_APPAREL, PROFILE_GENERAL):
        validate_variants(items, issues)

    # Attach source metadata for richer UI context
    for issue in issues:
        try:
            src = items[issue["row"] - 2]
        except Exception:
            src = {}
        if isinstance(src, dict):
            item_id = src.get("id")
            issue["item_id"] = (item_id.strip() if isinstance(item_id, str) else item_id) or ""
            title = src.get("title")
            issue["item_title"] = (title.strip() if isinstance(title, str) else title) or ""
            field = issue.get("field") or ""
            value = None
            if field:
                search_keys = [field]
                if "/" in field:
                    search_keys.extend(part.strip() for part in field.split("/") if part.strip())
                for key in search_keys:
                    if key in src:
                        val = src.get(key)
                        value = val.strip() if isinstance(val, str) else val
                        break
            issue["value"] = "" if value is None else value
        else:
            issue["item_id"] = ""
            issue["item_title"] = ""
            issue["value"] = ""

    # Severity bucketization
    errors = [i for i in issues if i["severity"] == ERR]
    warnings = [i for i in issues if i["severity"] == WARN]
    infos = [i for i in issues if i["severity"] == INFO]
    return {"errors": errors, "warnings": warnings, "opportunities": infos}

# ----------------------
# API endpoints
# ----------------------
@app.post("/api/validate-csv")
async def validate_csv(file: UploadFile = File(...), profile: str = Form(PROFILE_GENERAL)):
    try:
        content = await file.read()
        rows = parse_csv_bytes(content)
        if not rows:
            raise ValueError("CSV appears empty.")
        result = evaluate_items(rows, profile)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/validate-json")
async def validate_json(file: UploadFile = File(...), profile: str = Form(PROFILE_GENERAL)):
    try:
        content = await file.read()
        items = parse_json_bytes(content)
        if not items:
            raise ValueError("JSON appears empty.")
        # For JSON array of dicts, enforce exact header names indirectly by checking keys of first item
        # (We still validate per-field presence by exact attribute names.)
        result = evaluate_items(items, profile)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Serve static (frontend)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
