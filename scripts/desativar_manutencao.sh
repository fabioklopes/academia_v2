#!/bin/bash
# Desativar modo manutenção

# Remove configuração de manutenção
sudo rm -f /etc/nginx/sites-enabled/manutencao

# Cria link para configuração da aplicação
sudo ln -s /etc/nginx/sites-available/crtn-belem /etc/nginx/sites-enabled/

# Recarrega Nginx
sudo systemctl reload nginx

echo ">>> Modo manutenção desativado. Aplicação voltou ao ar."

