FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y krb5-kdc krb5-admin-server && \
    rm -rf /var/lib/apt/lists/*

COPY krb5.conf /etc/krb5.conf
COPY kdc.conf /etc/krb5kdc/kdc.conf
COPY kadm5.acl /etc/krb5kdc/kadm5.acl
COPY init-kdc.sh /init-kdc.sh
RUN chmod +x /init-kdc.sh

EXPOSE 88/tcp
EXPOSE 88/udp

CMD ["/init-kdc.sh"]
