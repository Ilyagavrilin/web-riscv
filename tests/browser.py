from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import struct
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
url = f"http://127.0.0.1:{server.server_port}/project/"
errors = []

# A bare-metal ELF that sets a0 to 42, then signals successful completion.
elf = bytearray(0x110)
elf[:7] = b"\x7fELF\x01\x01\x01"
struct.pack_into("<HH", elf, 16, 2, 243)
struct.pack_into("<II", elf, 24, 0x200, 52)
struct.pack_into("<HH", elf, 42, 32, 1)
struct.pack_into("<IIIIIIII", elf, 52, 1, 0x100, 0x200, 0x200, 16, 32, 5, 4)
struct.pack_into("<IIII", elf, 0x100, 0x02A00513, 0xF00002B7, 0x00428293, 0x0002A023)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(
            viewport={"width": 1440, "height": 1000}, device_scale_factor=1
        )
        page.on("pageerror", lambda e: errors.append(str(e)))

        def tab(name):
            page.locator(f"#tab-{name}").click()
            assert page.locator(f"#view-{name}").is_visible()

        def ready():
            page.wait_for_function(
                "document.querySelector('#status').textContent === 'Ready'"
            )

        def finished():
            page.wait_for_function(
                "document.querySelector('#status').textContent.startsWith('Finished')"
            )

        page.goto(url)
        ready()
        assert not page.locator("#view-about").is_visible()
        assert page.locator("h1").filter(has_text="Small core").count() == 0
        assert (
            page.locator(".register").first.evaluate(
                "e => parseFloat(getComputedStyle(e).fontSize)"
            )
            >= 15
        )
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
        finished()
        assert "59 00 00 00" in page.locator("#memory").inner_text()
        tab("compare")
        page.locator("#compare").click()
        page.wait_for_selector("#comparison tbody tr")
        assert page.locator("#comparison").inner_text().count("Match") == 3
        tab("debugger")
        for profile in ["ic", "ec", "imc"]:
            page.locator("#profile").select_option(profile)
            ready()
            assert page.locator(".register.unavailable").count() == (
                16 if profile == "ec" else 0
            )
            page.locator("#run").click()
            finished()
        page.locator("#elf").set_input_files(
            {
                "name": "custom.elf",
                "mimeType": "application/x-elf",
                "buffer": bytes(elf),
            }
        )
        ready()
        page.wait_for_selector(
            '#saved-elf option[value="elf:custom.elf"]', state="attached"
        )
        assert "custom.elf" in page.locator("#program-name").inner_text()
        assert "addi x10, x0, 42" in page.locator("#listing").inner_text()
        page.locator("#program-library summary").click()
        assert "ELF32" in page.locator("#program-info").inner_text()
        page.locator("#breakpoint-address").fill("0x204")
        page.locator("#breakpoint-form button").click()
        page.locator("#run").click()
        page.wait_for_function(
            "document.querySelector('#status').textContent === 'Breakpoint'"
        )
        page.locator("#breakpoints button").click()
        page.locator("#run").click()
        finished()
        assert (
            "0000002a"
            in page.locator(".register")
            .filter(has=page.locator("b", has_text="a0"))
            .inner_text()
        )
        page.reload()
        ready()
        page.wait_for_selector(
            '#saved-elf option[value="elf:custom.elf"]', state="attached"
        )
        page.locator("#program-library summary").click()
        page.locator("#saved-elf").select_option("elf:custom.elf")
        page.locator("#load-saved-elf").click()
        page.wait_for_function(
            "document.querySelector('#program-name').textContent === 'custom.elf'"
        )
        ready()
        page.locator("#reset").click()
        ready()
        assert "custom.elf" in page.locator("#program-name").inner_text()
        tab("diagnostics")
        page.locator("#diagnostic-mode").check()
        page.wait_for_function(
            "document.querySelector('#log-summary').textContent.startsWith('Diagnostic capture enabled')"
        )
        tab("devices")
        page.locator("#instruction-latency").fill("3")
        page.locator("#data-latency").fill("7")
        page.locator("#platform-apply").click()
        page.wait_for_function(
            "document.querySelector('#platform-state').textContent.startsWith('Fetch 3 / data 7 clocks')"
        )
        for module_name, expected in [
            ("timer", "40 00 00 00"),
            ("mailbox", "11 00 00 00 22 00 00 00 33 00 00 00"),
            ("dma", "11 00 00 00 22 00 00 00 33 00 00 00 44 00 00 00"),
        ]:
            page.locator("#peripheral-example").select_option(module_name)
            page.locator("#peripheral-attach").click()
            page.wait_for_function(
                "document.querySelectorAll('.device-card').length === 1"
            )
            page.locator("#peripheral-demo").click()
            ready()
            page.locator("#run").click()
            finished()
            tab("debugger")
            assert expected in page.locator("#memory").inner_text()
            if module_name == "dma":
                page.locator("#memory-address").fill("0x1100")
                page.locator("#memory-address").dispatch_event("change")
                page.wait_for_function(
                    "document.querySelector('#memory').textContent.includes('11 00 00 00 22 00 00 00 33 00 00 00 44 00 00 00')"
                )
                tab("diagnostics")
                page.locator("#log-kind").select_option("dma")
                assert page.locator("#diagnostic-log tr").count() == 8
                tab("debugger")
                page.locator("#memory-address").fill("0x1000")
                page.locator("#memory-address").dispatch_event("change")
            if module_name == "timer":
                tab("devices")
                page.locator("#stop-on-interrupt").check()
                page.locator("#platform-apply").click()
                page.wait_for_function(
                    "!document.querySelector('#platform-apply').disabled"
                )
                tab("debugger")
                page.locator("#assembly-editor summary").click()
                page.locator("#example").select_option("interrupt")
                ready()
                page.locator("#run").click()
                page.wait_for_function(
                    "document.querySelector('#status').textContent === 'Interrupt entry'"
                )
                tab("devices")
                page.locator("#stop-on-interrupt").uncheck()
                page.locator("#platform-apply").click()
                page.wait_for_function(
                    "!document.querySelector('#platform-apply').disabled"
                )
                page.locator("#run").click()
                finished()
                tab("debugger")
                assert "01 00 00 00" in page.locator("#memory").inner_text()
            tab("devices")
            page.locator("#peripheral-detach").click()
            page.wait_for_function(
                "document.querySelectorAll('.device-card').length === 0"
            )
        page.locator("#peripheral-example").select_option("pulse-counter")
        module = (project / "result/peripherals/pulse-counter.wasm").read_bytes()
        page.locator("#peripheral-file").set_input_files(
            {
                "name": "custom-counter.wasm",
                "mimeType": "application/wasm",
                "buffer": module,
            }
        )
        page.wait_for_function("document.querySelectorAll('.device-card').length === 1")
        page.wait_for_selector(
            '#saved-device option[value="wasm:custom-counter.wasm"]', state="attached"
        )
        page.locator("#peripheral-base").fill("0x40000100")
        page.locator("#saved-device").select_option("wasm:custom-counter.wasm")
        page.locator("#load-saved-device").click()
        page.wait_for_function("document.querySelectorAll('.device-card').length === 2")
        page.locator("#peripheral-base").fill("0x40000004")
        page.locator("#load-saved-device").click()
        page.wait_for_function(
            "document.querySelector('#message').textContent.includes('overlaps')"
        )
        assert page.locator(".device-card").count() == 2
        page.locator("#peripheral-demo").click()
        ready()
        tab("diagnostics")
        page.locator("#watchpoint-address").fill("0x4000000c")
        page.locator("#watchpoint-access").select_option("write")
        page.locator("#watchpoint-form button").first.click()
        page.wait_for_function(
            "document.querySelector('#watchpoint-status').textContent.includes('write at')"
        )
        page.locator("#run").click()
        page.wait_for_function(
            "document.querySelector('#status').textContent === 'Data watchpoint'"
        )
        page.locator("#watchpoint-clear").click()
        page.wait_for_function(
            "document.querySelector('#watchpoint-status').textContent === 'No data watchpoint'"
        )
        page.locator("#run").click()
        finished()
        page.locator("#log-kind").select_option("mmio")
        assert "mmio" in page.locator("#diagnostic-log").inner_text()
        assert "0x400000" in page.locator("#diagnostic-log").inner_text()
        with page.expect_download() as download:
            page.locator("#json").click()
        capture_path = artifacts / "browser-trace.json"
        download.value.save_as(str(capture_path))
        capture = json.loads(capture_path.read_text())
        assert capture["schemaVersion"] == 3
        assert len(capture["peripherals"]) == 2
        assert any(
            e["kind"] == "mmio" and e.get("operation") == "read"
            for e in capture["events"]
        )
        page.screenshot(path=str(artifacts / "preview-diagnostics.png"), full_page=True)
        tab("devices")
        page.screenshot(path=str(artifacts / "preview-devices.png"), full_page=True)
        page.locator(".device-card button").first.click()
        page.wait_for_function("document.querySelectorAll('.device-card').length === 1")
        page.locator("#peripheral-detach").click()
        page.wait_for_function(
            "document.querySelector('#peripheral-status').textContent === 'No module attached.'"
        )
        page.locator("#instruction-latency").fill("1")
        page.locator("#data-latency").fill("1")
        page.locator("#platform-apply").click()
        page.wait_for_function(
            "document.querySelector('#platform-state').textContent.startsWith('Fetch 1 / data 1 clocks')"
        )
        tab("debugger")
        if page.locator("#assembly-editor").get_attribute("open") is not None:
            page.locator("#assembly-editor summary").click()
        tab("guide")
        page.locator("#mmio-guide details summary").click()
        page.wait_for_function(
            "document.querySelector('#module-source').textContent.includes('SC_METHOD')"
        )
        with page.expect_download():
            page.get_by_role("link", name="Download SystemC source").click()
        tab("about")
        assert "Unmodified" in page.locator("#view-about").inner_text()
        tab("debugger")
        page.locator("#assembly-editor summary").click()
        page.locator("#example").select_option("hello")
        ready()
        page.locator("#run").click()
        finished()
        assert page.locator("#console").inner_text() == "SCR1\n"
        page.locator("#example").select_option("fibonacci")
        ready()
        page.locator("#editor").fill("loop: j loop")
        page.locator("#assemble").click()
        ready()
        page.locator("#run").click()
        page.wait_for_function(
            "Number(document.querySelector('#cycles').textContent.replaceAll(',','')) > 2000"
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        count = page.locator("#cycles").inner_text()
        page.wait_for_timeout(200)
        assert count == page.locator("#cycles").inner_text()
        mobile = browser.new_page(
            viewport={"width": 390, "height": 844}, device_scale_factor=1
        )
        mobile.on("pageerror", lambda e: errors.append(str(e)))
        mobile.goto(url)
        mobile.wait_for_function(
            "document.querySelector('#status').textContent === 'Ready'"
        )
        assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
            "Mobile overflow"
        )
        mobile.screenshot(path=str(artifacts / "preview-mobile.png"), full_page=True)
        assert not errors, errors
        browser.close()
finally:
    server.shutdown()
print(
    "Browser checks passed: large tabbed UI, three profiles, ELF upload/disassembly/library/reset, custom MMIO upload/library/multiple windows, memory latency, timer IRQ/mret, DMA copy/trace, overlap rejection, diagnostics, watchpoints, export, documentation, UART, pause, mobile layout."
)
