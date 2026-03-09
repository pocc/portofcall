vcl 4.1;

backend default {
    .host = "127.0.0.1";
    .port = "8080";
}

sub vcl_recv {
    return (synth(200, "OK"));
}

sub vcl_synth {
    set resp.http.Content-Type = "text/plain";
    synthetic("Port of Call Varnish Test Server");
    return (deliver);
}
