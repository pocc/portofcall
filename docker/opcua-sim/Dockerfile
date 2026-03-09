FROM python:3.12-alpine

WORKDIR /app

RUN pip install --no-cache-dir asyncua==1.1.0

COPY server.py .

EXPOSE 4840

CMD ["python", "-u", "server.py"]
