FROM python:3.13.11-slim-bookworm
RUN pip install --no-cache-dir uv==0.9.22
WORKDIR /app/backend
ENV UV_PYTHON_DOWNLOADS=0 UV_LINK_MODE=copy UV_CACHE_DIR=/tmp/uv-cache \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project && uv cache clean
COPY src ./src
RUN uv sync --locked --no-dev --no-editable && uv cache clean
ENV PATH="/app/backend/.venv/bin:$PATH"
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["icgc-health"]
CMD ["uv", "run", "--no-sync", "icgc-viewer"]
