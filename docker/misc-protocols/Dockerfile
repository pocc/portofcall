FROM python:3.12-alpine

WORKDIR /app

COPY server.py .

RUN adduser -D -u 1000 protocoluser && \
    chown -R protocoluser:protocoluser /app

USER protocoluser

# QOTD(17), WHOIS(43), Gopher(70), Ident(113), NNTP(119), DICT(2628)
EXPOSE 17 43 70 113 119 2628

CMD ["python", "-u", "server.py"]
