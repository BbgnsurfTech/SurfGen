import json

import httpx
import pytest

from surfgen_cli.client import ApiError, SurfGenClient


def envelope(data=None, error=None):
    return {"success": error is None, "data": data, "error": error, "meta": None}


def make_client(handler, config=None, tmp_path=None, monkeypatch=None):
    if monkeypatch and tmp_path:
        monkeypatch.setenv("SURFGEN_CONFIG_HOME", str(tmp_path))
    return SurfGenClient(
        config or {"apiUrl": "http://api.test"},
        transport=httpx.MockTransport(handler),
    )


def test_unwraps_success_envelope():
    def handler(request):
        return httpx.Response(200, json=envelope(data={"id": "org_1"}))

    assert make_client(handler).request("GET", "/v1/orgs") == {"id": "org_1"}


def test_raises_api_error_with_code():
    def handler(request):
        return httpx.Response(404, json=envelope(error={"code": "NOT_FOUND", "message": "missing"}))

    with pytest.raises(ApiError) as exc:
        make_client(handler).request("GET", "/v1/orgs/nope")
    assert exc.value.code == "NOT_FOUND"


def test_api_key_header_wins_over_jwt():
    seen = {}

    def handler(request):
        seen.update(request.headers)
        return httpx.Response(200, json=envelope(data=[]))

    make_client(handler, {"apiUrl": "http://api.test", "apiKey": "sk_x", "accessToken": "jwt"}).request("GET", "/v1/orgs")
    assert seen["x-api-key"] == "sk_x"
    assert "authorization" not in seen


def test_auto_refresh_once_on_401(tmp_path, monkeypatch):
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/v1/auth/refresh":
            return httpx.Response(200, json=envelope(data={"accessToken": "new", "refreshToken": "newr"}))
        if len([c for c in calls if c == "/v1/orgs"]) == 1:
            return httpx.Response(401, json=envelope(error={"code": "UNAUTHORIZED", "message": "expired"}))
        return httpx.Response(200, json=envelope(data=["ok"]))

    client = make_client(
        handler,
        {"apiUrl": "http://api.test", "accessToken": "old", "refreshToken": "r1"},
        tmp_path,
        monkeypatch,
    )
    assert client.request("GET", "/v1/orgs") == ["ok"]
    assert calls == ["/v1/orgs", "/v1/auth/refresh", "/v1/orgs"]
    # rotated tokens persisted
    stored = json.loads((tmp_path / "config.json").read_text())
    assert stored["refreshToken"] == "newr"


def test_401_without_refresh_token_fails_fast():
    def handler(request):
        return httpx.Response(401, json=envelope(error={"code": "UNAUTHORIZED", "message": "no"}))

    with pytest.raises(ApiError):
        make_client(handler).request("GET", "/v1/orgs")
