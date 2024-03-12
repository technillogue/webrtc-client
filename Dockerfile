FROM python:3.11-slim
RUN --mount=type=cache,target=/root/.cache/pip pip install replicate aiohttp[speedups] aiortc
WORKDIR /app
COPY ./client.js ./index.html ./server.py /app/
ENTRYPOINT ["/usr/local/bin/python3.11", "server.py"]
