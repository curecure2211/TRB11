FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    TRB_AUTO_PREFETCH=1

WORKDIR /app
COPY . /app

RUN python -m py_compile serve_trb.py \
    && python tests/test_project.py \
    && python tests/test_server_geometry.py

EXPOSE 8080
CMD ["sh", "-c", "python serve_trb.py --host 0.0.0.0 --port ${PORT} --auto-prefetch"]
