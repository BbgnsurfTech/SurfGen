"""surfgen-py — Python mirror of the Node CLI (same ~/.surfgen/config.json).

Credential rules (identical to the Node CLI):
- passwords/API keys are NEVER accepted as arguments
- sources: env var (SURFGEN_PASSWORD / SURFGEN_API_KEY) or hidden prompt
"""

from __future__ import annotations

import json
import os
import sys
from getpass import getpass
from typing import Any

import typer

from .client import ApiError, SurfGenClient
from .config import load_config, save_config

app = typer.Typer(name="surfgen-py", help="SurfGen — provider-agnostic AI video generation", no_args_is_help=True)
auth_app = typer.Typer(help="authentication", no_args_is_help=True)
orgs_app = typer.Typer(help="organizations", no_args_is_help=True)
projects_app = typer.Typer(help="projects", no_args_is_help=True)
videos_app = typer.Typer(help="videos", no_args_is_help=True)
app.add_typer(auth_app, name="auth")
app.add_typer(orgs_app, name="orgs")
app.add_typer(projects_app, name="projects")
app.add_typer(videos_app, name="videos")


def _print(value: Any) -> None:
    typer.echo(json.dumps(value, indent=2))


def _fail(error: Exception) -> None:
    typer.secho(f"✗ {error}", err=True, fg="red")
    raise typer.Exit(code=1)


def _secret(env_var: str, label: str) -> str:
    value = os.environ.get(env_var) or (sys.stdin.readline().strip() if not sys.stdin.isatty() else getpass(f"{label}: "))
    if not value:
        _fail(ValueError(f"empty {label.lower()}"))
    return value


def _require(config: dict[str, Any], key: str, hint: str) -> str:
    value = config.get(key)
    if not value:
        _fail(ValueError(hint))
    return value


def _project_scope() -> tuple[dict[str, Any], str, str]:
    config = load_config()
    org = _require(config, "defaultOrgId", "no default org — run 'surfgen-py orgs use <orgId>'")
    project = _require(config, "defaultProjectId", "no default project — run 'surfgen-py projects use <projectId>'")
    return config, org, project


# ------------------------------------------------------------------------ auth
@auth_app.command("login")
def auth_login(email: str = typer.Option(..., "--email")) -> None:
    """Log in — password from SURFGEN_PASSWORD, piped stdin, or hidden prompt."""
    password = _secret("SURFGEN_PASSWORD", "Password")
    config = load_config()
    try:
        data = SurfGenClient(config).request("POST", "/v1/auth/login", {"email": email, "password": password})
    except ApiError as error:
        _fail(error)
    save_config({**config, "accessToken": data["accessToken"], "refreshToken": data["refreshToken"]})
    typer.secho("✓ logged in", err=True)


@auth_app.command("use-key")
def auth_use_key() -> None:
    """Store an API key — from SURFGEN_API_KEY, piped stdin, or hidden prompt."""
    api_key = _secret("SURFGEN_API_KEY", "API key")
    save_config({**load_config(), "apiKey": api_key})
    typer.secho("✓ API key stored", err=True)


@auth_app.command("logout")
def auth_logout() -> None:
    config = load_config()
    if config.get("refreshToken"):
        try:
            SurfGenClient(config).request("POST", "/v1/auth/logout", {"refreshToken": config["refreshToken"]})
        except ApiError:
            pass
    save_config({"apiUrl": config["apiUrl"]})
    typer.secho("✓ logged out", err=True)


# ------------------------------------------------------------------------ orgs
@orgs_app.command("list")
def orgs_list() -> None:
    try:
        _print(SurfGenClient().request("GET", "/v1/orgs"))
    except ApiError as error:
        _fail(error)


@orgs_app.command("use")
def orgs_use(org_id: str) -> None:
    save_config({**load_config(), "defaultOrgId": org_id})
    typer.secho(f"✓ default org: {org_id}", err=True)


# -------------------------------------------------------------------- projects
@projects_app.command("list")
def projects_list() -> None:
    config = load_config()
    org = _require(config, "defaultOrgId", "no default org — run 'surfgen-py orgs use <orgId>'")
    try:
        _print(SurfGenClient(config).request("GET", f"/v1/orgs/{org}/projects"))
    except ApiError as error:
        _fail(error)


@projects_app.command("create")
def projects_create(
    name: str = typer.Option(..., "--name"),
    description: str = typer.Option(None, "--description"),
) -> None:
    config = load_config()
    org = _require(config, "defaultOrgId", "no default org — run 'surfgen-py orgs use <orgId>'")
    body: dict[str, Any] = {"name": name}
    if description:
        body["description"] = description
    try:
        _print(SurfGenClient(config).request("POST", f"/v1/orgs/{org}/projects", body))
    except ApiError as error:
        _fail(error)


@projects_app.command("use")
def projects_use(project_id: str) -> None:
    save_config({**load_config(), "defaultProjectId": project_id})
    typer.secho(f"✓ default project: {project_id}", err=True)


# ---------------------------------------------------------------------- videos
@videos_app.command("list")
def videos_list() -> None:
    config, org, project = _project_scope()
    try:
        _print(SurfGenClient(config).request("GET", f"/v1/orgs/{org}/projects/{project}/videos"))
    except ApiError as error:
        _fail(error)


@videos_app.command("create")
def videos_create(
    title: str = typer.Option(..., "--title"),
    script: str = typer.Option(None, "--script", help="presenter script (omit to have the LLM write one)"),
    language: str = typer.Option("en", "--language", help="BCP-47 tag"),
    voice: str = typer.Option(None, "--voice"),
    avatar: str = typer.Option(None, "--avatar"),
    generate: bool = typer.Option(False, "--generate", help="immediately queue generation"),
) -> None:
    config, org, project = _project_scope()
    body: dict[str, Any] = {"title": title, "language": language}
    if script:
        body["script"] = script
    if voice:
        body["voiceId"] = voice
    if avatar:
        body["avatarId"] = avatar
    client = SurfGenClient(config)
    try:
        video = client.request("POST", f"/v1/orgs/{org}/projects/{project}/videos", body)
        if generate:
            _print(client.request("POST", f"/v1/orgs/{org}/projects/{project}/videos/{video['id']}/generate"))
        else:
            _print(video)
    except ApiError as error:
        _fail(error)


@videos_app.command("status")
def videos_status(video_id: str) -> None:
    config, org, project = _project_scope()
    try:
        _print(SurfGenClient(config).request("GET", f"/v1/orgs/{org}/projects/{project}/videos/{video_id}"))
    except ApiError as error:
        _fail(error)


@videos_app.command("generate")
def videos_generate(video_id: str) -> None:
    config, org, project = _project_scope()
    try:
        _print(SurfGenClient(config).request("POST", f"/v1/orgs/{org}/projects/{project}/videos/{video_id}/generate"))
    except ApiError as error:
        _fail(error)


@videos_app.command("cancel")
def videos_cancel(video_id: str) -> None:
    config, org, project = _project_scope()
    try:
        _print(SurfGenClient(config).request("POST", f"/v1/orgs/{org}/projects/{project}/videos/{video_id}/cancel"))
    except ApiError as error:
        _fail(error)


if __name__ == "__main__":
    app()
