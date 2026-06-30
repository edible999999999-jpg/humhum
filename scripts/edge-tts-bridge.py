#!/usr/bin/env python3
"""
Edge TTS Bridge — OpenAI-compatible TTS server using Microsoft Edge TTS (free).
Listens on port 5050, provides POST /v1/audio/speech endpoint.
"""

import asyncio
import io
import json
import sys
from aiohttp import web

import edge_tts

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
PORT = 5050


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


async def handle_speech(request: web.Request) -> web.StreamResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid JSON"}, status=400, headers=CORS_HEADERS)

    text = body.get("input", "")
    voice = body.get("voice", DEFAULT_VOICE)
    speed = body.get("speed", 1.0)

    if not text:
        return web.json_response({"error": "input is required"}, status=400, headers=CORS_HEADERS)

    rate_str = f"{int((speed - 1) * 100):+d}%"

    communicate = edge_tts.Communicate(text, voice, rate=rate_str)
    buf = io.BytesIO()

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])

    buf.seek(0)
    return web.Response(
        body=buf.read(),
        content_type="audio/mpeg",
        headers={**CORS_HEADERS, "Content-Disposition": "inline"},
    )


async def handle_options(request: web.Request) -> web.Response:
    return web.Response(status=204, headers=CORS_HEADERS)


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response(
        {"status": "ok", "service": "edge-tts-bridge"},
        headers=CORS_HEADERS,
    )


app = web.Application()
app.router.add_route("OPTIONS", "/v1/audio/speech", handle_options)
app.router.add_post("/v1/audio/speech", handle_speech)
app.router.add_get("/health", handle_health)

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    print(f"Edge TTS Bridge starting on http://localhost:{port}")
    web.run_app(app, host="127.0.0.1", port=port, print=lambda _: None)
