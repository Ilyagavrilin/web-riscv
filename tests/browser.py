from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
artifacts = project / "build"
artifacts.mkdir(exist_ok=True)
root = artifacts / "browser-root"
root.mkdir(exist_ok=True)
link = root / "project"
if not link.exists():
    link.symlink_to(project / "result")
server = ThreadingHTTPServer(
    ("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(root))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    page = browser.new_page(
        viewport={"width": 1440, "height": 1000}, device_scale_factor=1
    )
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{server.server_port}/project/")
    page.wait_for_function("document.querySelector('#status').textContent === 'Ready'")
    page.screenshot(path=str(artifacts / "preview-desktop.png"), full_page=True)
    page.locator("#step").click()
    page.wait_for_function("document.querySelector('#retired').textContent === '1'")
    page.locator('.code-row[data-address="528"]').click()
    page.locator("#run").click()
    page.wait_for_function(
        "document.querySelector('#status').textContent === 'Breakpoint'"
    )
    page.locator('.code-row[data-address="528"]').click()
    page.locator("#run").click()
    page.wait_for_function(
        "document.querySelector('#status').textContent.startsWith('Finished')"
    )
    assert "59 00 00 00" in page.locator("#memory").inner_text()
    page.locator("#compare").click()
    page.wait_for_selector("#comparison tbody tr")
    assert page.locator("#comparison tbody tr").count() == 3
    assert page.locator("#comparison").inner_text().count("Match") == 3
    for profile in ["ic", "ec", "imc"]:
        page.locator("#profile").select_option(profile)
        page.wait_for_function(
            "document.querySelector('#status').textContent === 'Ready'"
        )
        assert page.locator(".register.unavailable").count() == (
            16 if profile == "ec" else 0
        )
        page.locator("#run").click()
        page.wait_for_function(
            "document.querySelector('#status').textContent.startsWith('Finished')"
        )
        assert "59 00 00 00" in page.locator("#memory").inner_text()
    with page.expect_download() as download:
        page.locator("#json").click()
    download.value.save_as(str(artifacts / "browser-trace.json"))
    page.locator("#example").select_option("hello")
    page.wait_for_function("!document.querySelector('#step').disabled")
    page.locator("#run").click()
    page.wait_for_function(
        "document.querySelector('#status').textContent.startsWith('Finished')"
    )
    assert page.locator("#console").inner_text() == "SCR1\n"
    page.locator("#reset").click()
    page.wait_for_function("document.querySelector('#retired').textContent === '0'")
    page.locator("#editor").fill("addi a0, zero, 99999")
    page.locator("#assemble").click()
    assert "signed 12" in page.locator("#message").inner_text()
    page.locator("#example").select_option("fibonacci")
    page.wait_for_function("!document.querySelector('#step').disabled")
    page.locator("#editor").fill("loop: j loop")
    page.locator("#assemble").click()
    page.wait_for_function("!document.querySelector('#step').disabled")
    page.locator("#run").click()
    page.wait_for_function(
        "Number(document.querySelector('#cycles').textContent.replaceAll(',','')) > 2000"
    )
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    c = page.locator("#cycles").inner_text()
    page.wait_for_timeout(200)
    assert c == page.locator("#cycles").inner_text()
    page.locator("#peripheral-attach").click()
    page.wait_for_function(
        "document.querySelector('#peripheral-status').textContent.includes('16 bytes')"
    )
    page.locator("#peripheral-demo").click()
    page.wait_for_function("!document.querySelector('#step').disabled")
    page.locator("#run").click()
    page.wait_for_function(
        "document.querySelector('#status').textContent.startsWith('Finished')"
    )
    assert page.locator(".peripheral-word").count() == 4
    assert page.locator(".gpio-bit.on").count() == 1
    page.locator("#compare").click()
    page.wait_for_selector("#comparison tbody tr")
    assert page.locator("#comparison").inner_text().count("Exit 0") == 3
    page.locator("#peripheral-detach").click()
    page.wait_for_function(
        "document.querySelector('#peripheral-status').textContent.startsWith('No module')"
    )
    mobile = browser.new_page(
        viewport={"width": 390, "height": 844}, device_scale_factor=1
    )
    mobile.on("pageerror", lambda e: errors.append(str(e)))
    mobile.goto(f"http://127.0.0.1:{server.server_port}/project/")
    mobile.wait_for_function(
        "document.querySelector('#status').textContent === 'Ready'"
    )
    assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
        "Mobile overflow"
    )
    mobile.screenshot(path=str(artifacts / "preview-mobile.png"), full_page=True)
    assert not errors, errors
    browser.close()
server.shutdown()
print(
    "Browser checks passed: subpath, Wasm worker, step, breakpoint, run, RAM, UART, export, reset, errors, pause, three profiles, comparison, hot-loaded MMIO, counting demo, mobile layout."
)
