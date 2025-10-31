import json
import os
import signal
import subprocess
import time
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "http://127.0.0.1:8000"


def _start_server():
    env = os.environ.copy()
    env.setdefault("PYTHONPATH", str(ROOT))
    return subprocess.Popen(
        ["uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


@pytest.fixture(scope="session")
def server():
    proc = _start_server()
    try:
        deadline = time.time() + 30
        last_err = None
        while time.time() < deadline:
            try:
                res = httpx.get(f"{BASE_URL}/health", timeout=1.0)
                if res.status_code == 200:
                    break
            except Exception as exc:  # pragma: no cover - diagnostics only
                last_err = exc
                time.sleep(0.3)
        else:
            raise RuntimeError(f"Server did not start: {last_err}")
        yield BASE_URL
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture()
def page(server):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(server, wait_until="networkidle")
        yield page
        browser.close()


def _dispatch_drop(page, selector, file_name, payload):
    data = json.dumps(payload)
    page.evaluate(
        """
        ({ selector, name, text }) => {
            const target = document.querySelector(selector);
            if (!target) {
                throw new Error(`No element matches ${selector}`);
            }
            const dataTransfer = new DataTransfer();
            const file = new File([text], name, { type: 'application/json' });
            dataTransfer.items.add(file);
            const dragOver = new DragEvent('dragover', { dataTransfer, bubbles: true });
            target.dispatchEvent(dragOver);
            const dropEvent = new DragEvent('drop', { dataTransfer, bubbles: true });
            target.dispatchEvent(dropEvent);
        }
        """,
        {"selector": selector, "name": file_name, "text": data},
    )


def test_spec_tab_displays_cards(page):
    page.click("#tab-spec")
    page.wait_for_selector("#spec-grid .spec-card")
    cards = page.locator("#spec-grid .spec-card")
    assert cards.count() > 0


def test_drag_and_drop_triggers_validation(page):
    sample = {"id": "SKU-1"}
    _dispatch_drop(page, "#drop-zone", "feed.json", sample)
    selected = page.locator("#selected-file")
    selected.wait_for()
    assert "feed.json" in selected.text_content()

    with page.expect_response("**/validate/file") as response_info:
        page.click("#btn-validate-file")
    response = response_info.value
    assert response.ok

    page.wait_for_selector("#issues-body tr")
    rows = page.locator("#issues-body tr")
    assert rows.count() > 0
