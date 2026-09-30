#!/bin/bash

touch /home/academia_v2/manutencao.on
rm -f /home/academia_v2/manutencao.off

ln -sf /etc/nginx/sites-available/manutencao \
/etc/nginx/sites-enabled/manutencao

nginx -t && systemctl reload nginx