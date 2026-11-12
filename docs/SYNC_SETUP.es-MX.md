# Sincroniza tus dispositivos

[English](SYNC_SETUP.md) · [Deutsch](SYNC_SETUP.de.md) · Español

## No necesitas un servidor

Nextleaf funciona por sí solo. Tus tareas se guardan en tu dispositivo. Solo
necesitas un servidor si quieres tener las mismas tareas en más de un dispositivo.

## Qué es la sincronización y qué necesitas

La sincronización copia los cambios entre tus dispositivos a través de tu propio
servidor de Nextleaf. Nadie más opera un servidor por ti. Necesitas:

- Una computadora que ejecute el servidor. Tu laptop sirve para probarlo. Para
  sincronizar en cualquier momento, usa una Raspberry Pi en casa o un servidor
  rentado (VPS).
- Tailscale, una red privada entre tus propios dispositivos. Al momento de escribir
  esto (2026-11-11), el plan "Personal" de Tailscale es gratuito. Consulta los
  [precios de Tailscale](https://tailscale.com/pricing) para ver las condiciones
  actuales.

## Tres opciones

- **Tu laptop.** Buena para una primera prueba. La sincronización solo funciona
  mientras la laptop está encendida y activa.
- **Una Raspberry Pi en casa.** Siempre encendida, usa poca energía y tus datos se
  quedan en tu casa.
- **Un servidor rentado (VPS).** Siempre encendido y no necesitas equipo en casa.
  La empresa de hosting guarda tus datos en sus máquinas.

## Deja que tu asistente de IA lo configure

No tienes que escribir comandos tú mismo. Abre un asistente de IA que pueda
trabajar en tu computadora o servidor (por ejemplo Claude, Codex o un agente de
ChatGPT) y pega esto:

```text
Por favor, configura un servidor de sincronización de Nextleaf para mí. Sigue
exactamente las instrucciones de
https://github.com/silviosackewitz-code/Nextleaf-server/blob/main/docs/AGENT_SETUP.md
Pregúntame antes de instalar software o de cambiar la configuración del firewall.
Nunca me pidas contraseñas en el chat. Cuando termines, dime la dirección exacta
que tengo que escribir en la app de Nextleaf y dónde tengo que escribirla.
```

## Dónde escribir la dirección

En la app, abre **Configuración** y luego **Datos locales y sincronización**.
Escribe la dirección en el campo de dirección (cuando está vacío muestra
`https://tu-servidor`) y presiona **Conectar y sincronizar**.

## Pruébalo en una Mac

Si el servidor se ejecuta en la misma Mac que la app, la dirección es
`http://localhost:8787`. Esta dirección `http` simple solo funciona en esa Mac.

## Agrega un teléfono

Un teléfono necesita una dirección que empiece con `https://`. Instala Tailscale
en la computadora del servidor y en el teléfono, e inicia sesión en la misma
cuenta de Tailscale en los dos. Tu asistente activa Tailscale Serve, que le da al
servidor una dirección `https://` privada. Escribe esa dirección en cada
dispositivo.

## Seguridad

> **Nunca hagas que el servidor sea accesible desde internet.** El servidor
> todavía no tiene contraseña. Cualquiera que pueda acceder a él puede leer y
> cambiar todas tus tareas. No uses redirección de puertos, un proxy público ni
> Tailscale Funnel para él. Mantenlo dentro de tu red de Tailscale.

## Respaldos y actualizaciones

Haz un respaldo antes de cada actualización. Tu asistente puede seguir
[DEPLOYMENT.md](DEPLOYMENT.md) (en inglés) para los respaldos y las
actualizaciones.

La app y el servidor deben tener versiones compatibles. Si no las tienen, la app
se niega a sincronizar y no cambia nada. Actualiza los dos.

## Contraseña del servidor

Está planeada una contraseña para el servidor. Todavía no está disponible.

---

Escrito el 2026-11-11.
