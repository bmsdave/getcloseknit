FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /service
COPY pyproject.toml README.md ./
COPY area_api ./area_api
RUN pip install --no-cache-dir .

USER 65532:65532
EXPOSE 8080
# Liveness only: any HTTP answer from /health (503 while no release is loaded
# is still a live process); readiness is checked by deploy/preflight.sh.
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD ["python", "-c", "import http.client as h; c = h.HTTPConnection('127.0.0.1', 8080, timeout=4); c.request('GET', '/health'); c.getresponse()"]
# Workers (uvicorn reads WEB_CONCURRENCY; area_api.ratelimit splits each allowance between them). What a release
# derives is built once into release_artifact (area_api.release_build) and read by every worker, so they share it
# instead of each warming its own. 3 fits the 12 GB host beside Postgres and web (~0.5-1 GB a worker); the MCP
# endpoint runs as one process of its own (deploy/docker-compose.yml mcp: its sessions live in memory).
ENV WEB_CONCURRENCY=3
CMD ["uvicorn", "area_api.app:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
