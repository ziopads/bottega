"""The database connection for every pipeline script.

Reads DATABASE_URL_UNPOOLED from the environment or from .env.local at the repo
root. The unpooled string is required: migrations and loaders run inside one
transaction, which the pooled endpoint does not guarantee.

Nothing here prints a connection string, ever.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

PIPELINE = Path(__file__).parent
ROOT = PIPELINE.parent


def env_value(name: str) -> str | None:
    """A variable from the environment, else from .env.local."""
    value = os.environ.get(name)
    if value:
        return value
    env = ROOT / ".env.local"
    if env.exists():
        pattern = re.compile(rf'^\s*{re.escape(name)}\s*=\s*"?([^"\s]+)"?\s*$')
        for line in env.read_text(encoding="utf-8").splitlines():
            m = pattern.match(line)
            if m:
                return m.group(1)
    return None


def database_url() -> str:
    value = env_value("DATABASE_URL_UNPOOLED")
    if not value:
        sys.exit("DATABASE_URL_UNPOOLED is not set and was not found in .env.local")
    return value


def connect():
    try:
        import psycopg
    except ImportError:
        sys.exit('psycopg is not installed. Run: pipeline/.venv/bin/pip install -r pipeline/requirements.txt')
    return psycopg.connect(database_url())
