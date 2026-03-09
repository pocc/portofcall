FROM python:3.12-alpine

WORKDIR /app

RUN pip install --no-cache-dir pymodbus==3.6.4

COPY server.py .

EXPOSE 502

CMD ["python", "-u", "server.py"]
