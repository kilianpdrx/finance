import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import DB_PATH
from models import Base

config = context.config

# `fileConfig` replaces the root logger's handlers with alembic.ini's console-only
# one, pins root to WARN and disables every existing logger. That is what you want
# from the `alembic` CLI — but the app also runs migrations in-process at startup
# (`database.sync_schema`), where it would tear out the RotatingFileHandler that
# `main._configure_logging()` just installed and silence the app for the rest of
# the run. Programmatic callers set `embedded` to keep their own configuration.
if config.config_file_name and not config.attributes.get("embedded"):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def get_url():
    return f"sqlite:///{DB_PATH}"

def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
