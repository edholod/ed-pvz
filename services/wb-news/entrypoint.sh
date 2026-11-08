#!/bin/sh
set -eu
umask 077
mkdir -p "${DATA_DIR:-/var/lib/ed-pvz}"
chown pwuser:pwuser "${DATA_DIR:-/var/lib/ed-pvz}"
chmod 700 "${DATA_DIR:-/var/lib/ed-pvz}"
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/ed-pvz.conf
