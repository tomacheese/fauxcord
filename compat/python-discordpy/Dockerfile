# syntax=docker/dockerfile:1
# Build context is compat/ (see compose.yaml), so COPY paths are prefixed
# with the library directory and the shared common/ dir.
FROM python:3.14-slim
WORKDIR /app
COPY python-discordpy/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY python-discordpy/verify.py ./
COPY common ./common
CMD ["python", "verify.py"]
