FROM alpine:3.19

RUN apk add --no-cache bird

COPY bird.conf /etc/bird/bird.conf

EXPOSE 179

CMD ["bird", "-f", "-c", "/etc/bird/bird.conf"]
