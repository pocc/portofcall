FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y asterisk && \
    rm -rf /var/lib/apt/lists/*

COPY sip.conf /etc/asterisk/sip.conf
COPY manager.conf /etc/asterisk/manager.conf
COPY extensions.conf /etc/asterisk/extensions.conf

EXPOSE 5060/udp 5060/tcp 5061/tcp 5038

CMD ["asterisk", "-f", "-vvv"]
