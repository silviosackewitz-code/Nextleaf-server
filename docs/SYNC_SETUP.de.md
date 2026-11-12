# Deine Geräte synchronisieren

[English](SYNC_SETUP.md) · Deutsch · [Español](SYNC_SETUP.es-MX.md)

## Du brauchst keinen Server

Nextleaf funktioniert auch allein. Deine Aufgaben werden auf deinem Gerät
gespeichert. Einen Server brauchst du nur, wenn du dieselben Aufgaben auf mehr als
einem Gerät haben willst.

## Was Synchronisierung ist und was du brauchst

Die Synchronisierung kopiert Änderungen zwischen deinen Geräten über deinen eigenen
Nextleaf-Server. Niemand sonst betreibt einen Server für dich. Du brauchst:

- Einen Computer, auf dem der Server läuft. Zum Ausprobieren reicht dein Laptop.
  Für Synchronisierung zu jeder Zeit nimm einen Raspberry Pi zu Hause oder einen
  gemieteten Server (VPS).
- Tailscale, ein privates Netzwerk zwischen deinen eigenen Geräten. Zum Zeitpunkt
  dieses Textes (2026-11-11) ist der Tarif „Personal“ von Tailscale kostenlos. Die
  aktuellen Bedingungen findest du auf der
  [Preisseite von Tailscale](https://tailscale.com/pricing).

## Drei Möglichkeiten

- **Dein Laptop.** Gut für einen ersten Versuch. Die Synchronisierung funktioniert
  nur, solange der Laptop eingeschaltet und wach ist.
- **Ein Raspberry Pi zu Hause.** Immer eingeschaltet, braucht wenig Strom, und
  deine Daten bleiben bei dir zu Hause.
- **Ein gemieteter Server (VPS).** Immer eingeschaltet, und du brauchst zu Hause
  keine Hardware. Die Hosting-Firma speichert deine Daten auf ihren Rechnern.

## Lass deinen KI-Assistenten alles einrichten

Du musst keine Befehle selbst eintippen. Öffne einen KI-Assistenten, der auf
deinem Computer oder Server arbeiten kann (zum Beispiel Claude, Codex oder einen
ChatGPT-Agenten), und füge diesen Text ein:

```text
Bitte richte für mich einen Nextleaf-Synchronisierungsserver ein. Befolge die
Anleitung in
https://github.com/silviosackewitz-code/Nextleaf-server/blob/main/docs/AGENT_SETUP.md
genau. Frag mich, bevor du Software installierst oder Firewall-Einstellungen
änderst. Frag mich im Chat niemals nach Passwörtern. Wenn du fertig bist, sag
mir die genaue Adresse, die ich in die Nextleaf-App eingeben muss, und wo ich sie
eingeben muss.
```

## Wo du die Adresse eingibst

Öffne in der App **Einstellungen** und dann **Lokale Daten und
Synchronisierung**. Tippe die Adresse in das Adressfeld (wenn es leer ist, steht
dort `https://dein-server`) und drück auf **Verbinden und synchronisieren**.

## Auf einem Mac ausprobieren

Wenn der Server auf demselben Mac läuft wie die App, lautet die Adresse
`http://localhost:8787`. Diese einfache `http`-Adresse funktioniert nur auf
diesem Mac.

## Ein Telefon hinzufügen

Ein Telefon braucht eine Adresse, die mit `https://` beginnt. Installiere
Tailscale auf dem Server-Computer und auf dem Telefon, und melde dich auf beiden
beim selben Tailscale-Konto an. Dein Assistent schaltet Tailscale Serve ein. Damit
bekommt der Server eine private `https://`-Adresse. Gib diese Adresse auf jedem
Gerät ein.

## Sicherheit

> **Mach den Server niemals aus dem Internet erreichbar.** Der Server hat noch
> kein Passwort. Jeder, der ihn erreichen kann, kann alle deine Aufgaben lesen und
> ändern. Nutze dafür keine Portweiterleitung, keinen öffentlichen Proxy und kein
> Tailscale Funnel. Lass ihn in deinem Tailscale-Netzwerk.

## Sicherungen und Updates

Mach vor jedem Update eine Sicherung. Dein Assistent kann für Sicherungen und
Updates [DEPLOYMENT.md](DEPLOYMENT.md) (auf Englisch) befolgen.

Die App und der Server müssen kompatible Versionen haben. Wenn nicht, verweigert
die App die Synchronisierung und ändert nichts. Aktualisiere beide.

## Server-Passwort

Ein Server-Passwort ist geplant. Es ist noch nicht verfügbar.

---

Geschrieben am 2026-11-11.
