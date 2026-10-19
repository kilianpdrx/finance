FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

# Stamped by CI from the git tag (see .github/workflows/release.yml). Local and
# source runs report "dev", which is honest rather than a fake version number.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# "The current month" — and a budget amount set "from this month on" — follow
# the user's clock, not UTC: otherwise the month changed 1–2 hours late here.
# Set in the IMAGE because installs update by relaunching, which downloads
# images, never a new compose file. A compose `TZ` still overrides it.
ENV TZ=Europe/Paris

EXPOSE 8000

CMD ["sh", "-c", "python -m alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"]
