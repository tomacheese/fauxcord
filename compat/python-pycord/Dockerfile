# syntax=docker/dockerfile:1
# Build context is compat/ (see compose.yaml), so COPY paths are prefixed
# with the library directory and the shared common/ dir.
# py-cord 2.8.1 requires Python >=3.10,<3.15, so this image cannot use 3.15.
FROM python:3.15-slim
WORKDIR /app
COPY python-pycord/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY python-pycord/verify.py ./
COPY common ./common
CMD ["python", "verify.py"]
