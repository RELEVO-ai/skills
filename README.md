# RELEVO Skills

Skills compartidas del equipo RELEVO.

## Instalar una skill

```bash
git clone https://github.com/RELEVO-ai/skills.git ~/.relevo/skills
ln -s ~/.relevo/skills/payments-mercadopago ~/.config/opencode/skills/payments-mercadopago
```

## Sincronizar

```bash
cd ~/.relevo/skills && git pull
```

## Publicar cambios

```bash
cd ~/.relevo/skills && git add . && git commit -m "..." && git push
```
