FROM alpine:3.19

RUN apk add --no-cache net-snmp

COPY snmpd.conf /etc/snmp/snmpd.conf

EXPOSE 161/udp

CMD ["snmpd", "-f", "-Lo", "-C", "-c", "/etc/snmp/snmpd.conf"]
