"""Exercise the actual player with real WebM/PCM and injected recoverable faults.

Run: python scripts/player_smoke.py [--soak-seconds 125] [--headed]
Requires the existing browser dev extra. No external AI calls.
"""

from __future__ import annotations

import argparse
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


class ModuleHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def log_message(self, format: str, *args: object) -> None:
        return


def position(page: Page) -> float:
    return float(page.locator("#video").evaluate("video => video.currentTime"))


def seek(page: Page, seconds: float) -> None:
    page.locator("#seekRange").evaluate(
        "(range, seconds) => { range.value = seconds; "
        "range.dispatchEvent(new Event('change', {bubbles: true})); }",
        seconds,
    )
    page.wait_for_function(
        "seconds => Math.abs(document.querySelector('#video').currentTime - seconds) < 1",
        arg=seconds,
    )


def verify_player(page: Page, producer: Page, url: str, soak: float) -> dict[str, object]:
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_function("!document.querySelector('#activateButton').disabled", timeout=45000)
    page.locator("#activateButton").click()
    page.wait_for_function("document.querySelector('#video').currentTime > 1")
    if soak:
        print(f"Playing for {soak:g} seconds with real video and dubbed PCM...", flush=True)
        page.wait_for_function(
            "seconds => document.querySelector('#video').currentTime >= seconds",
            arg=soak,
            timeout=int((soak + 20) * 1000),
        )
    assert page.locator("#stageError").is_hidden()
    assert page.evaluate("playerTest.audioSources.length > 0")
    assert page.evaluate("playerTest.audioSources.every(source => source.playbackRate.value === 1)")
    seek(page, 4)
    page.locator("#playButton").click()
    paused_at = position(page)
    captions = page.locator("#captionStack").inner_text()
    page.wait_for_timeout(1000)
    assert abs(position(page) - paused_at) < 0.05
    assert page.locator("#captionStack").inner_text() == captions
    page.locator("#playButton").click()
    seek(page, 6)
    seek(page, 2)
    # Actual fullscreen and a second foreground tab, with no throttle-disable flags.
    page.locator("#fullscreenButton").click()
    assert page.evaluate("Boolean(document.fullscreenElement)")
    page.locator("#fullscreenButton").click()
    before = position(page)
    other = page.context.new_page()
    other.goto("about:blank")
    other.bring_to_front()
    page.wait_for_timeout(3000)
    page.bring_to_front()
    other.close()
    assert position(page) > before + 1
    before = position(page)
    page.wait_for_timeout(1100)  # let the persisted session snapshot catch up
    page.reload(wait_until="domcontentloaded")
    try:
        page.wait_for_function(
            "seconds => document.querySelector('#video').currentTime > seconds",
            arg=before,
            timeout=15000,
        )
    except Exception:
        print(
            page.evaluate("""() => ({time: video.currentTime, paused: video.paused,
          error: video.error?.message, replays: playerTest.replays,
          stage: stageError.hidden, notice: rebufferNotice.hidden,
          session: localStorage.getItem('avorythm-player-test-session')})"""),
            flush=True,
        )
        raise
    # A native decoder fault must rebuild from the producer and resume automatically.
    replays = page.evaluate("playerTest.replays")
    before = position(page)
    page.evaluate("playerTest.corrupt()")
    page.wait_for_function("count => playerTest.replays > count", arg=replays, timeout=15000)
    try:
        page.wait_for_function(
            "seconds => document.querySelector('#video').currentTime > seconds + .5",
            arg=before,
            timeout=15000,
        )
    except Exception:
        print(
            page.evaluate("""() => ({time: video.currentTime, paused: video.paused,
          error: video.error?.message, replays: playerTest.replays,
          stage: stageError.hidden, notice: rebufferNotice.hidden,
          buffered: Array.from({length: video.buffered.length}, (_, i) =>
            [video.buffered.start(i), video.buffered.end(i)])})"""),
            flush=True,
        )
        raise
    assert page.locator("#stageError").is_hidden()
    # Missing producer response must expose a dismissible, bounded recovery failure.
    seek(page, 2)
    producer.evaluate("producerTest.blockReplay(true)")
    page.evaluate("document.querySelector('#video').dispatchEvent(new Event('error'))")
    page.locator("#stageError").wait_for(state="visible", timeout=15000)
    stage = page.locator(".video-stage").bounding_box()
    error = page.locator("#stageError").bounding_box()
    assert stage and error and error["height"] < stage["height"] / 2
    page.locator("#dismissStageError").click()
    assert page.locator("#stageError").is_hidden()
    producer.evaluate("producerTest.blockReplay(false)")
    # The retry control remains usable after acknowledgement through the main play control.
    retry_count = page.evaluate("playerTest.replays")
    page.locator("#playButton").click()
    page.wait_for_function("count => playerTest.replays > count", arg=retry_count, timeout=15000)
    page.wait_for_function("!document.querySelector('#video').paused", timeout=15000)
    producer.evaluate("producerTest.warning()")
    page.locator("#playerWarning").wait_for(state="visible")
    page.locator("#dismissPlayerWarning").click()
    assert page.locator("#playerWarning").is_hidden()
    producer.evaluate("producerTest.warning('groq_auth_failed')")
    page.locator("#playerWarning").wait_for(state="visible")
    page.locator("#playerWarning").wait_for(state="hidden", timeout=15000)
    assert not errors, errors
    return {
        "position": position(page),
        "replays": page.evaluate("playerTest.replays"),
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--soak-seconds", type=float, default=0)
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(ModuleHandler, directory=str(root))
    )
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=not args.headed)
            context = browser.new_context(viewport={"width": 1360, "height": 920})
            context.add_init_script(path=root / "tests/browser/player-recovery-bootstrap.js")
            producer = context.new_page()
            duration = max(30, args.soak_seconds + 15)
            base_url = f"http://127.0.0.1:{server.server_port}"
            producer.goto(
                f"{base_url}/tests/browser/player-recovery-producer.html?duration={duration}"
            )
            print(f"Recording {duration:g}s native MediaRecorder fixture...", flush=True)
            producer.evaluate("producerTest.fixture.then(() => true)")
            for engine in ("gemini", "whisper"):
                producer.evaluate("localStorage.removeItem('avorythm-player-test-session')")
                page = context.new_page()
                url = f"{base_url}/extension/player.html?engine={engine}"
                result = verify_player(
                    page, producer, url, args.soak_seconds if engine == "gemini" else 0
                )
                print(f"PASS {engine} {json.dumps(result)}", flush=True)
                page.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
    main()
