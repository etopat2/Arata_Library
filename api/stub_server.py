"""Test-only contract stub. It never connects to a database or grants access."""
from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, RefResolver
from validate_contracts import load
from policy_evaluator import evaluate


def make_handler():
    spec, policy, _ = load()
    routes = []
    for path, methods in spec["paths"].items():
        pattern = "^" + re.sub(r"\{[^}]+\}", "[^/]+", path) + "$"
        for method, operation in methods.items(): routes.append((method.upper(), re.compile(pattern), operation))
    resolver = RefResolver.from_schema(spec)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass

        def _send(self, status, body, media="application/json"):
            payload = (body if media == "text/csv" else json.dumps(body)).encode()
            self.send_response(status); self.send_header("Content-Type", media)
            self.send_header("Content-Length", str(len(payload))); self.end_headers()
            self.wfile.write(payload)

        def _handle(self):
            target = urlsplit(self.path).path
            match = next((op for method, pattern, op in routes if method == self.command and pattern.match(target)), None)
            if match is None: return self._send(404, {"code": "NOT_FOUND"})
            raw_context = self.headers.get("X-Stub-Context", "{}")
            try: context = json.loads(raw_context)
            except json.JSONDecodeError: return self._send(400, {"code": "INVALID_TEST_CONTEXT"})
            rule = policy["policies"][match["x-policy-id"]]
            allowed, reason = evaluate(rule, context)
            if not allowed:
                return self._send(403, {"type": "https://api.arata.example/problems/403", "title": "Access denied", "status": 403, "code": reason, "requestId": "stub"}, "application/problem+json")
            body_contract = match.get("requestBody", {}).get("content", {}).get("application/json")
            if body_contract:
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    body = json.loads(self.rfile.read(length))
                    Draft202012Validator(body_contract["schema"], resolver=resolver).validate(body)
                except Exception:
                    return self._send(400, {"type": "https://api.arata.example/problems/400", "title": "Invalid request", "status": 400, "code": "VALIDATION_FAILED", "requestId": "stub"}, "application/problem+json")
            success_code = next(int(code) for code in match["responses"] if code.startswith("2"))
            content = match["responses"][str(success_code)]["content"]
            media = "application/json" if "application/json" in content else "text/csv"
            self._send(success_code, content[media]["example"], media)

        def do_GET(self): self._handle()
        def do_POST(self): self._handle()
        def do_PUT(self): self._handle()
        def do_PATCH(self): self._handle()
        def do_DELETE(self): self._handle()

    return Handler


def start_server():
    return ThreadingHTTPServer(("127.0.0.1", 0), make_handler())
