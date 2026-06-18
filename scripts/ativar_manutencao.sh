#!/bin/bash
# Ativar modo manutenção

# Remove configuração atual da aplicação
sudo rm -f /etc/nginx/sites-enabled/crtn-belem

# Cria link para página de manutenção
sudo ln -s /etc/nginx/sites-available/manutencao /etc/nginx/sites-enabled/

# Recarrega Nginx
sudo systemctl reload nginx

echo ">>> Modo manutenção ativado. Página de aviso está online."

