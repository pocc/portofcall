import type { CurlExample } from '../components/ApiExamples';


const examples: Record<string, CurlExample[]> = {
  ActiveMQ: [
    { title: 'POST /activemq/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/activemq/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61616,"timeout":5000}'` },
    { title: 'POST /activemq/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/activemq/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61613,"username":"admin","password":"admin","timeout":8000}'` },
    { title: 'POST /activemq/subscribe', command: `curl -X POST 'https://portofcall.ross.gg/api/activemq/subscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61613,"username":"admin","password":"admin","destination":"/queue/orders.incoming","maxMessages":10,"timeout":15000}'` },
    { title: 'POST /activemq/send', command: `curl -X POST 'https://portofcall.ross.gg/api/activemq/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61613,"username":"admin","password":"admin","destination":"/queue/orders.incoming","body":"{\\"orderId\\":\\"ORD-12345\\",\\"status\\":\\"pending\\"}","contentType":"application/json","timeout":8000}'` },
    { title: 'POST /activemq/durable-subscribe', command: `curl -X POST 'https://portofcall.ross.gg/api/activemq/durable-subscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61613,"username":"admin","password":"admin","destination":"/topic/events.notifications","subscriptionId":"sub-notify-001","timeout":15000}'` },
    { title: 'POST /activemq/durable-unsubscribe', command: `curl -X POST 'https://portofcall.ross.gg/api/activemq/durable-unsubscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61613,"username":"admin","password":"admin","subscriptionId":"sub-notify-001","timeout":8000}'` },
    { title: 'POST /activemq/info', command: `curl -X POST 'https://portofcall.ross.gg/api/activemq/info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61616,"timeout":5000}'` },
    { title: 'POST /activemq/queues', command: `curl -X POST 'https://portofcall.ross.gg/api/activemq/queues' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61616,"timeout":5000}'` },
    { title: 'POST /activemq/admin', command: `curl -X POST 'https://portofcall.ross.gg/api/activemq/admin' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":8161,"username":"admin","password":"admin","brokerName":"production-broker","action":"brokerInfo","timeout":10000}'` },
  ],
  Aerospike: [
    { title: 'POST /aerospike/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/aerospike/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"aero-node1.example.com","port":3000,"timeout":5000}'` },
    { title: 'POST /aerospike/info', command: `curl -X POST 'https://portofcall.ross.gg/api/aerospike/info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"aero-node1.example.com","command":"namespaces","timeout":5000}'` },
    { title: 'POST /aerospike/kv-get', command: `curl -X POST 'https://portofcall.ross.gg/api/aerospike/kv-get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"aero-node1.example.com","port":3000,"namespace":"production","set":"users","key":"user:42","timeout":5000}'` },
    { title: 'POST /aerospike/kv-put', command: `curl -X POST 'https://portofcall.ross.gg/api/aerospike/kv-put' \
  -H 'Content-Type: application/json' \
  -d '{"host":"aero-node1.example.com","port":3000,"namespace":"production","set":"users","key":"user:42","value":"{\\"name\\":\\"Alice\\",\\"email\\":\\"alice@example.com\\"}","timeout":5000}'` },
  ],
  AJP: [
    { title: 'POST /ajp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/ajp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tomcat.example.com","port":8009,"timeout":5000}'` },
    { title: 'POST /ajp/request', command: `curl -X POST 'https://portofcall.ross.gg/api/ajp/request' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tomcat.example.com","port":8009,"method":"GET","path":"/status","headers":{"Host":"tomcat.example.com"},"timeout":8000}'` },
  ],
  AMI: [
    { title: 'POST /ami/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/ami/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","port":5038,"timeout":5000}'` },
    { title: 'POST /ami/command', command: `curl -X POST 'https://portofcall.ross.gg/api/ami/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","port":5038,"username":"admin","secret":"s3cretP@ss","action":"CoreShowChannels","timeout":8000}'` },
    { title: 'POST /ami/originate', command: `curl -X POST 'https://portofcall.ross.gg/api/ami/originate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","port":5038,"username":"admin","secret":"s3cretP@ss","channel":"SIP/1001","context":"default","exten":"2001","priority":1,"timeout":15000}'` },
    { title: 'POST /ami/hangup', command: `curl -X POST 'https://portofcall.ross.gg/api/ami/hangup' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","port":5038,"username":"admin","secret":"s3cretP@ss","channel":"SIP/1001-00000042","timeout":5000}'` },
    { title: 'POST /ami/clicommand', command: `curl -X POST 'https://portofcall.ross.gg/api/ami/clicommand' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","port":5038,"username":"admin","secret":"s3cretP@ss","command":"sip show peers","timeout":8000}'` },
    { title: 'POST /ami/sendtext', command: `curl -X POST 'https://portofcall.ross.gg/api/ami/sendtext' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","port":5038,"username":"admin","secret":"s3cretP@ss","channel":"SIP/1001-00000042","message":"Hello from Port of Call","timeout":5000}'` },
  ],
  AMQP: [
    { title: 'POST /amqp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/amqp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","port":5672,"timeout":5000,"vhost":"/"}'` },
    { title: 'POST /amqp/publish', command: `curl -X POST 'https://portofcall.ross.gg/api/amqp/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","port":5672,"username":"guest","password":"guest","vhost":"/","exchange":"events","exchangeType":"topic","durable":true,"routingKey":"order.created","message":"{\\"orderId\\":\\"ORD-99001\\"}","timeout":8000}'` },
    { title: 'POST /amqp/consume', command: `curl -X POST 'https://portofcall.ross.gg/api/amqp/consume' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","port":5672,"username":"guest","password":"guest","vhost":"/","queue":"order-processing","maxMessages":5,"timeoutMs":10000}'` },
    { title: 'POST /amqp/confirm-publish', command: `curl -X POST 'https://portofcall.ross.gg/api/amqp/confirm-publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","port":5672,"username":"guest","password":"guest","vhost":"/","exchange":"events","exchangeType":"topic","durable":true,"routingKey":"payment.processed","message":"{\\"paymentId\\":\\"PAY-55201\\"}","timeout":8000}'` },
    { title: 'POST /amqp/bind', command: `curl -X POST 'https://portofcall.ross.gg/api/amqp/bind' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","port":5672,"username":"guest","password":"guest","vhost":"/","queue":"notifications","exchange":"events","routingKey":"order.*","timeout":5000}'` },
    { title: 'POST /amqp/get', command: `curl -X POST 'https://portofcall.ross.gg/api/amqp/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","port":5672,"username":"guest","password":"guest","vhost":"/","queue":"order-processing","ack":false,"timeout":5000}'` },
  ],
  AMQPS: [
    { title: 'POST /amqps/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/amqps/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq-tls.example.com","port":5671}'` },
    { title: 'POST /amqps/publish', command: `curl -X POST 'https://portofcall.ross.gg/api/amqps/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq-tls.example.com","port":5671,"username":"guest","password":"guest","exchange":"secure-events","routingKey":"audit.login","message":"{\\"user\\":\\"admin\\",\\"ip\\":\\"10.0.1.55\\"}"}'` },
    { title: 'POST /amqps/consume', command: `curl -X POST 'https://portofcall.ross.gg/api/amqps/consume' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq-tls.example.com","port":5671,"username":"guest","password":"guest","queue":"audit-log","maxMessages":10}'` },
  ],
  // Untestable — proprietary gaming protocol, no standard Docker image
  Battlenet: [
    { title: 'POST /battlenet/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/battlenet/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"bnet-server.example.com","port":1119,"timeout":5000}'` },
    { title: 'POST /battlenet/authinfo', command: `curl -X POST 'https://portofcall.ross.gg/api/battlenet/authinfo' \
  -H 'Content-Type: application/json' \
  -d '{"host":"bnet-server.example.com","port":1119,"timeout":5000}'` },
    { title: 'POST /battlenet/status', command: `curl -X POST 'https://portofcall.ross.gg/api/battlenet/status' \
  -H 'Content-Type: application/json' \
  -d '{"host":"bnet-server.example.com","port":1119,"timeout":5000}'` },
  ],
  Beanstalkd: [
    { title: 'POST /beanstalkd/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/beanstalkd/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"queue.example.com","port":11300,"timeout":5000}'` },
    { title: 'POST /beanstalkd/put', command: `curl -X POST 'https://portofcall.ross.gg/api/beanstalkd/put' \
  -H 'Content-Type: application/json' \
  -d '{"host":"queue.example.com","port":11300,"data":"{\\"task\\":\\"send-email\\",\\"to\\":\\"user@example.com\\"}","priority":1024,"delay":0,"ttr":60,"timeout":5000}'` },
    { title: 'POST /beanstalkd/reserve', command: `curl -X POST 'https://portofcall.ross.gg/api/beanstalkd/reserve' \
  -H 'Content-Type: application/json' \
  -d '{"host":"queue.example.com","port":11300,"reserveTimeout":5,"timeout":10000}'` },
    { title: 'POST /beanstalkd/command', command: `curl -X POST 'https://portofcall.ross.gg/api/beanstalkd/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"queue.example.com","port":11300,"command":"list-tubes","timeout":5000}'` },
  ],
  Beats: [
    { title: 'POST /beats/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/beats/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"logstash.example.com","port":5044,"timeout":5000}'` },
    { title: 'POST /beats/send', command: `curl -X POST 'https://portofcall.ross.gg/api/beats/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"logstash.example.com","port":5044,"events":[{"message":"Application started successfully","level":"info","service":"api-gateway"}],"timeout":8000}'` },
    { title: 'POST /beats/tls', command: `curl -X POST 'https://portofcall.ross.gg/api/beats/tls' \
  -H 'Content-Type: application/json' \
  -d '{"host":"logstash.example.com","port":5044,"timeout":5000}'` },
  ],
  // Untestable — border gateway routing protocol, requires router infrastructure
  BGP: [
    { title: 'POST /bgp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/bgp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"router.example.com","port":179,"timeout":5000,"myAS":65001}'` },
    { title: 'POST /bgp/announce', command: `curl -X POST 'https://portofcall.ross.gg/api/bgp/announce' \
  -H 'Content-Type: application/json' \
  -d '{"host":"router.example.com","port":179,"myAS":65001,"prefix":"192.168.10.0/24","nextHop":"10.0.0.1","timeout":8000}'` },
    { title: 'POST /bgp/route-table', command: `curl -X POST 'https://portofcall.ross.gg/api/bgp/route-table' \
  -H 'Content-Type: application/json' \
  -d '{"host":"router.example.com","port":179,"myAS":65001,"timeout":10000}'` },
  ],
  // Untestable — cryptocurrency protocol, requires full node
  Bitcoin: [
    { title: 'POST /bitcoin/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/bitcoin/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"btc-node.example.com","port":8333,"timeout":5000}'` },
    { title: 'POST /bitcoin/getaddr', command: `curl -X POST 'https://portofcall.ross.gg/api/bitcoin/getaddr' \
  -H 'Content-Type: application/json' \
  -d '{"host":"btc-node.example.com","port":8333,"timeout":8000}'` },
    { title: 'POST /bitcoin/mempool', command: `curl -X POST 'https://portofcall.ross.gg/api/bitcoin/mempool' \
  -H 'Content-Type: application/json' \
  -d '{"host":"btc-node.example.com","port":8333,"timeout":10000}'` },
  ],
  // Untestable — P2P protocol, requires peer network
  BitTorrent: [
    { title: 'POST /bittorrent/handshake', command: `curl -X POST 'https://portofcall.ross.gg/api/bittorrent/handshake' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tracker-peer.example.com","port":6881,"infoHash":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0","timeout":5000}'` },
    { title: 'POST /bittorrent/announce', command: `curl -X POST 'https://portofcall.ross.gg/api/bittorrent/announce' \
  -H 'Content-Type: application/json' \
  -d '{"trackerUrl":"http://tracker.example.com:6969/announce","infoHash":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0","peerId":"-PC0001-123456789012","timeout":10000}'` },
    { title: 'POST /bittorrent/scrape', command: `curl -X POST 'https://portofcall.ross.gg/api/bittorrent/scrape' \
  -H 'Content-Type: application/json' \
  -d '{"trackerUrl":"http://tracker.example.com:6969/scrape","infoHash":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0","timeout":10000}'` },
    { title: 'POST /bittorrent/piece', command: `curl -X POST 'https://portofcall.ross.gg/api/bittorrent/piece' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tracker-peer.example.com","port":6881,"infoHash":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0","index":0,"begin":0,"length":16384,"timeout":10000}'` },
  ],
  Cassandra: [
    { title: 'POST /cassandra/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/cassandra/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra-node1.example.com","port":9042,"timeout":5000}'` },
    { title: 'POST /cassandra/query', command: `curl -X POST 'https://portofcall.ross.gg/api/cassandra/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra-node1.example.com","port":9042,"cql":"SELECT * FROM system.local","username":"cassandra","password":"cassandra","timeout":8000}'` },
    { title: 'POST /cassandra/prepare', command: `curl -X POST 'https://portofcall.ross.gg/api/cassandra/prepare' \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra-node1.example.com","port":9042,"cql":"SELECT * FROM users WHERE user_id = ?","values":["550e8400-e29b-41d4-a716-446655440000"],"username":"cassandra","password":"cassandra","timeout":8000}'` },
  ],
  CDP: [
    { title: 'POST /cdp/health', command: `curl -X POST 'https://portofcall.ross.gg/api/cdp/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"chrome-debug.example.com","port":9222,"timeout":5000}'` },
    { title: 'POST /cdp/query', command: `curl -X POST 'https://portofcall.ross.gg/api/cdp/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"chrome-debug.example.com","port":9222,"path":"/json/version","timeout":5000}'` },
    { title: 'POST /cdp/tunnel', command: `curl -X POST 'https://portofcall.ross.gg/api/cdp/tunnel' \
  -H 'Content-Type: application/json' \
  -d '{"host":"chrome-debug.example.com","port":9222,"timeout":8000}'` },
  ],
  Ceph: [
    { title: 'POST /ceph/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/ceph/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":6789,"timeout":5000}'` },
    { title: 'POST /ceph/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/ceph/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":6789,"timeout":5000}'` },
    { title: 'POST /ceph/cluster-info', command: `curl -X POST 'https://portofcall.ross.gg/api/ceph/cluster-info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":6789,"timeout":8000}'` },
    { title: 'POST /ceph/osd-list', command: `curl -X POST 'https://portofcall.ross.gg/api/ceph/osd-list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":6789,"timeout":8000}'` },
    { title: 'POST /ceph/pool-list', command: `curl -X POST 'https://portofcall.ross.gg/api/ceph/pool-list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":6789,"timeout":8000}'` },
    { title: 'POST /ceph/rest-health', command: `curl -X POST 'https://portofcall.ross.gg/api/ceph/rest-health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":5000,"timeout":5000}'` },
  ],
  Chargen: [
    { title: 'POST /chargen/stream', command: `curl -X POST 'https://portofcall.ross.gg/api/chargen/stream' \
  -H 'Content-Type: application/json' \
  -d '{"host":"chargen.example.com","port":19,"maxBytes":1024,"timeout":10000}'` },
  ],
  CIFS: [
    { title: 'POST /cifs/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/cifs/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"fileserver.example.com","port":445,"timeout":5000}'` },
    { title: 'POST /cifs/negotiate', command: `curl -X POST 'https://portofcall.ross.gg/api/cifs/negotiate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"fileserver.example.com","port":445,"timeout":8000}'` },
    { title: 'POST /cifs/auth', command: `curl -X POST 'https://portofcall.ross.gg/api/cifs/auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"fileserver.example.com","port":445,"username":"jdoe","password":"P@ssw0rd","domain":"CORP","timeout":10000}'` },
    { title: 'POST /cifs/ls', command: `curl -X POST 'https://portofcall.ross.gg/api/cifs/ls' \
  -H 'Content-Type: application/json' \
  -d '{"host":"fileserver.example.com","port":445,"username":"jdoe","password":"P@ssw0rd","share":"shared-docs","path":"reports/2026","timeout":15000}'` },
    { title: 'POST /cifs/read', command: `curl -X POST 'https://portofcall.ross.gg/api/cifs/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"fileserver.example.com","port":445,"username":"jdoe","password":"P@ssw0rd","share":"shared-docs","path":"reports/2026/summary.txt","timeout":15000}'` },
    { title: 'POST /cifs/write', command: `curl -X POST 'https://portofcall.ross.gg/api/cifs/write' \
  -H 'Content-Type: application/json' \
  -d '{"host":"fileserver.example.com","port":445,"username":"jdoe","password":"P@ssw0rd","share":"shared-docs","path":"reports/2026/notes.txt","content":"Meeting notes from Q1 review","timeout":15000}'` },
    { title: 'POST /cifs/stat', command: `curl -X POST 'https://portofcall.ross.gg/api/cifs/stat' \
  -H 'Content-Type: application/json' \
  -d '{"host":"fileserver.example.com","port":445,"username":"jdoe","password":"P@ssw0rd","share":"shared-docs","path":"reports/2026/summary.txt","timeout":15000}'` },
  ],
  ClamAV: [
    { title: 'POST /clamav/ping', command: `curl -X POST 'https://portofcall.ross.gg/api/clamav/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"antivirus.example.com","port":3310,"timeout":5000}'` },
    { title: 'POST /clamav/version', command: `curl -X POST 'https://portofcall.ross.gg/api/clamav/version' \
  -H 'Content-Type: application/json' \
  -d '{"host":"antivirus.example.com","port":3310,"timeout":5000}'` },
    { title: 'POST /clamav/stats', command: `curl -X POST 'https://portofcall.ross.gg/api/clamav/stats' \
  -H 'Content-Type: application/json' \
  -d '{"host":"antivirus.example.com","port":3310,"timeout":5000}'` },
    { title: 'POST /clamav/scan', command: `curl -X POST 'https://portofcall.ross.gg/api/clamav/scan' \
  -H 'Content-Type: application/json' \
  -d '{"host":"antivirus.example.com","port":3310,"path":"/var/uploads/document.pdf","timeout":30000}'` },
  ],
  ClickHouse: [
    { title: 'POST /clickhouse/health', command: `curl -X POST 'https://portofcall.ross.gg/api/clickhouse/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"clickhouse.example.com","port":8123,"timeout":5000}'` },
    { title: 'POST /clickhouse/query', command: `curl -X POST 'https://portofcall.ross.gg/api/clickhouse/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"clickhouse.example.com","port":8123,"query":"SELECT count() FROM system.tables","username":"default","password":"clickpass","database":"analytics","timeout":10000}'` },
    { title: 'POST /clickhouse/native', command: `curl -X POST 'https://portofcall.ross.gg/api/clickhouse/native' \
  -H 'Content-Type: application/json' \
  -d '{"host":"clickhouse.example.com","port":9000,"timeout":5000}'` },
  ],
  Consul: [
    { title: 'POST /consul/health', command: `curl -X POST 'https://portofcall.ross.gg/api/consul/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","port":8500,"token":"s3cr3t-consul-token","timeout":5000}'` },
    { title: 'POST /consul/services', command: `curl -X POST 'https://portofcall.ross.gg/api/consul/services' \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","port":8500,"token":"s3cr3t-consul-token","timeout":5000}'` },
    { title: 'GET /consul/kv/:key', command: `curl 'https://portofcall.ross.gg/api/consul/kv/config/api-gateway/rate-limit?host=consul.example.com&port=8500&token=s3cr3t-consul-token&dc=us-east-1&timeout=5000'` },
    { title: 'POST /consul/kv/:key', command: `curl -X POST 'https://portofcall.ross.gg/api/consul/kv/config/api-gateway/rate-limit' \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","port":8500,"value":"1000","token":"s3cr3t-consul-token","dc":"us-east-1","timeout":5000}'` },
    { title: 'POST /consul/kv-list', command: `curl -X POST 'https://portofcall.ross.gg/api/consul/kv-list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","port":8500,"prefix":"config/","token":"s3cr3t-consul-token","dc":"us-east-1","timeout":5000}'` },
    { title: 'POST /consul/service/health', command: `curl -X POST 'https://portofcall.ross.gg/api/consul/service/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","port":8500,"serviceName":"api-gateway","token":"s3cr3t-consul-token","passing":true,"dc":"us-east-1","timeout":5000}'` },
    { title: 'POST /consul/session/create', command: `curl -X POST 'https://portofcall.ross.gg/api/consul/session/create' \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","port":8500,"token":"s3cr3t-consul-token","name":"leader-election","ttl":"30s","behavior":"delete","timeout":5000}'` },
  ],
  CouchDB: [
    { title: 'POST /couchdb/health', command: `curl -X POST 'https://portofcall.ross.gg/api/couchdb/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"couch.example.com","port":5984,"timeout":5000}'` },
    { title: 'POST /couchdb/query', command: `curl -X POST 'https://portofcall.ross.gg/api/couchdb/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"couch.example.com","port":5984,"path":"/_all_dbs","method":"GET","username":"admin","password":"couchpass","timeout":8000}'` },
  ],
  CVS: [
    { title: 'POST /cvs/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/cvs/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"cvs.example.com","port":2401,"timeout":5000}'` },
    { title: 'POST /cvs/login', command: `curl -X POST 'https://portofcall.ross.gg/api/cvs/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"cvs.example.com","port":2401,"root":"/cvsroot","username":"developer","password":"cvspass","timeout":8000}'` },
    { title: 'POST /cvs/list', command: `curl -X POST 'https://portofcall.ross.gg/api/cvs/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"cvs.example.com","port":2401,"root":"/cvsroot","module":"webapp","timeout":10000}'` },
    { title: 'POST /cvs/checkout', command: `curl -X POST 'https://portofcall.ross.gg/api/cvs/checkout' \
  -H 'Content-Type: application/json' \
  -d '{"host":"cvs.example.com","port":2401,"root":"/cvsroot","module":"webapp","timeout":15000}'` },
  ],
  Daytime: [
    { title: 'POST /daytime/get', command: `curl -X POST 'https://portofcall.ross.gg/api/daytime/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"time-server.example.com","port":13,"timeout":5000}'` },
  ],
  // Untestable — Windows DCE/RPC protocol, requires Windows infrastructure
  DCERPC: [
    { title: 'POST /dcerpc/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/dcerpc/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dc.example.com","port":135,"timeout":5000}'` },
    { title: 'POST /dcerpc/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/dcerpc/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dc.example.com","port":135,"timeout":5000}'` },
    { title: 'POST /dcerpc/epm-enum', command: `curl -X POST 'https://portofcall.ross.gg/api/dcerpc/epm-enum' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dc.example.com","port":135,"timeout":10000}'` },
  ],
  // Untestable — telecom signaling protocol, requires specialized infrastructure
  Diameter: [
    { title: 'POST /diameter/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/diameter/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter-peer.example.com","port":3868,"timeout":5000}'` },
    { title: 'POST /diameter/auth', command: `curl -X POST 'https://portofcall.ross.gg/api/diameter/auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter-peer.example.com","port":3868,"originHost":"client.example.com","originRealm":"example.com","timeout":8000}'` },
    { title: 'POST /diameter/watchdog', command: `curl -X POST 'https://portofcall.ross.gg/api/diameter/watchdog' \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter-peer.example.com","port":3868,"originHost":"client.example.com","originRealm":"example.com","timeout":5000}'` },
    { title: 'POST /diameter/str', command: `curl -X POST 'https://portofcall.ross.gg/api/diameter/str' \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter-peer.example.com","port":3868,"originHost":"client.example.com","originRealm":"example.com","sessionId":"client.example.com;1234;5678","timeout":8000}'` },
    { title: 'POST /diameter/acr', command: `curl -X POST 'https://portofcall.ross.gg/api/diameter/acr' \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter-peer.example.com","port":3868,"originHost":"client.example.com","originRealm":"example.com","sessionId":"client.example.com;1234;5678","timeout":8000}'` },
  ],
  // Untestable — medical imaging protocol, requires specialized software
  DICOM: [
    { title: 'POST /dicom/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/dicom/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pacs.example.com","port":104,"callingAE":"PORTOFCALL","calledAE":"PACS-SCP","timeout":5000}'` },
    { title: 'POST /dicom/echo', command: `curl -X POST 'https://portofcall.ross.gg/api/dicom/echo' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pacs.example.com","port":104,"callingAE":"PORTOFCALL","calledAE":"PACS-SCP","timeout":10000}'` },
    { title: 'POST /dicom/find', command: `curl -X POST 'https://portofcall.ross.gg/api/dicom/find' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pacs.example.com","port":104,"callingAE":"PORTOFCALL","calledAE":"PACS-SCP","level":"STUDY","timeout":15000}'` },
  ],
  DICT: [
    { title: 'POST /dict/define', command: `curl -X POST 'https://portofcall.ross.gg/api/dict/define' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dict.org","port":2628,"word":"serendipity","database":"*","timeout":15000}'` },
    { title: 'POST /dict/match', command: `curl -X POST 'https://portofcall.ross.gg/api/dict/match' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dict.org","port":2628,"word":"proto","database":"*","strategy":"prefix","timeout":15000}'` },
    { title: 'POST /dict/databases', command: `curl -X POST 'https://portofcall.ross.gg/api/dict/databases' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dict.org","port":2628,"timeout":15000}'` },
  ],
  Discard: [
    { title: 'POST /discard/send', command: `curl -X POST 'https://portofcall.ross.gg/api/discard/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"discard.example.com","port":9,"data":"Test payload for discard service","timeout":5000}'` },
  ],
  // Untestable — industrial SCADA protocol, no standard Docker image
  DNP3: [
    { title: 'POST /dnp3/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/dnp3/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"scada.example.com","port":20000,"timeout":5000}'` },
    { title: 'POST /dnp3/read', command: `curl -X POST 'https://portofcall.ross.gg/api/dnp3/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"scada.example.com","port":20000,"source":3,"destination":1,"objectGroup":30,"variation":1,"timeout":8000}'` },
    { title: 'POST /dnp3/select-operate', command: `curl -X POST 'https://portofcall.ross.gg/api/dnp3/select-operate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"scada.example.com","port":20000,"source":3,"destination":1,"objectGroup":12,"variation":1,"index":0,"value":1,"timeout":10000}'` },
  ],
  DNS: [
    { title: 'POST /dns/query', command: `curl -X POST 'https://portofcall.ross.gg/api/dns/query' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"A","server":"8.8.8.8","port":53,"edns":true,"dnssecOK":true}'` },
    { title: 'POST /dns/axfr', command: `curl -X POST 'https://portofcall.ross.gg/api/dns/axfr' \
  -H 'Content-Type: application/json' \
  -d '{"zone":"example.com","server":"ns1.example.com","port":53,"timeout":30000}'` },
  ],
  Docker: [
    { title: 'POST /docker/health', command: `curl -X POST 'https://portofcall.ross.gg/api/docker/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker-host.example.com","port":2375,"timeout":5000}'` },
    { title: 'POST /docker/query', command: `curl -X POST 'https://portofcall.ross.gg/api/docker/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker-host.example.com","port":2375,"path":"/containers/json","method":"GET","timeout":8000}'` },
    { title: 'POST /docker/tls', command: `curl -X POST 'https://portofcall.ross.gg/api/docker/tls' \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker-host.example.com","port":2376,"path":"/info","method":"GET","timeout":8000}'` },
    { title: 'POST /docker/container-create', command: `curl -X POST 'https://portofcall.ross.gg/api/docker/container-create' \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker-host.example.com","port":2375,"image":"nginx:alpine","name":"web-frontend","cmd":["nginx","-g","daemon off;"],"env":["NGINX_PORT=8080"],"timeout":15000}'` },
    { title: 'POST /docker/container-start', command: `curl -X POST 'https://portofcall.ross.gg/api/docker/container-start' \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker-host.example.com","port":2375,"containerId":"a1b2c3d4e5f6","timeout":10000}'` },
    { title: 'POST /docker/container-logs', command: `curl -X POST 'https://portofcall.ross.gg/api/docker/container-logs' \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker-host.example.com","port":2375,"containerId":"a1b2c3d4e5f6","tail":100,"timeout":10000}'` },
    { title: 'POST /docker/exec', command: `curl -X POST 'https://portofcall.ross.gg/api/docker/exec' \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker-host.example.com","port":2375,"containerId":"a1b2c3d4e5f6","cmd":["ls","-la","/var/log"],"timeout":10000}'` },
  ],
  DoT: [
    { title: 'POST /dot/query', command: `curl -X POST 'https://portofcall.ross.gg/api/dot/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"1.1.1.1","port":853,"domain":"example.com","type":"AAAA"}'` },
  ],
  // Untestable — IBM DB2 protocol, no free Docker image
  DRDA: [
    { title: 'POST /drda/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/drda/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"db2.example.com","port":50000,"timeout":5000}'` },
    { title: 'POST /drda/login', command: `curl -X POST 'https://portofcall.ross.gg/api/drda/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"db2.example.com","port":50000,"username":"db2admin","password":"db2pass","database":"SAMPLE","timeout":8000}'` },
    { title: 'POST /drda/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/drda/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"db2.example.com","port":50000,"timeout":5000}'` },
    { title: 'POST /drda/query', command: `curl -X POST 'https://portofcall.ross.gg/api/drda/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"db2.example.com","port":50000,"username":"db2admin","password":"db2pass","database":"SAMPLE","sql":"SELECT * FROM SYSIBM.SYSDUMMY1","timeout":10000}'` },
    { title: 'POST /drda/prepare', command: `curl -X POST 'https://portofcall.ross.gg/api/drda/prepare' \
  -H 'Content-Type: application/json' \
  -d '{"host":"db2.example.com","port":50000,"username":"db2admin","password":"db2pass","database":"SAMPLE","sql":"SELECT * FROM employees WHERE dept_id = ?","timeout":10000}'` },
    { title: 'POST /drda/execute', command: `curl -X POST 'https://portofcall.ross.gg/api/drda/execute' \
  -H 'Content-Type: application/json' \
  -d '{"host":"db2.example.com","port":50000,"username":"db2admin","password":"db2pass","database":"SAMPLE","sql":"UPDATE employees SET salary = salary * 1.05 WHERE dept_id = 10","timeout":10000}'` },
    { title: 'POST /drda/call', command: `curl -X POST 'https://portofcall.ross.gg/api/drda/call' \
  -H 'Content-Type: application/json' \
  -d '{"host":"db2.example.com","port":50000,"username":"db2admin","password":"db2pass","database":"SAMPLE","procedure":"GET_EMPLOYEE_COUNT","timeout":10000}'` },
  ],
  Echo: [
    { title: 'POST /echo/test', command: `curl -X POST 'https://portofcall.ross.gg/api/echo/test' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tcpbin.com","port":7,"message":"Hello, Echo!","timeout":10000}'` },
    { title: 'POST /echo/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/echo/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tcpbin.com","port":7,"timeout":5000}'` },
  ],
  Elasticsearch: [
    { title: 'POST /elasticsearch/health', command: `curl -X POST 'https://portofcall.ross.gg/api/elasticsearch/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9200,"username":"elastic","password":"changeme","timeout":5000}'` },
    { title: 'POST /elasticsearch/query', command: `curl -X POST 'https://portofcall.ross.gg/api/elasticsearch/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9200,"path":"/_cat/indices","method":"GET","username":"elastic","password":"changeme","timeout":5000}'` },
    { title: 'POST /elasticsearch/https', command: `curl -X POST 'https://portofcall.ross.gg/api/elasticsearch/https' \
  -H 'Content-Type: application/json' \
  -d '{"host":"my-cluster.es.cloud.example.com","port":9243,"path":"/_cluster/health","method":"GET","username":"elastic","password":"changeme","timeout":5000}'` },
    { title: 'POST /elasticsearch/index', command: `curl -X POST 'https://portofcall.ross.gg/api/elasticsearch/index' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9200,"index":"my-index","id":"1","doc":{"title":"Test Document","content":"Hello from Port of Call"},"username":"elastic","password":"changeme","https":false,"timeout":5000}'` },
    { title: 'POST /elasticsearch/delete', command: `curl -X POST 'https://portofcall.ross.gg/api/elasticsearch/delete' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9200,"index":"my-index","id":"1","username":"elastic","password":"changeme","https":false,"timeout":5000}'` },
    { title: 'POST /elasticsearch/create', command: `curl -X POST 'https://portofcall.ross.gg/api/elasticsearch/create' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9200,"index":"new-index","username":"elastic","password":"changeme","https":false,"shards":1,"replicas":0,"timeout":5000}'` },
  ],
  Etcd: [
    { title: 'POST /etcd/health', command: `curl -X POST 'https://portofcall.ross.gg/api/etcd/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":2379,"timeout":5000}'` },
    { title: 'POST /etcd/query', command: `curl -X POST 'https://portofcall.ross.gg/api/etcd/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":2379,"path":"/v3/kv/range","method":"POST","timeout":5000}'` },
  ],
  FastCGI: [
    { title: 'POST /fastcgi/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/fastcgi/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9000,"timeout":5000}'` },
    { title: 'POST /fastcgi/request', command: `curl -X POST 'https://portofcall.ross.gg/api/fastcgi/request' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9000,"documentRoot":"/var/www/html","scriptFilename":"/var/www/html/index.php","timeout":5000}'` },
  ],
  Finger: [
    { title: 'POST /finger/query', command: `curl -X POST 'https://portofcall.ross.gg/api/finger/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":79,"username":"root","timeout":5000}'` },
  ],
  // Untestable — industrial PLC protocol (Omron), no standard Docker image
  FINS: [
    { title: 'POST /fins/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/fins/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":9600,"timeout":5000}'` },
    { title: 'POST /fins/memory-read', command: `curl -X POST 'https://portofcall.ross.gg/api/fins/memory-read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":9600,"area":"DM","address":0,"count":10,"timeout":5000}'` },
    { title: 'POST /fins/memory-write', command: `curl -X POST 'https://portofcall.ross.gg/api/fins/memory-write' \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":9600,"area":"DM","address":100,"values":[1,2,3,4,5],"timeout":5000}'` },
  ],
  // Untestable — financial information exchange protocol, requires FIX engine
  FIX: [
    { title: 'POST /fix/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/fix/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9878,"timeout":5000}'` },
    { title: 'POST /fix/heartbeat', command: `curl -X POST 'https://portofcall.ross.gg/api/fix/heartbeat' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9878,"senderCompID":"BANZAI","targetCompID":"EXEC","timeout":5000}'` },
    { title: 'POST /fix/order', command: `curl -X POST 'https://portofcall.ross.gg/api/fix/order' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9878,"senderCompID":"BANZAI","targetCompID":"EXEC","symbol":"AAPL","side":"BUY","quantity":100,"price":150.25,"orderType":"LIMIT","timeout":5000}'` },
  ],
  FTP: [
    { title: 'POST /ftp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass"}'` },
    { title: 'POST /ftp/list', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass","path":"/pub","mlsd":true}'` },
    { title: 'POST /ftp/feat', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/feat' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass"}'` },
    { title: 'POST /ftp/stat', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/stat' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass","remotePath":"/pub/readme.txt"}'` },
    { title: 'POST /ftp/nlst', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/nlst' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass","path":"/pub"}'` },
    { title: 'POST /ftp/site', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/site' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass","command":"CHMOD 755 /pub/script.sh"}'` },
    { title: 'POST /ftp/upload (multipart)', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/upload' \
  -F 'host=ftp.example.com' \
  -F 'port=21' \
  -F 'username=ftpuser' \
  -F 'password=ftppass' \
  -F 'remotePath=/uploads/document.txt' \
  -F 'file=@/path/to/local/document.txt'` },
    { title: 'POST /ftp/download', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/download' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass","remotePath":"/pub/readme.txt"}'` },
    { title: 'POST /ftp/delete', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/delete' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass","remotePath":"/uploads/old-file.txt"}'` },
    { title: 'POST /ftp/mkdir', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/mkdir' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass","dirPath":"/uploads/new-folder"}'` },
    { title: 'POST /ftp/rename', command: `curl -X POST 'https://portofcall.ross.gg/api/ftp/rename' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass","fromPath":"/uploads/old-name.txt","toPath":"/uploads/new-name.txt"}'` },
  ],
  FTPS: [
    { title: 'POST /ftps/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/ftps/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","port":990,"timeout":5000}'` },
    { title: 'POST /ftps/login', command: `curl -X POST 'https://portofcall.ross.gg/api/ftps/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","port":990,"username":"ftpuser","password":"ftppass","timeout":5000}'` },
    { title: 'POST /ftps/list', command: `curl -X POST 'https://portofcall.ross.gg/api/ftps/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","port":990,"username":"ftpuser","password":"ftppass","path":"/documents","timeout":5000}'` },
    { title: 'POST /ftps/upload', command: `curl -X POST 'https://portofcall.ross.gg/api/ftps/upload' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","port":990,"username":"ftpuser","password":"ftppass","remotePath":"/uploads/report.pdf","content":"base64encodedcontent","timeout":10000}'` },
    { title: 'POST /ftps/download', command: `curl -X POST 'https://portofcall.ross.gg/api/ftps/download' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","port":990,"username":"ftpuser","password":"ftppass","remotePath":"/documents/report.pdf","timeout":10000}'` },
    { title: 'POST /ftps/delete', command: `curl -X POST 'https://portofcall.ross.gg/api/ftps/delete' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","port":990,"username":"ftpuser","password":"ftppass","remotePath":"/uploads/old-file.txt","timeout":5000}'` },
    { title: 'POST /ftps/mkdir', command: `curl -X POST 'https://portofcall.ross.gg/api/ftps/mkdir' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","port":990,"username":"ftpuser","password":"ftppass","dirPath":"/uploads/archive","timeout":5000}'` },
    { title: 'POST /ftps/rename', command: `curl -X POST 'https://portofcall.ross.gg/api/ftps/rename' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftps.example.com","port":990,"username":"ftpuser","password":"ftppass","fromPath":"/uploads/draft.txt","toPath":"/uploads/final.txt","timeout":5000}'` },
  ],
  // Untestable — discontinued Polish IM protocol, no standard Docker image
  GaduGadu: [
    { title: 'POST /gadugadu/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/gadugadu/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8074,"timeout":5000}'` },
    { title: 'POST /gadugadu/contacts', command: `curl -X POST 'https://portofcall.ross.gg/api/gadugadu/contacts' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8074,"uin":12345678,"password":"mypassword","timeout":5000}'` },
    { title: 'POST /gadugadu/send-message', command: `curl -X POST 'https://portofcall.ross.gg/api/gadugadu/send-message' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8074,"uin":12345678,"password":"mypassword","recipientUin":87654321,"message":"Hello from Port of Call!","timeout":5000}'` },
  ],
  // Untestable — job queue protocol, limited Docker availability
  Gearman: [
    { title: 'POST /gearman/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/gearman/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4730,"timeout":5000}'` },
    { title: 'POST /gearman/submit', command: `curl -X POST 'https://portofcall.ross.gg/api/gearman/submit' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4730,"functionName":"reverse","data":"Hello World","timeout":5000}'` },
    { title: 'POST /gearman/command', command: `curl -X POST 'https://portofcall.ross.gg/api/gearman/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":4730,"command":"status","timeout":5000}'` },
  ],
  Gemini: [
    { title: 'POST /gemini/fetch', command: `curl -X POST 'https://portofcall.ross.gg/api/gemini/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"geminiprotocol.net","port":1965,"path":"/","timeout":10000}'` },
  ],
  Git: [
    { title: 'POST /git/refs', command: `curl -X POST 'https://portofcall.ross.gg/api/git/refs' \
  -H 'Content-Type: application/json' \
  -d '{"host":"git.kernel.org","port":9418,"repo":"/pub/scm/git/git.git","timeout":10000}'` },
    { title: 'POST /git/fetch', command: `curl -X POST 'https://portofcall.ross.gg/api/git/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"git.kernel.org","port":9418,"repository":"/pub/scm/git/git.git","wantRef":"HEAD","timeout":10000}'` },
  ],
  Gopher: [
    { title: 'POST /gopher/fetch', command: `curl -X POST 'https://portofcall.ross.gg/api/gopher/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"gopher.floodgap.com","port":70,"selector":"","timeout":15000}'` },
  ],
  Graphite: [
    { title: 'POST /graphite/send', command: `curl -X POST 'https://portofcall.ross.gg/api/graphite/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2003,"metrics":[{"name":"servers.web01.cpu.usage","value":42.5,"timestamp":1708300800},{"name":"servers.web01.memory.used","value":8192,"timestamp":1708300800}],"timeout":5000}'` },
    { title: 'GET /graphite/query', command: `curl 'https://portofcall.ross.gg/api/graphite/query?host=your-server.example.com&target=servers.web01.cpu.usage&from=-1h&until=now&format=json&renderPort=8080'` },
    { title: 'GET /graphite/find', command: `curl 'https://portofcall.ross.gg/api/graphite/find?host=your-server.example.com&query=servers.web01.*&renderPort=8080'` },
    { title: 'GET /graphite/info', command: `curl 'https://portofcall.ross.gg/api/graphite/info?host=your-server.example.com&renderPort=8080'` },
  ],
  // Untestable — legacy VoIP signaling protocol, requires specialized infrastructure
  H323: [
    { title: 'POST /h323/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/h323/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1720,"timeout":5000}'` },
    { title: 'POST /h323/info', command: `curl -X POST 'https://portofcall.ross.gg/api/h323/info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1720,"timeout":5000}'` },
    { title: 'POST /h323/capabilities', command: `curl -X POST 'https://portofcall.ross.gg/api/h323/capabilities' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1720,"timeout":5000}'` },
    { title: 'POST /h323/register', command: `curl -X POST 'https://portofcall.ross.gg/api/h323/register' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1720,"alias":"user1000","timeout":5000}'` },
  ],
  // Untestable — healthcare messaging protocol, requires specialized software
  HL7: [
    { title: 'POST /hl7/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/hl7/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2575,"timeout":5000}'` },
    { title: 'POST /hl7/send', command: `curl -X POST 'https://portofcall.ross.gg/api/hl7/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2575,"message":"MSH|^~\\\\&|SendApp|SendFac|RecvApp|RecvFac|20260218120000||ADT^A01|MSG00001|P|2.3","timeout":5000}'` },
    { title: 'POST /hl7/query', command: `curl -X POST 'https://portofcall.ross.gg/api/hl7/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2575,"messageType":"QRY^A19","queryId":"Q0001","timeout":5000}'` },
    { title: 'POST /hl7/adt-a08', command: `curl -X POST 'https://portofcall.ross.gg/api/hl7/adt-a08' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2575,"patientId":"PAT12345","patientName":"DOE^JOHN","timeout":5000}'` },
  ],
  HTTPProxy: [
    { title: 'POST /httpproxy/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/httpproxy/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8080,"timeout":5000}'` },
    { title: 'POST /httpproxy/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/httpproxy/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8080,"targetHost":"example.com","targetPort":443,"timeout":5000}'` },
  ],
  Ident: [
    { title: 'POST /ident/query', command: `curl -X POST 'https://portofcall.ross.gg/api/ident/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":113,"serverPort":22,"clientPort":12345,"timeout":5000}'` },
  ],
  // Untestable — industrial SCADA protocol, no standard Docker image
  IEC104: [
    { title: 'POST /iec104/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/iec104/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2404,"timeout":5000}'` },
    { title: 'POST /iec104/read', command: `curl -X POST 'https://portofcall.ross.gg/api/iec104/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2404,"ioa":100,"timeout":5000}'` },
    { title: 'POST /iec104/write', command: `curl -X POST 'https://portofcall.ross.gg/api/iec104/write' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2404,"ioa":100,"value":1,"timeout":5000}'` },
  ],
  Ignite: [
    { title: 'POST /ignite/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/ignite/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10800,"timeout":5000}'` },
    { title: 'POST /ignite/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/ignite/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10800,"timeout":5000}'` },
    { title: 'POST /ignite/list-caches', command: `curl -X POST 'https://portofcall.ross.gg/api/ignite/list-caches' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10800,"timeout":5000}'` },
    { title: 'POST /ignite/cache-get', command: `curl -X POST 'https://portofcall.ross.gg/api/ignite/cache-get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10800,"cacheName":"myCache","key":"user:1001","timeout":5000}'` },
    { title: 'POST /ignite/cache-put', command: `curl -X POST 'https://portofcall.ross.gg/api/ignite/cache-put' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10800,"cacheName":"myCache","key":"user:1001","value":"John Doe","timeout":5000}'` },
    { title: 'POST /ignite/cache-remove', command: `curl -X POST 'https://portofcall.ross.gg/api/ignite/cache-remove' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10800,"cacheName":"myCache","key":"user:1001","timeout":5000}'` },
  ],
  IMAP: [
    { title: 'POST /imap/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/imap/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","port":143,"username":"user@example.com","password":"mailpass","timeout":5000}'` },
    { title: 'POST /imap/list', command: `curl -X POST 'https://portofcall.ross.gg/api/imap/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","port":143,"username":"user@example.com","password":"mailpass","timeout":5000}'` },
    { title: 'POST /imap/select', command: `curl -X POST 'https://portofcall.ross.gg/api/imap/select' \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","port":143,"username":"user@example.com","password":"mailpass","mailbox":"INBOX","timeout":5000}'` },
  ],
  IMAPS: [
    { title: 'POST /imaps/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/imaps/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","port":993,"username":"user@example.com","password":"mailpass","timeout":5000}'` },
    { title: 'POST /imaps/list', command: `curl -X POST 'https://portofcall.ross.gg/api/imaps/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","port":993,"username":"user@example.com","password":"mailpass","timeout":5000}'` },
    { title: 'POST /imaps/select', command: `curl -X POST 'https://portofcall.ross.gg/api/imaps/select' \
  -H 'Content-Type: application/json' \
  -d '{"host":"imap.example.com","port":993,"username":"user@example.com","password":"mailpass","mailbox":"INBOX","timeout":5000}'` },
  ],
  // Untestable — CUPS printing protocol, requires print server setup
  IPP: [
    { title: 'POST /ipp/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/ipp/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":631,"timeout":5000}'` },
    { title: 'POST /ipp/print', command: `curl -X POST 'https://portofcall.ross.gg/api/ipp/print' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":631,"printerUri":"ipp://your-server.example.com/printers/office-laser","jobName":"test-page","timeout":10000}'` },
  ],
  IRC: [
    { title: 'POST /irc/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/irc/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"irc.libera.chat","port":6667,"nickname":"portofcall_test","timeout":10000}'` },
  ],
  // Untestable — iSCSI storage protocol, requires storage target setup
  ISCSI: [
    { title: 'POST /iscsi/discover', command: `curl -X POST 'https://portofcall.ross.gg/api/iscsi/discover' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3260,"timeout":5000}'` },
    { title: 'POST /iscsi/login', command: `curl -X POST 'https://portofcall.ross.gg/api/iscsi/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3260,"target":"iqn.2026-01.com.example:storage.lun0","timeout":5000}'` },
  ],
  // Untestable — Java debug wire protocol, requires running JVM
  JDWP: [
    { title: 'POST /jdwp/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/jdwp/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8000,"timeout":5000}'` },
    { title: 'POST /jdwp/version', command: `curl -X POST 'https://portofcall.ross.gg/api/jdwp/version' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8000,"timeout":5000}'` },
    { title: 'POST /jdwp/threads', command: `curl -X POST 'https://portofcall.ross.gg/api/jdwp/threads' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8000,"timeout":5000}'` },
  ],
  // Untestable — HP printer protocol, requires HP printer hardware
  JetDirect: [
    { title: 'POST /jetdirect/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/jetdirect/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.50","port":9100,"timeout":5000}'` },
    { title: 'POST /jetdirect/print', command: `curl -X POST 'https://portofcall.ross.gg/api/jetdirect/print' \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.50","port":9100,"data":"@PJL INFO STATUS\\r\\n","timeout":5000}'` },
  ],
  JsonRPC: [
    { title: 'POST /jsonrpc/call', command: `curl -X POST 'https://portofcall.ross.gg/api/jsonrpc/call' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8545,"method":"eth_blockNumber","params":[],"id":1,"timeout":5000}'` },
    { title: 'POST /jsonrpc/batch', command: `curl -X POST 'https://portofcall.ross.gg/api/jsonrpc/batch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8545,"requests":[{"method":"eth_blockNumber","params":[]},{"method":"net_version","params":[]},{"method":"eth_gasPrice","params":[]}],"timeout":5000}'` },
  ],
  Jupyter: [
    { title: 'POST /jupyter/health', command: `curl -X POST 'https://portofcall.ross.gg/api/jupyter/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8888,"token":"my-jupyter-token","timeout":5000}'` },
    { title: 'POST /jupyter/query', command: `curl -X POST 'https://portofcall.ross.gg/api/jupyter/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8888,"path":"/api/status","token":"my-jupyter-token","timeout":5000}'` },
    { title: 'POST /jupyter/kernels', command: `curl -X POST 'https://portofcall.ross.gg/api/jupyter/kernels' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8888,"token":"my-jupyter-token","timeout":5000}'` },
    { title: 'POST /jupyter/notebooks', command: `curl -X POST 'https://portofcall.ross.gg/api/jupyter/notebooks' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8888,"token":"my-jupyter-token","timeout":5000}'` },
    { title: 'POST /jupyter/notebook', command: `curl -X POST 'https://portofcall.ross.gg/api/jupyter/notebook' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8888,"path":"notebooks/analysis.ipynb","token":"my-jupyter-token","timeout":5000}'` },
  ],
  Kafka: [
    { title: 'POST /kafka/versions', command: `curl -X POST 'https://portofcall.ross.gg/api/kafka/versions' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9092,"timeout":5000,"clientId":"portofcall-client"}'` },
    { title: 'POST /kafka/produce', command: `curl -X POST 'https://portofcall.ross.gg/api/kafka/produce' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9092,"topic":"events","key":"order-123","value":"{\\"orderId\\":\\"123\\",\\"status\\":\\"created\\"}","acks":-1,"timeout":5000,"clientId":"portofcall-client"}'` },
    { title: 'POST /kafka/metadata', command: `curl -X POST 'https://portofcall.ross.gg/api/kafka/metadata' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9092,"topics":["events","logs","metrics"],"timeout":5000,"clientId":"portofcall-client"}'` },
    { title: 'POST /kafka/fetch', command: `curl -X POST 'https://portofcall.ross.gg/api/kafka/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9092,"topic":"events","partition":0,"offset":0,"maxWaitMs":1000,"maxBytes":65536,"timeout":5000,"clientId":"portofcall-client"}'` },
    { title: 'POST /kafka/groups', command: `curl -X POST 'https://portofcall.ross.gg/api/kafka/groups' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9092,"timeout":5000,"clientId":"portofcall-client"}'` },
    { title: 'POST /kafka/offsets', command: `curl -X POST 'https://portofcall.ross.gg/api/kafka/offsets' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9092,"topic":"events","partition":0,"timestamp":-1,"timeout":5000,"clientId":"portofcall-client"}'` },
    { title: 'POST /kafka/group-describe', command: `curl -X POST 'https://portofcall.ross.gg/api/kafka/group-describe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9092,"groupIds":["my-consumer-group","analytics-group"],"timeout":5000,"clientId":"portofcall-client"}'` },
  ],
  // Untestable — requires KDC infrastructure setup
  Kerberos: [
    { title: 'POST /kerberos/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/kerberos/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"kdc.example.com","port":88,"realm":"EXAMPLE.COM","timeout":5000}'` },
    { title: 'POST /kerberos/user-enum', command: `curl -X POST 'https://portofcall.ross.gg/api/kerberos/user-enum' \
  -H 'Content-Type: application/json' \
  -d '{"host":"kdc.example.com","port":88,"realm":"EXAMPLE.COM","username":"administrator","timeout":5000}'` },
    { title: 'POST /kerberos/spn-check', command: `curl -X POST 'https://portofcall.ross.gg/api/kerberos/spn-check' \
  -H 'Content-Type: application/json' \
  -d '{"host":"kdc.example.com","port":88,"realm":"EXAMPLE.COM","spn":"HTTP/webserver.example.com","timeout":5000}'` },
  ],
  LDAP: [
    { title: 'POST /ldap/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/ldap/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","port":389,"bindDn":"cn=admin,dc=example,dc=com","password":"adminpass","timeout":5000}'` },
    { title: 'POST /ldap/search', command: `curl -X POST 'https://portofcall.ross.gg/api/ldap/search' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","port":389,"bindDn":"cn=admin,dc=example,dc=com","password":"adminpass","baseDn":"ou=users,dc=example,dc=com","filter":"(objectClass=person)","scope":2,"attributes":["cn","mail","sn"],"sizeLimit":100,"timeout":10000}'` },
    { title: 'POST /ldap/add', command: `curl -X POST 'https://portofcall.ross.gg/api/ldap/add' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","port":389,"bindDn":"cn=admin,dc=example,dc=com","password":"adminpass","entry":{"dn":"cn=John Doe,ou=users,dc=example,dc=com","attributes":{"objectClass":["inetOrgPerson","top"],"cn":"John Doe","sn":"Doe","mail":"jdoe@example.com"}},"timeout":5000}'` },
    { title: 'POST /ldap/modify', command: `curl -X POST 'https://portofcall.ross.gg/api/ldap/modify' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","port":389,"bindDn":"cn=admin,dc=example,dc=com","password":"adminpass","dn":"cn=John Doe,ou=users,dc=example,dc=com","changes":[{"operation":"replace","attribute":"mail","values":["john.doe@example.com"]}],"timeout":5000}'` },
    { title: 'POST /ldap/delete', command: `curl -X POST 'https://portofcall.ross.gg/api/ldap/delete' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","port":389,"bindDn":"cn=admin,dc=example,dc=com","password":"adminpass","dn":"cn=John Doe,ou=users,dc=example,dc=com","timeout":5000}'` },
    { title: 'POST /ldap/paged-search', command: `curl -X POST 'https://portofcall.ross.gg/api/ldap/paged-search' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ldap.example.com","port":389,"bindDn":"cn=admin,dc=example,dc=com","password":"adminpass","baseDn":"ou=users,dc=example,dc=com","filter":"(objectClass=person)","pageSize":50,"cookie":"","timeout":15000}'` },
  ],
  // Untestable — MPLS label distribution protocol, requires network infrastructure
  LDP: [
    { title: 'POST /ldp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/ldp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":646,"timeout":5000}'` },
    { title: 'POST /ldp/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/ldp/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":646,"timeout":5000}'` },
    { title: 'POST /ldp/label-map', command: `curl -X POST 'https://portofcall.ross.gg/api/ldp/label-map' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":646,"fec":"192.168.1.0/24","label":1000,"timeout":5000}'` },
  ],
  LMTP: [
    { title: 'POST /lmtp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/lmtp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":24,"timeout":5000}'` },
    { title: 'POST /lmtp/send', command: `curl -X POST 'https://portofcall.ross.gg/api/lmtp/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":24,"from":"sender@example.com","to":["recipient@example.com"],"subject":"Test Delivery","body":"Hello via LMTP","timeout":10000}'` },
  ],
  LPD: [
    { title: 'POST /lpd/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/lpd/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":515,"timeout":5000}'` },
    { title: 'POST /lpd/print', command: `curl -X POST 'https://portofcall.ross.gg/api/lpd/print' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":515,"queue":"lp0","data":"Hello from Port of Call","title":"test-job","timeout":10000}'` },
    { title: 'POST /lpd/queue', command: `curl -X POST 'https://portofcall.ross.gg/api/lpd/queue' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":515,"queue":"lp0","timeout":5000}'` },
    { title: 'POST /lpd/remove', command: `curl -X POST 'https://portofcall.ross.gg/api/lpd/remove' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":515,"queue":"lp0","jobId":"42","timeout":5000}'` },
  ],
  ManageSieve: [
    { title: 'POST /managesieve/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/managesieve/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mail.example.com","port":4190,"timeout":5000}'` },
    { title: 'POST /managesieve/list', command: `curl -X POST 'https://portofcall.ross.gg/api/managesieve/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mail.example.com","port":4190,"username":"user@example.com","password":"secret","timeout":5000}'` },
    { title: 'POST /managesieve/putscript', command: `curl -X POST 'https://portofcall.ross.gg/api/managesieve/putscript' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mail.example.com","port":4190,"username":"user@example.com","password":"secret","name":"vacation","content":"require \"vacation\"; vacation \"I am away\";","timeout":5000}'` },
    { title: 'POST /managesieve/getscript', command: `curl -X POST 'https://portofcall.ross.gg/api/managesieve/getscript' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mail.example.com","port":4190,"username":"user@example.com","password":"secret","name":"vacation","timeout":5000}'` },
    { title: 'POST /managesieve/deletescript', command: `curl -X POST 'https://portofcall.ross.gg/api/managesieve/deletescript' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mail.example.com","port":4190,"username":"user@example.com","password":"secret","name":"vacation","timeout":5000}'` },
    { title: 'POST /managesieve/setactive', command: `curl -X POST 'https://portofcall.ross.gg/api/managesieve/setactive' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mail.example.com","port":4190,"username":"user@example.com","password":"secret","name":"vacation","timeout":5000}'` },
  ],
  // Untestable — SAP database protocol, no free Docker image
  MaxDB: [
    { title: 'POST /maxdb/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/maxdb/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":7210,"timeout":5000}'` },
    { title: 'POST /maxdb/info', command: `curl -X POST 'https://portofcall.ross.gg/api/maxdb/info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":7210,"timeout":5000}'` },
    { title: 'POST /maxdb/session', command: `curl -X POST 'https://portofcall.ross.gg/api/maxdb/session' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":7210,"username":"DBADMIN","password":"secret","database":"MAXDB1","timeout":5000}'` },
  ],
  Memcached: [
    { title: 'POST /memcached/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/memcached/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11211,"timeout":5000}'` },
    { title: 'POST /memcached/stats', command: `curl -X POST 'https://portofcall.ross.gg/api/memcached/stats' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11211,"timeout":5000}'` },
    { title: 'POST /memcached/command', command: `curl -X POST 'https://portofcall.ross.gg/api/memcached/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11211,"command":"version","timeout":5000}'` },
    { title: 'POST /memcached/gets', command: `curl -X POST 'https://portofcall.ross.gg/api/memcached/gets' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11211,"keys":["session:abc123","user:42"],"timeout":5000}'` },
  ],
  Minecraft: [
    { title: 'POST /minecraft/status', command: `curl -X POST 'https://portofcall.ross.gg/api/minecraft/status' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mc.hypixel.net","port":25565,"timeout":10000}'` },
    { title: 'POST /minecraft/ping', command: `curl -X POST 'https://portofcall.ross.gg/api/minecraft/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mc.hypixel.net","port":25565,"timeout":10000}'` },
  ],
  // Untestable — industrial automation protocol, no standard Docker image
  Modbus: [
    { title: 'POST /modbus/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/modbus/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":502,"unitId":1,"timeout":5000}'` },
    { title: 'POST /modbus/read', command: `curl -X POST 'https://portofcall.ross.gg/api/modbus/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":502,"unitId":1,"functionCode":3,"address":0,"quantity":10,"timeout":5000}'` },
    { title: 'POST /modbus/write/coil', command: `curl -X POST 'https://portofcall.ross.gg/api/modbus/write/coil' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":502,"unitId":1,"address":0,"value":true,"timeout":5000}'` },
    { title: 'POST /modbus/write/registers', command: `curl -X POST 'https://portofcall.ross.gg/api/modbus/write/registers' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":502,"unitId":1,"address":0,"values":[100,200,300],"timeout":5000}'` },
  ],
  MongoDB: [
    { title: 'POST /mongodb/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/mongodb/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":27017,"timeout":5000}'` },
    { title: 'POST /mongodb/ping', command: `curl -X POST 'https://portofcall.ross.gg/api/mongodb/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":27017,"timeout":5000}'` },
    { title: 'POST /mongodb/find', command: `curl -X POST 'https://portofcall.ross.gg/api/mongodb/find' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":27017,"database":"mydb","collection":"users","filter":{"active":true},"projection":{"name":1,"email":1},"limit":10,"skip":0,"timeout":10000}'` },
    { title: 'POST /mongodb/insert', command: `curl -X POST 'https://portofcall.ross.gg/api/mongodb/insert' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":27017,"database":"mydb","collection":"users","documents":[{"name":"Alice","email":"alice@example.com","active":true}],"ordered":true,"timeout":10000}'` },
    { title: 'POST /mongodb/update', command: `curl -X POST 'https://portofcall.ross.gg/api/mongodb/update' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":27017,"database":"mydb","collection":"users","filter":{"name":"Alice"},"update":{"$set":{"active":false}},"multi":false,"upsert":false,"timeout":10000}'` },
    { title: 'POST /mongodb/delete', command: `curl -X POST 'https://portofcall.ross.gg/api/mongodb/delete' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":27017,"database":"mydb","collection":"users","filter":{"active":false},"many":false,"timeout":10000}'` },
  ],
  MPD: [
    { title: 'POST /mpd/status', command: `curl -X POST 'https://portofcall.ross.gg/api/mpd/status' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"timeout":5000}'` },
    { title: 'POST /mpd/play', command: `curl -X POST 'https://portofcall.ross.gg/api/mpd/play' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"timeout":5000}'` },
    { title: 'POST /mpd/pause', command: `curl -X POST 'https://portofcall.ross.gg/api/mpd/pause' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"timeout":5000}'` },
    { title: 'POST /mpd/next', command: `curl -X POST 'https://portofcall.ross.gg/api/mpd/next' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"timeout":5000}'` },
    { title: 'POST /mpd/prev', command: `curl -X POST 'https://portofcall.ross.gg/api/mpd/prev' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"timeout":5000}'` },
    { title: 'POST /mpd/add', command: `curl -X POST 'https://portofcall.ross.gg/api/mpd/add' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"uri":"music/album/track01.flac","timeout":5000}'` },
    { title: 'POST /mpd/seek', command: `curl -X POST 'https://portofcall.ross.gg/api/mpd/seek' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"songPos":0,"time":120,"timeout":5000}'` },
    { title: 'POST /mpd/command', command: `curl -X POST 'https://portofcall.ross.gg/api/mpd/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"command":"currentsong","timeout":5000}'` },
  ],
  MQTT: [
    { title: 'POST /mqtt/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/mqtt/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":1883,"clientId":"portofcall-test","username":"mqttuser","password":"mqttpass","cleanSession":true,"keepAlive":60,"timeout":10000}'` },
    { title: 'POST /mqtt/publish', command: `curl -X POST 'https://portofcall.ross.gg/api/mqtt/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":1883,"clientId":"portofcall-pub","username":"mqttuser","password":"mqttpass","topic":"sensors/temperature","payload":"22.5","qos":1,"retain":false,"timeout":10000}'` },
  ],
  // Untestable — SIP message session relay, requires SIP infrastructure
  MSRP: [
    { title: 'POST /msrp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/msrp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2855,"timeout":5000}'` },
    { title: 'POST /msrp/send', command: `curl -X POST 'https://portofcall.ross.gg/api/msrp/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2855,"toPath":"msrp://relay.example.com:2855/session1;tcp","fromPath":"msrp://client.example.com:2855/session2;tcp","contentType":"text/plain","body":"Hello via MSRP","timeout":5000}'` },
    { title: 'POST /msrp/session', command: `curl -X POST 'https://portofcall.ross.gg/api/msrp/session' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2855,"timeout":5000}'` },
  ],
  MySQL: [
    { title: 'POST /mysql/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/mysql/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3306,"username":"root","password":"secret","database":"mydb","timeout":5000}'` },
    { title: 'POST /mysql/query', command: `curl -X POST 'https://portofcall.ross.gg/api/mysql/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3306,"username":"root","password":"secret","database":"mydb","query":"SELECT * FROM users LIMIT 10","timeout":10000}'` },
    { title: 'POST /mysql/databases', command: `curl -X POST 'https://portofcall.ross.gg/api/mysql/databases' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3306,"username":"root","password":"secret","timeout":5000}'` },
    { title: 'POST /mysql/tables', command: `curl -X POST 'https://portofcall.ross.gg/api/mysql/tables' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3306,"username":"root","password":"secret","database":"mydb","timeout":5000}'` },
  ],
  // Untestable — defunct music service protocol, no standard Docker image
  Napster: [
    { title: 'POST /napster/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/napster/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8875,"timeout":5000}'` },
    { title: 'POST /napster/login', command: `curl -X POST 'https://portofcall.ross.gg/api/napster/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8875,"username":"testuser","password":"testpass","timeout":5000}'` },
    { title: 'POST /napster/browse', command: `curl -X POST 'https://portofcall.ross.gg/api/napster/browse' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8875,"username":"testuser","timeout":5000}'` },
    { title: 'POST /napster/search', command: `curl -X POST 'https://portofcall.ross.gg/api/napster/search' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8875,"query":"beethoven","maxResults":25,"timeout":10000}'` },
    { title: 'POST /napster/stats', command: `curl -X POST 'https://portofcall.ross.gg/api/napster/stats' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8875,"timeout":5000}'` },
  ],
  NATS: [
    { title: 'POST /nats/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/nats/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"user":"natsuser","pass":"natspass","token":"","timeout":10000}'` },
    { title: 'POST /nats/publish', command: `curl -X POST 'https://portofcall.ross.gg/api/nats/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"user":"natsuser","pass":"natspass","token":"","subject":"events.user.signup","payload":"Hello from Port of Call","timeout":10000}'` },
    { title: 'POST /nats/subscribe', command: `curl -X POST 'https://portofcall.ross.gg/api/nats/subscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"user":"natsuser","pass":"natspass","subject":"events.>","max_msgs":5,"timeout_ms":10000,"queue_group":"workers"}'` },
    { title: 'POST /nats/request', command: `curl -X POST 'https://portofcall.ross.gg/api/nats/request' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"user":"natsuser","pass":"natspass","subject":"service.echo","payload":"ping","timeout_ms":5000}'` },
    { title: 'POST /nats/jetstream-info', command: `curl -X POST 'https://portofcall.ross.gg/api/nats/jetstream-info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4222,"user":"natsuser","pass":"natspass","token":"","timeout":10000}'` },
    { title: 'POST /nats/jetstream-stream', command: `curl -X POST 'https://portofcall.ross.gg/api/nats/jetstream-stream' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4222,"user":"natsuser","pass":"natspass","token":"","action":"create","stream":"ORDERS","subjects":["orders.>"],"retentionPolicy":"limits","storageType":"file","timeout":10000}'` },
    { title: 'POST /nats/jetstream-publish', command: `curl -X POST 'https://portofcall.ross.gg/api/nats/jetstream-publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4222,"user":"natsuser","pass":"natspass","token":"","subject":"orders.new","payload":"{\\"orderId\\":\\"12345\\"}","msgId":"order-12345","timeout":10000}'` },
    { title: 'POST /nats/jetstream-pull', command: `curl -X POST 'https://portofcall.ross.gg/api/nats/jetstream-pull' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4222,"user":"natsuser","pass":"natspass","token":"","stream":"ORDERS","consumerName":"order-processor","filterSubject":"orders.new","batch":5,"timeout":10000}'` },
  ],
  // Untestable — network block device protocol, requires block device setup
  NBD: [
    { title: 'POST /nbd/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/nbd/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10809,"timeout":5000}'` },
    { title: 'POST /nbd/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/nbd/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10809,"timeout":5000}'` },
    { title: 'POST /nbd/read', command: `curl -X POST 'https://portofcall.ross.gg/api/nbd/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10809,"exportName":"disk0","offset":0,"length":512,"timeout":10000}'` },
    { title: 'POST /nbd/write', command: `curl -X POST 'https://portofcall.ross.gg/api/nbd/write' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10809,"exportName":"disk0","offset":0,"data":"AQIDBA==","timeout":10000}'` },
  ],
  Neo4j: [
    { title: 'POST /neo4j/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/neo4j/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":7687,"timeout":5000}'` },
    { title: 'POST /neo4j/query', command: `curl -X POST 'https://portofcall.ross.gg/api/neo4j/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":7687,"username":"neo4j","password":"secret","query":"MATCH (n) RETURN n LIMIT 10","database":"neo4j","timeout":10000}'` },
    { title: 'POST /neo4j/query-params', command: `curl -X POST 'https://portofcall.ross.gg/api/neo4j/query-params' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":7687,"username":"neo4j","password":"secret","query":"MATCH (n:Person {name: $name}) RETURN n","params":{"name":"Alice"},"database":"neo4j","timeout":10000}'` },
    { title: 'GET /neo4j/schema', command: `curl 'https://portofcall.ross.gg/api/neo4j/schema?host=localhost&port=7687&username=neo4j&password=secret'` },
    { title: 'POST /neo4j/create', command: `curl -X POST 'https://portofcall.ross.gg/api/neo4j/create' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":7687,"username":"neo4j","password":"secret","label":"Person","properties":{"name":"Alice","age":30},"database":"neo4j","timeout":10000}'` },
  ],
  NetBIOS: [
    { title: 'POST /netbios/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/netbios/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":139,"timeout":5000}'` },
    { title: 'POST /netbios/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/netbios/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":137,"timeout":5000}'` },
    { title: 'POST /netbios/name-query', command: `curl -X POST 'https://portofcall.ross.gg/api/netbios/name-query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":137,"name":"WORKSTATION1","timeout":5000}'` },
  ],
  // Untestable — Plan 9 filesystem protocol, no standard Docker image
  NineP: [
    { title: 'POST /9p/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/9p/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":564,"timeout":5000}'` },
    { title: 'POST /9p/ls', command: `curl -X POST 'https://portofcall.ross.gg/api/9p/ls' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":564,"path":"/","timeout":5000}'` },
    { title: 'POST /9p/read', command: `curl -X POST 'https://portofcall.ross.gg/api/9p/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":564,"path":"/etc/motd","timeout":5000}'` },
    { title: 'POST /9p/stat', command: `curl -X POST 'https://portofcall.ross.gg/api/9p/stat' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":564,"path":"/etc","timeout":5000}'` },
  ],
  NNTP: [
    { title: 'POST /nntp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/nntp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"timeout":10000}'` },
    { title: 'POST /nntp/group', command: `curl -X POST 'https://portofcall.ross.gg/api/nntp/group' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"group":"comp.lang.python","timeout":10000}'` },
    { title: 'POST /nntp/article', command: `curl -X POST 'https://portofcall.ross.gg/api/nntp/article' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"group":"comp.lang.python","articleNumber":1,"timeout":10000}'` },
    { title: 'POST /nntp/list', command: `curl -X POST 'https://portofcall.ross.gg/api/nntp/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"username":"newsuser","password":"newspass","variant":"active","timeout":15000}'` },
    { title: 'POST /nntp/post', command: `curl -X POST 'https://portofcall.ross.gg/api/nntp/post' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"username":"newsuser","password":"newspass","from":"user@example.com","newsgroups":"misc.test","subject":"Test Post","body":"This is a test post from Port of Call.","timeout":10000}'` },
    { title: 'POST /nntp/auth', command: `curl -X POST 'https://portofcall.ross.gg/api/nntp/auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"username":"newsuser","password":"newspass","timeout":10000}'` },
  ],
  Nomad: [
    { title: 'POST /nomad/health', command: `curl -X POST 'https://portofcall.ross.gg/api/nomad/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4646,"timeout":5000}'` },
    { title: 'POST /nomad/jobs', command: `curl -X POST 'https://portofcall.ross.gg/api/nomad/jobs' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4646,"token":"s3cr3t-t0k3n","timeout":5000}'` },
    { title: 'POST /nomad/nodes', command: `curl -X POST 'https://portofcall.ross.gg/api/nomad/nodes' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4646,"token":"s3cr3t-t0k3n","timeout":5000}'` },
    { title: 'POST /nomad/allocations', command: `curl -X POST 'https://portofcall.ross.gg/api/nomad/allocations' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4646,"token":"s3cr3t-t0k3n","timeout":5000}'` },
    { title: 'POST /nomad/deployments', command: `curl -X POST 'https://portofcall.ross.gg/api/nomad/deployments' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4646,"token":"s3cr3t-t0k3n","timeout":5000}'` },
    { title: 'POST /nomad/dispatch', command: `curl -X POST 'https://portofcall.ross.gg/api/nomad/dispatch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4646,"token":"s3cr3t-t0k3n","jobId":"batch-processor","payload":"eyJrZXkiOiJ2YWx1ZSJ9","meta":{"env":"production"},"timeout":10000}'` },
  ],
  NSQ: [
    { title: 'POST /nsq/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/nsq/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4150,"timeout":5000}'` },
    { title: 'POST /nsq/publish', command: `curl -X POST 'https://portofcall.ross.gg/api/nsq/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4150,"topic":"events","message":"Hello from Port of Call","timeout":5000}'` },
    { title: 'POST /nsq/mpub', command: `curl -X POST 'https://portofcall.ross.gg/api/nsq/mpub' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4150,"topic":"events","messages":["message one","message two","message three"],"timeout":5000}'` },
    { title: 'POST /nsq/dpub', command: `curl -X POST 'https://portofcall.ross.gg/api/nsq/dpub' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4150,"topic":"scheduled","message":"delayed message","delay":60000,"timeout":5000}'` },
    { title: 'POST /nsq/subscribe', command: `curl -X POST 'https://portofcall.ross.gg/api/nsq/subscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4150,"topic":"events","channel":"worker-1","maxMessages":10,"timeout":10000}'` },
  ],
  // Untestable — industrial OPC-UA protocol, no standard Docker image
  OPCUA: [
    { title: 'POST /opcua/hello', command: `curl -X POST 'https://portofcall.ross.gg/api/opcua/hello' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4840,"timeout":5000}'` },
    { title: 'POST /opcua/endpoints', command: `curl -X POST 'https://portofcall.ross.gg/api/opcua/endpoints' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4840,"timeout":5000}'` },
    { title: 'POST /opcua/read', command: `curl -X POST 'https://portofcall.ross.gg/api/opcua/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4840,"nodeId":"ns=0;i=2258","timeout":5000}'` },
  ],
  // Untestable — SDN controller protocol, no standard Docker image
  OpenFlow: [
    { title: 'POST /openflow/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/openflow/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6653,"timeout":5000}'` },
    { title: 'POST /openflow/echo', command: `curl -X POST 'https://portofcall.ross.gg/api/openflow/echo' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6653,"timeout":5000}'` },
    { title: 'POST /openflow/stats', command: `curl -X POST 'https://portofcall.ross.gg/api/openflow/stats' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6653,"timeout":5000}'` },
  ],
  OpenVPN: [
    { title: 'POST /openvpn/handshake', command: `curl -X POST 'https://portofcall.ross.gg/api/openvpn/handshake' \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":1194,"timeout":5000}'` },
    { title: 'POST /openvpn/tls', command: `curl -X POST 'https://portofcall.ross.gg/api/openvpn/tls' \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":1194,"timeout":5000}'` },
  ],
  // Untestable — commercial database protocol, no free Docker image
  Oracle: [
    { title: 'POST /oracle/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/oracle/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1521,"timeout":5000}'` },
    { title: 'POST /oracle/services', command: `curl -X POST 'https://portofcall.ross.gg/api/oracle/services' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1521,"timeout":5000}'` },
  ],
  // Untestable — Oracle TNS protocol, no free Docker image
  OracleTNS: [
    { title: 'POST /oracle-tns/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/oracle-tns/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1521,"timeout":5000}'` },
    { title: 'POST /oracle-tns/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/oracle-tns/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1521,"timeout":5000}'` },
    { title: 'POST /oracle-tns/query', command: `curl -X POST 'https://portofcall.ross.gg/api/oracle-tns/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1521,"sid":"ORCL","username":"scott","password":"tiger","timeout":10000}'` },
    { title: 'POST /oracle-tns/sql', command: `curl -X POST 'https://portofcall.ross.gg/api/oracle-tns/sql' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1521,"sid":"ORCL","username":"scott","password":"tiger","sql":"SELECT * FROM emp WHERE rownum <= 10","timeout":10000}'` },
  ],
  // Untestable — path computation protocol, requires network infrastructure
  PCEP: [
    { title: 'POST /pcep/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/pcep/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4189,"timeout":5000}'` },
    { title: 'POST /pcep/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/pcep/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4189,"timeout":5000}'` },
    { title: 'POST /pcep/compute', command: `curl -X POST 'https://portofcall.ross.gg/api/pcep/compute' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4189,"source":"10.0.0.1","destination":"10.0.0.2","timeout":10000}'` },
  ],
  // Untestable — projector control protocol, requires projector hardware
  PJLink: [
    { title: 'POST /pjlink/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/pjlink/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"projector.local","port":4352,"timeout":5000}'` },
    { title: 'POST /pjlink/power', command: `curl -X POST 'https://portofcall.ross.gg/api/pjlink/power' \
  -H 'Content-Type: application/json' \
  -d '{"host":"projector.local","port":4352,"action":"on","password":"JBMIAProjectorLink","timeout":5000}'` },
  ],
  POP3: [
    { title: 'POST /pop3/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/pop3/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","port":110,"username":"user@example.com","password":"secret","timeout":5000}'` },
    { title: 'POST /pop3/list', command: `curl -X POST 'https://portofcall.ross.gg/api/pop3/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","port":110,"username":"user@example.com","password":"secret","timeout":5000}'` },
    { title: 'POST /pop3/retrieve', command: `curl -X POST 'https://portofcall.ross.gg/api/pop3/retrieve' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","port":110,"username":"user@example.com","password":"secret","messageId":1,"timeout":10000}'` },
    { title: 'POST /pop3/dele', command: `curl -X POST 'https://portofcall.ross.gg/api/pop3/dele' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","port":110,"username":"user@example.com","password":"secret","msgnum":1,"timeout":5000}'` },
    { title: 'POST /pop3/uidl', command: `curl -X POST 'https://portofcall.ross.gg/api/pop3/uidl' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","port":110,"username":"user@example.com","password":"secret","timeout":5000}'` },
    { title: 'POST /pop3/top', command: `curl -X POST 'https://portofcall.ross.gg/api/pop3/top' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","port":110,"username":"user@example.com","password":"secret","msgnum":1,"lines":20,"timeout":5000}'` },
    { title: 'POST /pop3/capa', command: `curl -X POST 'https://portofcall.ross.gg/api/pop3/capa' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pop.example.com","port":110,"timeout":5000}'` },
  ],
  Portmapper: [
    { title: 'POST /portmapper/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/portmapper/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":111,"timeout":5000}'` },
    { title: 'POST /portmapper/dump', command: `curl -X POST 'https://portofcall.ross.gg/api/portmapper/dump' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":111,"timeout":5000}'` },
    { title: 'POST /portmapper/getport', command: `curl -X POST 'https://portofcall.ross.gg/api/portmapper/getport' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":111,"program":100003,"version":3,"timeout":5000}'` },
  ],
  PostgreSQL: [
    { title: 'POST /postgresql/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/postgres/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5432,"username":"postgres","password":"secret","database":"mydb","timeout":5000}'` },
    { title: 'POST /postgresql/query', command: `curl -X POST 'https://portofcall.ross.gg/api/postgres/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5432,"username":"postgres","password":"secret","database":"mydb","query":"SELECT * FROM users LIMIT 10","timeout":10000}'` },
    { title: 'POST /postgresql/describe', command: `curl -X POST 'https://portofcall.ross.gg/api/postgres/describe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5432,"username":"postgres","password":"secret","database":"mydb","query":"SELECT * FROM users WHERE id = $1","timeout":5000}'` },
    { title: 'POST /postgresql/listen', command: `curl -X POST 'https://portofcall.ross.gg/api/postgres/listen' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5432,"username":"postgres","password":"secret","database":"mydb","channel":"events","waitMs":5000,"timeout":15000}'` },
    { title: 'POST /postgresql/notify', command: `curl -X POST 'https://portofcall.ross.gg/api/postgres/notify' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5432,"username":"postgres","password":"secret","database":"mydb","channel":"events","payload":"user_signup:42","timeout":5000}'` },
  ],
  // Untestable — legacy VPN protocol, no standard Docker image
  PPTP: [
    { title: 'POST /pptp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/pptp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":1723,"timeout":5000}'` },
    { title: 'POST /pptp/start-control', command: `curl -X POST 'https://portofcall.ross.gg/api/pptp/start-control' \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":1723,"timeout":5000}'` },
    { title: 'POST /pptp/call-setup', command: `curl -X POST 'https://portofcall.ross.gg/api/pptp/call-setup' \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":1723,"timeout":5000}'` },
  ],
  QOTD: [
    { title: 'POST /qotd/fetch', command: `curl -X POST 'https://portofcall.ross.gg/api/qotd/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":17,"timeout":5000}'` },
  ],
  RabbitMQ: [
    { title: 'POST /rabbitmq/health', command: `curl -X POST 'https://portofcall.ross.gg/api/rabbitmq/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":15672,"username":"guest","password":"guest","timeout":5000}'` },
    { title: 'POST /rabbitmq/publish', command: `curl -X POST 'https://portofcall.ross.gg/api/rabbitmq/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":15672,"username":"guest","password":"guest","vhost":"/","exchange":"amq.direct","routingKey":"test.queue","payload":"Hello from Port of Call","timeout":5000}'` },
    { title: 'POST /rabbitmq/query', command: `curl -X POST 'https://portofcall.ross.gg/api/rabbitmq/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":15672,"username":"guest","password":"guest","path":"/api/overview","timeout":5000}'` },
  ],
  // Untestable — RADIUS over TLS, requires RADIUS infrastructure
  Radsec: [
    { title: 'POST /radsec/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/radsec/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"radius.example.com","port":2083,"timeout":5000}'` },
    { title: 'POST /radsec/auth', command: `curl -X POST 'https://portofcall.ross.gg/api/radsec/auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"radius.example.com","port":2083,"username":"testuser","password":"testpass","secret":"radiussecret","timeout":5000}'` },
    { title: 'POST /radsec/accounting', command: `curl -X POST 'https://portofcall.ross.gg/api/radsec/accounting' \
  -H 'Content-Type: application/json' \
  -d '{"host":"radius.example.com","port":2083,"username":"testuser","secret":"radiussecret","sessionId":"sess-001","timeout":5000}'` },
  ],
  // Untestable — game server protocol, requires game server
  RCON: [
    { title: 'POST /rcon/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/rcon/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":25575,"password":"minecraft","timeout":5000}'` },
    { title: 'POST /rcon/command', command: `curl -X POST 'https://portofcall.ross.gg/api/rcon/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":25575,"password":"minecraft","command":"list","timeout":5000}'` },
  ],
  // Untestable — Windows Remote Desktop protocol, requires Windows
  RDP: [
    { title: 'POST /rdp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/rdp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3389,"timeout":5000}'` },
    { title: 'POST /rdp/negotiate', command: `curl -X POST 'https://portofcall.ross.gg/api/rdp/negotiate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3389,"timeout":5000}'` },
    { title: 'POST /rdp/nla-probe', command: `curl -X POST 'https://portofcall.ross.gg/api/rdp/nla-probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3389,"timeout":5000}'` },
  ],
  Redis: [
    { title: 'POST /redis/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/redis/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"timeout":5000}'` },
    { title: 'POST /redis/command (SET)', command: `curl -X POST 'https://portofcall.ross.gg/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["SET","mykey","Hello World"],"timeout":5000}'` },
    { title: 'POST /redis/command (GET)', command: `curl -X POST 'https://portofcall.ross.gg/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["GET","mykey"],"timeout":5000}'` },
    { title: 'POST /redis/command (HSET)', command: `curl -X POST 'https://portofcall.ross.gg/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["HSET","user:1001","name","Alice","email","alice@example.com"],"timeout":5000}'` },
    { title: 'POST /redis/command (HGET)', command: `curl -X POST 'https://portofcall.ross.gg/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["HGET","user:1001","name"],"timeout":5000}'` },
    { title: 'POST /redis/command (LPUSH)', command: `curl -X POST 'https://portofcall.ross.gg/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["LPUSH","tasks","send-email","generate-report"],"timeout":5000}'` },
    { title: 'POST /redis/command (LRANGE)', command: `curl -X POST 'https://portofcall.ross.gg/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["LRANGE","tasks","0","-1"],"timeout":5000}'` },
    { title: 'POST /redis/command (KEYS)', command: `curl -X POST 'https://portofcall.ross.gg/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["KEYS","user:*"],"timeout":5000}'` },
    { title: 'POST /redis/command (INFO)', command: `curl -X POST 'https://portofcall.ross.gg/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["INFO","server"],"timeout":5000}'` },
  ],
  // Untestable — legacy remote execution protocol (RFC 512), no standard Docker image
  Rexec: [
    { title: 'POST /rexec/execute', command: `curl -X POST 'https://portofcall.ross.gg/api/rexec/execute' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":512,"username":"admin","password":"secret","command":"uptime","timeout":5000}'` },
  ],
  RethinkDB: [
    { title: 'POST /rethinkdb/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/rethinkdb/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":28015,"timeout":5000}'` },
    { title: 'POST /rethinkdb/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/rethinkdb/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":28015,"timeout":5000}'` },
    { title: 'POST /rethinkdb/info', command: `curl -X POST 'https://portofcall.ross.gg/api/rethinkdb/info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":28015,"timeout":5000}'` },
    { title: 'POST /rethinkdb/tables', command: `curl -X POST 'https://portofcall.ross.gg/api/rethinkdb/tables' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":28015,"database":"test","timeout":5000}'` },
    { title: 'POST /rethinkdb/table-create', command: `curl -X POST 'https://portofcall.ross.gg/api/rethinkdb/table-create' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":28015,"database":"test","table":"users","timeout":5000}'` },
    { title: 'POST /rethinkdb/query', command: `curl -X POST 'https://portofcall.ross.gg/api/rethinkdb/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":28015,"database":"test","table":"users","filter":{"status":"active"},"timeout":5000}'` },
    { title: 'POST /rethinkdb/insert', command: `curl -X POST 'https://portofcall.ross.gg/api/rethinkdb/insert' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":28015,"database":"test","table":"users","data":{"name":"Alice","email":"alice@example.com","status":"active"},"timeout":5000}'` },
  ],
  // Untestable — legacy remote login protocol (RFC 1282), no standard Docker image
  RLogin: [
    { title: 'POST /rlogin/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/rlogin/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":513,"timeout":5000}'` },
    { title: 'POST /rlogin/banner', command: `curl -X POST 'https://portofcall.ross.gg/api/rlogin/banner' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":513,"localUser":"localadmin","remoteUser":"root","terminal":"xterm/38400","timeout":5000}'` },
  ],
  // Untestable — Java RMI protocol, requires Java RMI registry
  RMI: [
    { title: 'POST /rmi/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/rmi/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":1099,"timeout":5000}'` },
    { title: 'POST /rmi/list', command: `curl -X POST 'https://portofcall.ross.gg/api/rmi/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":1099,"timeout":5000}'` },
    { title: 'POST /rmi/invoke', command: `curl -X POST 'https://portofcall.ross.gg/api/rmi/invoke' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":1099,"objectName":"UserService","methodName":"getVersion","timeout":5000}'` },
  ],
  // Untestable — R statistics server protocol, requires R installation
  Rserve: [
    { title: 'POST /rserve/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/rserve/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6311,"timeout":5000}'` },
    { title: 'POST /rserve/eval', command: `curl -X POST 'https://portofcall.ross.gg/api/rserve/eval' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6311,"expression":"R.version.string","timeout":5000}'` },
  ],
  // Untestable — legacy remote shell protocol, no standard Docker image
  RSH: [
    { title: 'POST /rsh/execute', command: `curl -X POST 'https://portofcall.ross.gg/api/rsh/execute' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":514,"localUser":"localadmin","remoteUser":"root","command":"hostname","timeout":5000}'` },
    { title: 'POST /rsh/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/rsh/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":514,"timeout":5000}'` },
    { title: 'POST /rsh/trust-scan', command: `curl -X POST 'https://portofcall.ross.gg/api/rsh/trust-scan' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":514,"localUser":"admin","timeout":5000}'` },
  ],
  Rsync: [
    { title: 'POST /rsync/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/rsync/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":873,"timeout":5000}'` },
    { title: 'POST /rsync/auth', command: `curl -X POST 'https://portofcall.ross.gg/api/rsync/auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":873,"module":"backups","username":"rsyncuser","password":"rsyncpass","timeout":5000}'` },
    { title: 'POST /rsync/module', command: `curl -X POST 'https://portofcall.ross.gg/api/rsync/module' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":873,"module":"data","timeout":5000}'` },
  ],
  RTMP: [
    { title: 'POST /rtmp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/rtmp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1935,"app":"live","timeout":5000}'` },
    { title: 'POST /rtmp/publish', command: `curl -X POST 'https://portofcall.ross.gg/api/rtmp/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1935,"app":"live","streamKey":"sk_abc123def456","timeout":5000}'` },
    { title: 'POST /rtmp/play', command: `curl -X POST 'https://portofcall.ross.gg/api/rtmp/play' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1935,"app":"live","streamName":"webcam","timeout":5000}'` },
  ],
  RTSP: [
    { title: 'POST /rtsp/options', command: `curl -X POST 'https://portofcall.ross.gg/api/rtsp/options' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":554,"path":"/live/stream1","username":"admin","password":"camera123","timeout":5000}'` },
    { title: 'POST /rtsp/describe', command: `curl -X POST 'https://portofcall.ross.gg/api/rtsp/describe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":554,"path":"/cam/realmonitor","username":"admin","password":"camera123","timeout":5000}'` },
    { title: 'POST /rtsp/session', command: `curl -X POST 'https://portofcall.ross.gg/api/rtsp/session' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":554,"path":"/live/stream1","username":"admin","password":"camera123","timeout_ms":5000}'` },
  ],
  // Untestable — industrial PLC protocol (Siemens), no standard Docker image
  S7comm: [
    { title: 'POST /s7comm/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/s7comm/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","port":102,"timeout":5000}'` },
    { title: 'POST /s7comm/read', command: `curl -X POST 'https://portofcall.ross.gg/api/s7comm/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","port":102,"area":"DB","dbNumber":1,"start":0,"length":10,"timeout":5000}'` },
    { title: 'POST /s7comm/write', command: `curl -X POST 'https://portofcall.ross.gg/api/s7comm/write' \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","port":102,"area":"DB","dbNumber":1,"start":0,"data":"48656C6C6F","timeout":5000}'` },
  ],
  // Untestable — scanner access protocol, requires scanner hardware
  SANE: [
    { title: 'POST /sane/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/sane/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6566,"timeout":5000}'` },
    { title: 'POST /sane/devices', command: `curl -X POST 'https://portofcall.ross.gg/api/sane/devices' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6566,"timeout":5000}'` },
    { title: 'POST /sane/open', command: `curl -X POST 'https://portofcall.ross.gg/api/sane/open' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6566,"deviceName":"epson2:net:192.168.1.50","timeout":5000}'` },
    { title: 'POST /sane/options', command: `curl -X POST 'https://portofcall.ross.gg/api/sane/options' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6566,"deviceName":"epson2:net:192.168.1.50","timeout":5000}'` },
    { title: 'POST /sane/scan', command: `curl -X POST 'https://portofcall.ross.gg/api/sane/scan' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6566,"deviceName":"epson2:net:192.168.1.50","timeout":10000}'` },
  ],
  Sentinel: [
    { title: 'POST /sentinel/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/sentinel/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":26379,"timeout":5000}'` },
    { title: 'POST /sentinel/get', command: `curl -X POST 'https://portofcall.ross.gg/api/sentinel/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":26379,"masterName":"mymaster","timeout":5000}'` },
    { title: 'POST /sentinel/get-master-addr', command: `curl -X POST 'https://portofcall.ross.gg/api/sentinel/get-master-addr' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":26379,"masterName":"mymaster","timeout":5000}'` },
    { title: 'POST /sentinel/query', command: `curl -X POST 'https://portofcall.ross.gg/api/sentinel/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":26379,"command":"PING","timeout":5000}'` },
    { title: 'POST /sentinel/set', command: `curl -X POST 'https://portofcall.ross.gg/api/sentinel/set' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":26379,"masterName":"mymaster","option":"down-after-milliseconds","value":"30000","timeout":5000}'` },
    { title: 'POST /sentinel/reset', command: `curl -X POST 'https://portofcall.ross.gg/api/sentinel/reset' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":26379,"pattern":"mymaster*","timeout":5000}'` },
    { title: 'POST /sentinel/failover', command: `curl -X POST 'https://portofcall.ross.gg/api/sentinel/failover' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":26379,"masterName":"mymaster","timeout":10000}'` },
  ],
  SFTP: [
    { title: 'POST /sftp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/sftp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser"}'` },
    { title: 'POST /sftp/list', command: `curl -X POST 'https://portofcall.ross.gg/api/sftp/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","path":"/home/sftpuser","timeout":10000}'` },
    { title: 'POST /sftp/download', command: `curl -X POST 'https://portofcall.ross.gg/api/sftp/download' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","path":"/home/sftpuser/report.csv","timeout":10000}'` },
    { title: 'POST /sftp/upload', command: `curl -X POST 'https://portofcall.ross.gg/api/sftp/upload' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","path":"/home/sftpuser/hello.txt","content":"Hello from Port of Call!","encoding":"utf8","timeout":10000}'` },
    { title: 'POST /sftp/delete', command: `curl -X POST 'https://portofcall.ross.gg/api/sftp/delete' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","path":"/home/sftpuser/old-file.txt","timeout":10000}'` },
    { title: 'POST /sftp/mkdir', command: `curl -X POST 'https://portofcall.ross.gg/api/sftp/mkdir' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","path":"/home/sftpuser/new-directory","timeout":10000}'` },
    { title: 'POST /sftp/rename', command: `curl -X POST 'https://portofcall.ross.gg/api/sftp/rename' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","oldPath":"/home/sftpuser/draft.txt","newPath":"/home/sftpuser/final.txt","timeout":10000}'` },
    { title: 'POST /sftp/stat', command: `curl -X POST 'https://portofcall.ross.gg/api/sftp/stat' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","path":"/home/sftpuser/report.csv","timeout":10000}'` },
  ],
  SIP: [
    { title: 'POST /sip/options', command: `curl -X POST 'https://portofcall.ross.gg/api/sip/options' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5060,"timeout":5000}'` },
    { title: 'POST /sip/register', command: `curl -X POST 'https://portofcall.ross.gg/api/sip/register' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5060,"username":"1001","domain":"sip.example.com","timeout":5000}'` },
    { title: 'POST /sip/invite', command: `curl -X POST 'https://portofcall.ross.gg/api/sip/invite' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5060,"from":"sip:1001@sip.example.com","to":"sip:1002@sip.example.com","timeout":5000}'` },
    { title: 'POST /sip/digest-auth', command: `curl -X POST 'https://portofcall.ross.gg/api/sip/digest-auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5060,"username":"1001","password":"sippass","realm":"sip.example.com","timeout":5000}'` },
  ],
  SIPS: [
    { title: 'POST /sips/options', command: `curl -X POST 'https://portofcall.ross.gg/api/sips/options' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5061,"timeout":5000}'` },
    { title: 'POST /sips/register', command: `curl -X POST 'https://portofcall.ross.gg/api/sips/register' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5061,"username":"1001","domain":"sip.example.com","timeout":5000}'` },
    { title: 'POST /sips/invite', command: `curl -X POST 'https://portofcall.ross.gg/api/sips/invite' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5061,"from":"sips:1001@sip.example.com","to":"sips:1002@sip.example.com","timeout":5000}'` },
    { title: 'POST /sips/digest-auth', command: `curl -X POST 'https://portofcall.ross.gg/api/sips/digest-auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5061,"username":"1001","password":"sippass","realm":"sip.example.com","timeout":5000}'` },
  ],
  // Untestable — service location protocol, no standard Docker image
  SLP: [
    { title: 'POST /slp/find', command: `curl -X POST 'https://portofcall.ross.gg/api/slp/find' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":427,"serviceType":"service:printer","timeout":5000}'` },
    { title: 'POST /slp/types', command: `curl -X POST 'https://portofcall.ross.gg/api/slp/types' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":427,"timeout":5000}'` },
    { title: 'POST /slp/attributes', command: `curl -X POST 'https://portofcall.ross.gg/api/slp/attributes' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":427,"url":"service:printer://printer1.example.com","timeout":5000}'` },
  ],
  SMB: [
    { title: 'POST /smb/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/smb/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":445,"timeout":5000}'` },
    { title: 'POST /smb/negotiate', command: `curl -X POST 'https://portofcall.ross.gg/api/smb/negotiate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":445,"timeout":5000}'` },
    { title: 'POST /smb/session', command: `curl -X POST 'https://portofcall.ross.gg/api/smb/session' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":445,"username":"admin","password":"P@ssw0rd","domain":"WORKGROUP","timeout":5000}'` },
    { title: 'POST /smb/tree', command: `curl -X POST 'https://portofcall.ross.gg/api/smb/tree' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":445,"username":"admin","password":"P@ssw0rd","share":"shared","timeout":5000}'` },
    { title: 'POST /smb/stat', command: `curl -X POST 'https://portofcall.ross.gg/api/smb/stat' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":445,"username":"admin","password":"P@ssw0rd","share":"shared","path":"documents/report.pdf","timeout":5000}'` },
  ],
  SMPP: [
    { title: 'POST /smpp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/smpp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2775,"timeout":5000}'` },
    { title: 'POST /smpp/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/smpp/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2775,"timeout":5000}'` },
    { title: 'POST /smpp/submit', command: `curl -X POST 'https://portofcall.ross.gg/api/smpp/submit' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2775,"systemId":"smppclient","password":"secret","sourceAddr":"12345","destAddr":"15551234567","shortMessage":"Hello from Port of Call","timeout":5000}'` },
    { title: 'POST /smpp/query', command: `curl -X POST 'https://portofcall.ross.gg/api/smpp/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2775,"systemId":"smppclient","password":"secret","messageId":"msg-001","timeout":5000}'` },
  ],
  SMTP: [
    { title: 'POST /smtp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/smtp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"smtp.example.com","port":25,"username":"mailuser","password":"mailpass","useTLS":false,"timeout":5000}'` },
    { title: 'POST /smtp/send', command: `curl -X POST 'https://portofcall.ross.gg/api/smtp/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"smtp.example.com","port":25,"username":"mailuser","password":"mailpass","from":"sender@example.com","to":"recipient@example.com","subject":"Test Message","body":"Hello from Port of Call!","timeout":10000}'` },
  ],
  SMTPS: [
    { title: 'POST /smtps/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/smtps/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"smtp.example.com","port":465,"username":"mailuser","password":"mailpass","useTLS":true,"timeout":5000}'` },
    { title: 'POST /smtps/send', command: `curl -X POST 'https://portofcall.ross.gg/api/smtps/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"smtp.example.com","port":465,"username":"mailuser","password":"mailpass","from":"sender@example.com","to":"recipient@example.com","subject":"Secure Test Message","body":"Hello securely from Port of Call!","timeout":10000}'` },
  ],
  // Untestable — legacy pager protocol, no standard Docker image
  SNPP: [
    { title: 'POST /snpp/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/snpp/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":444,"timeout":5000}'` },
    { title: 'POST /snpp/page', command: `curl -X POST 'https://portofcall.ross.gg/api/snpp/page' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":444,"pagerId":"5551234567","message":"Server disk usage critical","timeout":5000}'` },
  ],
  SOCKS4: [
    { title: 'POST /socks4/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/socks4/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1080,"targetHost":"example.com","targetPort":80,"timeout":5000}'` },
    { title: 'POST /socks4/relay', command: `curl -X POST 'https://portofcall.ross.gg/api/socks4/relay' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1080,"targetHost":"example.com","targetPort":80,"data":"GET / HTTP/1.1\\r\\nHost: example.com\\r\\n\\r\\n","timeout":5000}'` },
  ],
  SOCKS5: [
    { title: 'POST /socks5/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/socks5/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1080,"targetHost":"example.com","targetPort":443,"username":"proxyuser","password":"proxypass","timeout":5000}'` },
    { title: 'POST /socks5/relay', command: `curl -X POST 'https://portofcall.ross.gg/api/socks5/relay' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1080,"targetHost":"example.com","targetPort":80,"username":"proxyuser","password":"proxypass","data":"GET / HTTP/1.1\\r\\nHost: example.com\\r\\n\\r\\n","timeout":5000}'` },
  ],
  Solr: [
    { title: 'POST /solr/health', command: `curl -X POST 'https://portofcall.ross.gg/api/solr/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8983,"timeout":5000}'` },
    { title: 'POST /solr/query', command: `curl -X POST 'https://portofcall.ross.gg/api/solr/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8983,"collection":"products","query":"name:widget","rows":10,"timeout":5000}'` },
    { title: 'POST /solr/index', command: `curl -X POST 'https://portofcall.ross.gg/api/solr/index' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8983,"collection":"products","docs":[{"id":"prod-001","name":"Blue Widget","price":9.99}],"timeout":5000}'` },
    { title: 'POST /solr/delete', command: `curl -X POST 'https://portofcall.ross.gg/api/solr/delete' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8983,"collection":"products","id":"prod-001","timeout":5000}'` },
  ],
  Sonic: [
    { title: 'POST /sonic/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/sonic/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":1491,"timeout":5000}'` },
    { title: 'POST /sonic/ping', command: `curl -X POST 'https://portofcall.ross.gg/api/sonic/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":1491,"password":"SecretPassword","timeout":5000}'` },
    { title: 'POST /sonic/push', command: `curl -X POST 'https://portofcall.ross.gg/api/sonic/push' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":1491,"password":"SecretPassword","collection":"articles","bucket":"default","object":"article:1","text":"The quick brown fox jumps over the lazy dog","timeout":5000}'` },
    { title: 'POST /sonic/query', command: `curl -X POST 'https://portofcall.ross.gg/api/sonic/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":1491,"password":"SecretPassword","collection":"articles","bucket":"default","terms":"brown fox","timeout":5000}'` },
    { title: 'POST /sonic/suggest', command: `curl -X POST 'https://portofcall.ross.gg/api/sonic/suggest' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":1491,"password":"SecretPassword","collection":"articles","bucket":"default","word":"bro","timeout":5000}'` },
  ],
  SourceRCON: [
    { title: 'POST /source-rcon/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/rcon/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":27015,"password":"sourcepass","timeout":5000}'` },
    { title: 'POST /source-rcon/command', command: `curl -X POST 'https://portofcall.ross.gg/api/rcon/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":27015,"password":"sourcepass","command":"status","timeout":5000}'` },
  ],
  Spamd: [
    { title: 'POST /spamd/ping', command: `curl -X POST 'https://portofcall.ross.gg/api/spamd/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":783,"timeout":5000}'` },
  ],
  // Untestable — VM display protocol, requires QEMU/KVM infrastructure
  SPICE: [
    { title: 'POST /spice/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/spice/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5900,"password":"spicepass","timeout":5000}'` },
    { title: 'POST /spice/channels', command: `curl -X POST 'https://portofcall.ross.gg/api/spice/channels' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5900,"timeout":5000}'` },
  ],
  SSH: [
    { title: 'POST /ssh/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/ssh/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"admin","password":"secret","timeout":10000}'` },
    { title: 'POST /ssh/disconnect', command: `curl -X POST 'https://portofcall.ross.gg/api/ssh/disconnect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22}'` },
    { title: 'POST /ssh/kexinit', command: `curl -X POST 'https://portofcall.ross.gg/api/ssh/kexinit' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"timeout":5000}'` },
    { title: 'POST /ssh/auth', command: `curl -X POST 'https://portofcall.ross.gg/api/ssh/auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"timeout":5000}'` },
  ],
  STOMP: [
    { title: 'POST /stomp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/stomp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":61613,"username":"guest","password":"guest","vhost":"/","timeout":5000}'` },
    { title: 'POST /stomp/send', command: `curl -X POST 'https://portofcall.ross.gg/api/stomp/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":61613,"username":"guest","password":"guest","destination":"/queue/orders","body":"{\\"orderId\\":\\"ORD-12345\\",\\"status\\":\\"placed\\"}","contentType":"application/json","timeout":5000}'` },
    { title: 'POST /stomp/subscribe', command: `curl -X POST 'https://portofcall.ross.gg/api/stomp/subscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":61613,"username":"guest","password":"guest","destination":"/queue/orders","maxMessages":5,"timeout":10000}'` },
  ],
  SVN: [
    { title: 'POST /svn/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/svn/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"svn.example.com","port":3690,"timeout":5000}'` },
    { title: 'POST /svn/info', command: `curl -X POST 'https://portofcall.ross.gg/api/svn/info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"svn.example.com","port":3690,"repository":"myproject","timeout":5000}'` },
    { title: 'POST /svn/list', command: `curl -X POST 'https://portofcall.ross.gg/api/svn/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"svn.example.com","port":3690,"repository":"myproject","path":"/trunk","timeout":5000}'` },
  ],
  Syslog: [
    { title: 'POST /syslog/send', command: `curl -X POST 'https://portofcall.ross.gg/api/syslog/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":514,"message":"Application started successfully","facility":16,"severity":6,"timeout":5000}'` },
  ],
  TACACS: [
    { title: 'POST /tacacs/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/tacacs/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":49,"timeout":5000}'` },
    { title: 'POST /tacacs/authenticate', command: `curl -X POST 'https://portofcall.ross.gg/api/tacacs/authenticate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":49,"username":"netadmin","password":"tacpass","secret":"tacacskey","timeout":5000}'` },
  ],
  Tarantool: [
    { title: 'POST /tarantool/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/tarantool/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":3301,"timeout":5000}'` },
    { title: 'POST /tarantool/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/tarantool/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":3301,"timeout":5000}'` },
    { title: 'POST /tarantool/eval', command: `curl -X POST 'https://portofcall.ross.gg/api/tarantool/eval' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":3301,"username":"admin","password":"secret","expression":"return box.info.version","timeout":5000}'` },
    { title: 'POST /tarantool/sql', command: `curl -X POST 'https://portofcall.ross.gg/api/tarantool/sql' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":3301,"username":"admin","password":"secret","query":"SELECT * FROM users LIMIT 10","timeout":5000}'` },
  ],
  TDS: [
    { title: 'POST /tds/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/tds/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1433,"timeout":5000}'` },
    { title: 'POST /tds/login', command: `curl -X POST 'https://portofcall.ross.gg/api/tds/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1433,"username":"sa","password":"YourStrong!Passw0rd","database":"master","timeout":5000}'` },
    { title: 'POST /tds/query', command: `curl -X POST 'https://portofcall.ross.gg/api/tds/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1433,"username":"sa","password":"YourStrong!Passw0rd","database":"master","sql":"SELECT @@VERSION","timeout":5000}'` },
  ],
  TeamSpeak: [
    { title: 'POST /teamspeak/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/teamspeak/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10011,"timeout":5000}'` },
    { title: 'POST /teamspeak/command', command: `curl -X POST 'https://portofcall.ross.gg/api/teamspeak/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10011,"username":"serveradmin","password":"tspass","command":"serverinfo","timeout":5000}'` },
    { title: 'POST /teamspeak/channel', command: `curl -X POST 'https://portofcall.ross.gg/api/teamspeak/channel' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10011,"username":"serveradmin","password":"tspass","channelName":"General Chat","timeout":5000}'` },
    { title: 'POST /teamspeak/message', command: `curl -X POST 'https://portofcall.ross.gg/api/teamspeak/message' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10011,"username":"serveradmin","password":"tspass","targetId":1,"message":"Server restarting in 5 minutes","timeout":5000}'` },
    { title: 'POST /teamspeak/kick', command: `curl -X POST 'https://portofcall.ross.gg/api/teamspeak/kick' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10011,"username":"serveradmin","password":"tspass","clientId":42,"reason":"AFK timeout","timeout":5000}'` },
    { title: 'POST /teamspeak/ban', command: `curl -X POST 'https://portofcall.ross.gg/api/teamspeak/ban' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10011,"username":"serveradmin","password":"tspass","clientId":42,"duration":3600,"reason":"Repeated violations","timeout":5000}'` },
  ],
  Telnet: [
    { title: 'POST /telnet/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/telnet/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":23,"timeout":5000}'` },
    { title: 'POST /telnet/negotiate', command: `curl -X POST 'https://portofcall.ross.gg/api/telnet/negotiate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":23,"timeout":5000}'` },
    { title: 'POST /telnet/login', command: `curl -X POST 'https://portofcall.ross.gg/api/telnet/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":23,"username":"admin","password":"secret","timeout":10000}'` },
  ],
  TFTP: [
    { title: 'POST /tftp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/tftp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":69,"timeout":5000}'` },
    { title: 'POST /tftp/get', command: `curl -X POST 'https://portofcall.ross.gg/api/tftp/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":69,"filename":"config.txt","timeout":10000}'` },
    { title: 'POST /tftp/read', command: `curl -X POST 'https://portofcall.ross.gg/api/tftp/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":69,"filename":"firmware.bin","timeout":15000}'` },
    { title: 'POST /tftp/write', command: `curl -X POST 'https://portofcall.ross.gg/api/tftp/write' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":69,"filename":"upload.txt","data":"Hello from Port of Call","timeout":10000}'` },
    { title: 'POST /tftp/options', command: `curl -X POST 'https://portofcall.ross.gg/api/tftp/options' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":69,"timeout":5000}'` },
  ],
  Thrift: [
    { title: 'POST /thrift/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/thrift/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9090,"timeout":5000}'` },
    { title: 'POST /thrift/call', command: `curl -X POST 'https://portofcall.ross.gg/api/thrift/call' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9090,"serviceName":"UserService","methodName":"getUser","args":{"userId":"42"},"timeout":5000}'` },
  ],
  Time: [
    { title: 'POST /time/get', command: `curl -X POST 'https://portofcall.ross.gg/api/time/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"time.nist.gov","port":37,"timeout":10000}'` },
  ],
  Varnish: [
    { title: 'POST /varnish/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/varnish/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6082,"timeout":5000}'` },
    { title: 'POST /varnish/command', command: `curl -X POST 'https://portofcall.ross.gg/api/varnish/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6082,"secret":"varnishsecret","command":"status","timeout":5000}'` },
    { title: 'POST /varnish/ban', command: `curl -X POST 'https://portofcall.ross.gg/api/varnish/ban' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6082,"secret":"varnishsecret","expression":"req.url ~ /api/","timeout":5000}'` },
    { title: 'POST /varnish/param', command: `curl -X POST 'https://portofcall.ross.gg/api/varnish/param' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6082,"secret":"varnishsecret","param":"default_ttl","timeout":5000}'` },
  ],
  Vault: [
    { title: 'POST /vault/health', command: `curl -X POST 'https://portofcall.ross.gg/api/vault/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8200,"token":"hvs.EXAMPLE_TOKEN","timeout":5000}'` },
    { title: 'POST /vault/query', command: `curl -X POST 'https://portofcall.ross.gg/api/vault/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8200,"path":"/v1/sys/health","token":"hvs.EXAMPLE_TOKEN","timeout":5000}'` },
    { title: 'POST /vault/secret/read', command: `curl -X POST 'https://portofcall.ross.gg/api/vault/secret/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8200,"path":"my-app/config","token":"hvs.EXAMPLE_TOKEN","kv_version":2,"mount":"secret","timeout":5000}'` },
    { title: 'POST /vault/secret/write', command: `curl -X POST 'https://portofcall.ross.gg/api/vault/secret/write' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":8200,"path":"my-app/config","token":"hvs.EXAMPLE_TOKEN","data":{"db_host":"10.0.1.50","db_pass":"supersecret"},"kv_version":2,"mount":"secret","timeout":5000}'` },
  ],
  // Untestable — proprietary gaming voice protocol, no standard Docker image
  Ventrilo: [
    { title: 'POST /ventrilo/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/ventrilo/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3784,"timeout":5000}'` },
    { title: 'POST /ventrilo/status', command: `curl -X POST 'https://portofcall.ross.gg/api/ventrilo/status' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3784,"timeout":5000}'` },
  ],
  VNC: [
    { title: 'POST /vnc/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/vnc/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5900,"timeout":5000}'` },
    { title: 'POST /vnc/auth', command: `curl -X POST 'https://portofcall.ross.gg/api/vnc/auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5900,"password":"vncpass","timeout":5000}'` },
  ],
  WebSocket: [
    { title: 'POST /websocket/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/websocket/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":80,"path":"/ws","timeout":5000}'` },
  ],
  Whois: [
    { title: 'POST /whois/lookup', command: `curl -X POST 'https://portofcall.ross.gg/api/whois/lookup' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","server":"whois.verisign-grs.com","port":43,"followReferral":true,"timeout":10000}'` },
    { title: 'POST /whois/ip', command: `curl -X POST 'https://portofcall.ross.gg/api/whois/ip' \
  -H 'Content-Type: application/json' \
  -d '{"query":"8.8.8.8","server":"whois.arin.net","followReferral":true,"timeout":10000}'` },
  ],
  // Untestable — X Window display protocol, requires X server
  X11: [
    { title: 'POST /x11/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/x11/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6000,"timeout":5000}'` },
    { title: 'POST /x11/query-tree', command: `curl -X POST 'https://portofcall.ross.gg/api/x11/query-tree' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6000,"windowId":1,"timeout":5000}'` },
  ],
  XMPP: [
    { title: 'POST /xmpp/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/xmpp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5222,"timeout":5000}'` },
    { title: 'POST /xmpp/login', command: `curl -X POST 'https://portofcall.ross.gg/api/xmpp/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5222,"username":"alice","password":"xmpppass","timeout":5000}'` },
    { title: 'POST /xmpp/message', command: `curl -X POST 'https://portofcall.ross.gg/api/xmpp/message' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5222,"username":"alice","password":"xmpppass","to":"bob@example.com","body":"Hello Bob!","timeout":5000}'` },
    { title: 'POST /xmpp/roster', command: `curl -X POST 'https://portofcall.ross.gg/api/xmpp/roster' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5222,"username":"alice","password":"xmpppass","timeout":5000}'` },
  ],
  XmppS2S: [
    { title: 'POST /xmpp-s2s/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/xmpp-s2s/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5269,"timeout":5000}'` },
    { title: 'POST /xmpp-s2s/dialback', command: `curl -X POST 'https://portofcall.ross.gg/api/xmpp-s2s/dialback' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5269,"fromDomain":"example.com","toDomain":"remote.example.org","timeout":5000}'` },
    { title: 'POST /xmpp-s2s/ping', command: `curl -X POST 'https://portofcall.ross.gg/api/xmpp-s2s/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5269,"fromDomain":"example.com","toDomain":"remote.example.org","timeout":5000}'` },
    { title: 'POST /xmpp-s2s/s2s-connect', command: `curl -X POST 'https://portofcall.ross.gg/api/xmpp-s2s/s2s-connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5269,"fromDomain":"example.com","toDomain":"remote.example.org","timeout":5000}'` },
  ],
  Zabbix: [
    { title: 'POST /zabbix/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/zabbix/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":10051,"timeout":5000}'` },
    { title: 'POST /zabbix/agent', command: `curl -X POST 'https://portofcall.ross.gg/api/zabbix/agent' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":10050,"key":"agent.ping","timeout":5000}'` },
    { title: 'POST /zabbix/discovery', command: `curl -X POST 'https://portofcall.ross.gg/api/zabbix/discovery' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":10050,"timeout":5000}'` },
  ],
  ZMTP: [
    { title: 'POST /zmtp/probe', command: `curl -X POST 'https://portofcall.ross.gg/api/zmtp/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":5555,"timeout":5000}'` },
    { title: 'POST /zmtp/handshake', command: `curl -X POST 'https://portofcall.ross.gg/api/zmtp/handshake' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":5555,"socketType":"DEALER","timeout":5000}'` },
    { title: 'POST /zmtp/send', command: `curl -X POST 'https://portofcall.ross.gg/api/zmtp/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":5555,"socketType":"PUSH","message":"Hello from Port of Call","timeout":5000}'` },
    { title: 'POST /zmtp/recv', command: `curl -X POST 'https://portofcall.ross.gg/api/zmtp/recv' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":5555,"socketType":"PULL","timeout":5000}'` },
  ],
  ZooKeeper: [
    { title: 'POST /zookeeper/connect', command: `curl -X POST 'https://portofcall.ross.gg/api/zookeeper/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":2181,"timeout":5000}'` },
    { title: 'POST /zookeeper/command', command: `curl -X POST 'https://portofcall.ross.gg/api/zookeeper/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":2181,"command":"ruok","timeout":5000}'` },
    { title: 'POST /zookeeper/get', command: `curl -X POST 'https://portofcall.ross.gg/api/zookeeper/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":2181,"path":"/myapp/config","watch":false,"timeout":5000}'` },
    { title: 'POST /zookeeper/set', command: `curl -X POST 'https://portofcall.ross.gg/api/zookeeper/set' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":2181,"path":"/myapp/config","data":"{\\"maxConnections\\":100}","version":-1,"timeout":5000}'` },
    { title: 'POST /zookeeper/create', command: `curl -X POST 'https://portofcall.ross.gg/api/zookeeper/create' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":2181,"path":"/myapp/nodes/worker-1","data":"{\\"status\\":\\"active\\"}","flags":"ephemeral","timeout":5000}'` },
  ],
};

export default examples;
