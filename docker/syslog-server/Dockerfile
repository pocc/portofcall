FROM alpine:3.19

RUN apk add --no-cache rsyslog

COPY rsyslog.conf /etc/rsyslog.conf

EXPOSE 514/tcp
EXPOSE 514/udp

CMD ["rsyslogd", "-n", "-f", "/etc/rsyslog.conf"]
