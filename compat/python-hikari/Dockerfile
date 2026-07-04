# syntax=docker/dockerfile:1
# Build context is compat/ (see docker-compose.yml), so COPY paths are prefixed
# with the library directory and the shared common/ dir.
FROM python:3.12-slim
WORKDIR /app
COPY python-hikari/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY python-hikari/verify.py ./
COPY common ./common
CMD ["python", "verify.py"]
