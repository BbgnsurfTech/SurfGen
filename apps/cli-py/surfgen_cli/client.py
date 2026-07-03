"""Envelope-aware REST client mirroring apps/cli/src/client.ts.

- unwraps { success, data, error } envelopes
- API key via x-api-key header, JWT via Authorization: Bearer
- one automatic refresh-and-retry on 401 when a refreshToken is stored
"""

from __future__ import annotations

from typing import Any

import httpx

from .config import load_config, save_config


class ApiError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class SurfGenClient:
    def __init__(self, config: dict[str, Any] | None = None, transport: httpx.BaseTransport | None = None) -> None:
        self.config = config if config is not None else load_config()
        self._client = httpx.Client(
            base_url=self.config["apiUrl"],
            timeout=30.0,
            transport=transport,
        )

    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.config.get("apiKey"):
            headers["x-api-key"] = self.config["apiKey"]
        elif self.config.get("accessToken"):
            headers["authorization"] = f"Bearer {self.config['accessToken']}"
        return headers

    def request(self, method: str, path: str, body: Any | None = None, retry_on_auth: bool = True) -> Any:
        response = self._client.request(method, path, json=body, headers=self._headers())
        if response.status_code == 401 and retry_on_auth and self.config.get("refreshToken"):
            self._refresh()
            return self.request(method, path, body, retry_on_auth=False)
        try:
            envelope = response.json()
        except ValueError as error:
            raise ApiError("BAD_RESPONSE", f"non-JSON response ({response.status_code})") from error
        if not envelope.get("success"):
            error = envelope.get("error") or {}
            raise ApiError(error.get("code", "UNKNOWN"), error.get("message", "request failed"))
        return envelope.get("data")

    def _refresh(self) -> None:
        data = self.request(
            "POST",
            "/v1/auth/refresh",
            {"refreshToken": self.config["refreshToken"]},
            retry_on_auth=False,
        )
        self.config = {
            **self.config,
            "accessToken": data["accessToken"],
            "refreshToken": data["refreshToken"],
        }
        save_config(self.config)

    def close(self) -> None:
        self._client.close()
