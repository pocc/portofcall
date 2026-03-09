FROM alpine:3.19

RUN apk add --no-cache subversion

COPY svnserve.conf /etc/svnserve.conf
COPY init.sh /init.sh
RUN chmod +x /init.sh

EXPOSE 3690

CMD ["/init.sh"]
