import { config } from 'dotenv';
config({ path: '.env.e2e' });

const HOST = process.env.VPS_HOST!;

export const services = {
  redis:      { host: HOST, port: process.env.REDIS_PORT! },
  postgresql: { host: HOST, port: process.env.POSTGRES_PORT!, username: process.env.TEST_USERNAME!, password: process.env.POSTGRES_PASSWORD!, database: process.env.POSTGRES_DATABASE! },
  mysql:      { host: HOST, port: process.env.MYSQL_PORT!, username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD!, database: process.env.MYSQL_DATABASE! },
  mongodb:    { host: HOST, port: process.env.MONGODB_PORT! },
  memcached:  { host: HOST, port: process.env.MEMCACHED_PORT! },
  mqtt:       { host: HOST, port: process.env.MQTT_PORT! },
  ssh:        { host: HOST, port: process.env.SSH_PORT!, username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD! },
  ftp:        { host: HOST, port: process.env.FTP_PORT!, username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD! },
  irc:        { host: HOST, port: process.env.IRC_PORT! },
  telnet:     { host: HOST, port: process.env.TELNET_PORT! },
  echo:       { host: HOST, port: process.env.ECHO_PORT! },
  discard:    { host: HOST, port: process.env.DISCARD_PORT! },
  daytime:    { host: HOST, port: process.env.DAYTIME_PORT! },
  chargen:    { host: HOST, port: process.env.CHARGEN_PORT! },
  time:       { host: HOST, port: process.env.TIME_PORT! },
  finger:     { host: HOST, port: process.env.FINGER_PORT! },
} as const;
