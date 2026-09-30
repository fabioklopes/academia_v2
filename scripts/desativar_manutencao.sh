#!/bin/bash

touch /home/academia_v2/manutencao.off
rm -f /home/academia_v2/manutencao.on

rm -f /etc/nginx/sites-enabled/manutencao

nginx -t && systemctl reload nginx