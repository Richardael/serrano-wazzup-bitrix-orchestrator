# Notificaciones y leads por un mismo numero de Wazzup

Un solo numero de WhatsApp atiende leads (flujo 1: bot + Bitrix) y envia las
notificaciones de AppSB (flujo 2). Por canal no se pueden distinguir, asi que la
separacion es por **marca de notificacion**.

## Como funciona

1. AppSB, **antes** de enviar la plantilla, llama a
   `POST /internal/notification-sent` con `Authorization: Bearer $NOTIFICATION_API_SECRET`
   y `{ "phone": "+58412...", "source": "appsb", "messageId": "<opcional>" }`.
2. El orquestador guarda la marca (`notification_markers`, una fila por telefono;
   un nuevo envio la renueva).
3. En `POST /wazzup-ingest`, antes de reenviar al bot y de tocar Bitrix, cada mensaje
   del cliente se compara con las marcas. Si el telefono tiene una marca de menos de
   `NOTIFICATION_REPLY_WINDOW_HOURS` (24 por defecto), la respuesta **no entra al
   flujo de leads**: ni bot, ni lead nuevo, ni lead reutilizado. Queda en Wazzup para
   que una persona la atienda. Se cuenta en `reply_count` / `last_reply_at`.
4. Pasada la ventana, el mensaje sigue el camino de siempre.

## Garantias

- **Falla abierto**: si la base no responde, el mensaje sigue como lead. Perder el
  mensaje de un lead nuevo es peor que dejar que el bot hable con un cliente.
- **Falla cerrado el registro**: sin `NOTIFICATION_API_SECRET` el endpoint responde 401.
  El secreto es distinto del que usa el bot.
- Los ecos y mensajes salientes nunca se consideran respuestas.
- Interruptor: `NOTIFICATION_ROUTING_ENABLED=false` apaga la separacion sin redeploy de codigo.

## Limites conocidos

- La marca solo vale para quien la registra. Una plantilla enviada a mano desde
  Wazzup o por un robot de Bitrix no deja marca.
- Pasadas las 24 h, un cliente con proyecto que escriba al numero sera tratado como lead
  (el bot reinicia cuestionarios y puede crear un lead nuevo si el suyo esta convertido).
- La integracion nativa Wazzup-Bitrix puede crear su propio lead por la respuesta; el
  orquestador solo cierra ese lead cuando existe otro lead activo del mismo telefono.
- Con una respuesta suprimida nadie recibe un aviso activo: hay que mirar Wazzup.
