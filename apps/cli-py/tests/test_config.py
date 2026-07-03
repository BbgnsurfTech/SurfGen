import json
import os
import stat

from surfgen_cli.config import config_path, load_config, save_config


def test_save_creates_dir_0700_and_file_0600(tmp_path, monkeypatch):
    # Arrange
    monkeypatch.setenv("SURFGEN_CONFIG_HOME", str(tmp_path / "home"))

    # Act
    save_config({"apiUrl": "http://x", "accessToken": "secret"})

    # Assert
    directory = tmp_path / "home"
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert stat.S_IMODE(config_path().stat().st_mode) == 0o600
    assert json.loads(config_path().read_text())["accessToken"] == "secret"


def test_save_leaves_no_temp_files(tmp_path, monkeypatch):
    monkeypatch.setenv("SURFGEN_CONFIG_HOME", str(tmp_path))

    save_config({"apiUrl": "http://x"})
    save_config({"apiUrl": "http://y"})

    leftovers = [p for p in tmp_path.iterdir() if p.name != "config.json"]
    assert leftovers == []
    assert load_config()["apiUrl"] == "http://y"


def test_load_returns_default_when_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("SURFGEN_CONFIG_HOME", str(tmp_path / "nope"))
    monkeypatch.delenv("SURFGEN_API_URL", raising=False)

    config = load_config()

    assert config["apiUrl"] == "http://localhost:4000"


def test_env_api_url_overrides_stored(tmp_path, monkeypatch):
    monkeypatch.setenv("SURFGEN_CONFIG_HOME", str(tmp_path))
    save_config({"apiUrl": "http://stored"})
    monkeypatch.setenv("SURFGEN_API_URL", "http://env")

    assert load_config()["apiUrl"] == "http://env"


def test_load_tolerates_corrupt_config(tmp_path, monkeypatch):
    monkeypatch.setenv("SURFGEN_CONFIG_HOME", str(tmp_path))
    os.makedirs(tmp_path, exist_ok=True)
    config_path().write_text("{not json")

    assert "apiUrl" in load_config()
