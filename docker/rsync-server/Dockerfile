FROM alpine:3.19

RUN apk add --no-cache rsync

COPY rsyncd.conf /etc/rsyncd.conf

RUN mkdir -p /data/testmodule && \
    echo "This is a test file for rsync protocol testing." > /data/testmodule/test.txt && \
    echo "Port of Call rsync test data." > /data/testmodule/readme.txt

EXPOSE 873

CMD ["rsync", "--daemon", "--no-detach", "--config=/etc/rsyncd.conf"]
