"""CLI config shared with the Node CLI: ~/.surfgen/config.json (camelCase keys).

Security invariants (mirror apps/cli/src/client.ts):
- directory mode 0700, file mode 0600
- atomic write (temp file + rename) so a crash never leaves partial credentials
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

DEFAULT_API_URL = "http://localhost:4000"


def config_dir() -> Path:
    return Path(os.environ.get("SURFGEN_CONFIG_HOME", str(Path.home() / ".surfgen")))


def config_path() -> Path:
    return config_dir() / "config.json"


def load_config() -> dict[str, Any]:
    api_url = os.environ.get("SURFGEN_API_URL", DEFAULT_API_URL)
    try:
        stored = json.loads(config_path().read_text())
        if not isinstance(stored, dict):
            raise ValueError("config is not an object")
    except (OSError, ValueError):
        stored = {}
    return {"apiUrl": api_url if "SURFGEN_API_URL" in os.environ else stored.get("apiUrl", api_url), **{k: v for k, v in stored.items() if k != "apiUrl"}}


def save_config(config: dict[str, Any]) -> None:
    directory = config_dir()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    fd, temp_path = tempfile.mkstemp(dir=directory, prefix=".config-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(config, handle, indent=2)
        os.chmod(temp_path, 0o600)
        os.replace(temp_path, config_path())
    except BaseException:
        Path(temp_path).unlink(missing_ok=True)
        raise
