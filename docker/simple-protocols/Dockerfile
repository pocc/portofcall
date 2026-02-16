FROM python:3.12-alpine

WORKDIR /app

COPY server.py .

# Run as non-root user for security
RUN adduser -D -u 1000 protocoluser && \
    chown -R protocoluser:protocoluser /app

USER protocoluser

# Expose all protocol ports
EXPOSE 7 9 13 19 37 79

CMD ["python", "-u", "server.py"]
