# -*- mode: python ; coding: utf-8 -*-
# PyInstaller recipe of the desktop app's backend: one folder (onedir) holding a
# `finance-backend` executable and everything it needs, so friends need no Python.
#
#   pip install -r requirements-desktop.txt
#   pyinstaller finance-backend.spec        # → dist/finance-backend/
#
# Build it on the system it is for (macOS arm64, Windows x64): PyInstaller does
# not cross-compile. Run from a clean virtualenv holding requirements-desktop.txt
# only — whatever else is installed (scipy, scikit-learn…) can end up inside.
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = Path(SPECPATH)  # noqa: F821 — provided by PyInstaller

# Alembic reads env.py and the migrations from DISK (it imports them by file
# path), so they ship as files beside the executable, in alembic/ next to
# database.py's place (database.ALEMBIC_DIR). Not alembic.ini: the app gives
# Alembic its settings in code. No __pycache__.
datas = [
    (str(ROOT / "alembic" / "env.py"), "alembic"),
    (str(ROOT / "alembic" / "script.py.mako"), "alembic"),
]
datas += [(str(p), "alembic/versions") for p in sorted((ROOT / "alembic" / "versions").glob("*.py"))]

binaries = []
hiddenimports = [
    # Only alembic/env.py, loaded from disk at runtime, imports it.
    "logging.config",
    # curl_cffi (yfinance's HTTP client) loads its compiled module through cffi.
    "_cffi_backend",
    # SQLAlchemy imports a dialect's driver by name, from the database URL:
    # sqlite+aiosqlite for the app, plain sqlite for Alembic.
    "aiosqlite",
    "sqlalchemy.dialects.sqlite.aiosqlite",
    "sqlalchemy.dialects.sqlite.pysqlite",
    "greenlet",
]
# Alembic's `op` / `context` are proxies filled at runtime, and its dialect
# implementations are looked up by name. Not its test kit (it needs pytest).
hiddenimports += collect_submodules("alembic", filter=lambda name: not name.startswith("alembic.testing"))
# Routes and services imported inside functions (reports, payroll packs…).
hiddenimports += collect_submodules("routers") + collect_submodules("services")
# No hook upstream: its libcurl and certificate bundle come along explicitly.
_d, _b, _h = collect_all("curl_cffi")
datas += _d
binaries += _b
hiddenimports += _h

a = Analysis(
    [str(ROOT / "desktop_server.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "_tkinter", "pytest", "_pytest", "IPython", "scipy", "sklearn"],
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    # UTF-8 mode, as the Docker image has it (LANG=C.UTF-8). An app opened from
    # the Finder or the Start menu gets no LANG, and a frozen Python does not
    # coerce that to UTF-8: text read or written without an explicit encoding
    # would be ASCII on macOS, cp1252 on Windows.
    [("X utf8=1", None, "OPTION")],
    exclude_binaries=True,
    name="finance-backend",
    # A console program: its stdout/stderr are what Electron writes to
    # desktop.log. Electron starts it with `windowsHide`, so no window appears.
    console=True,
    upx=False,
)
coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    upx=False,
    name="finance-backend",
)
