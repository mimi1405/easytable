# POS-Hospitality-System: Zielarchitektur

> **Version:** 3.3
> **Prinzip:** Erst lokal stabil, dann Cloud-Relay und Sync.
> **Kernidee:** `localMaster` ist die lokale Wahrheit. `relaySyncApi` ist der Cloud-Treffpunkt fuer Sync, Remote Commands und Status. PowerSync und NATS sind Infrastruktur, keine neue Source of Truth.

---

## 1. Grundprinzip

Das System wird lokal-first gebaut. Ein Restaurant muss verkaufen, kassieren, KDS/POS aktualisieren und den Tagesabschluss machen koennen, auch wenn das Internet ausfaellt.

Die zentrale Regel:

> **Der `localMaster` ist pro Standort die lokale Source of Truth.**

Alle operativen und finanzkritischen Daten werden zuerst lokal gespeichert:

* Bestellungen
* Order Items
* Zahlungen
* Tagesabschluesse
* Cash Sessions
* Stornos
* Kuechenstatus
* Print Jobs
* lokale Outbox/Inbox fuer spaeteren Sync

Cloud-Funktionen duerfen den lokalen Betrieb erweitern, aber nicht ersetzen. Wenn die Cloud nicht erreichbar ist, bleiben POS-Shell, KDS und lokaler Servicebetrieb funktionsfaehig.

Clients senden fuer operative Aenderungen Commands oder Requests. Der `localMaster` validiert, entscheidet, speichert die bestaetigte Wahrheit lokal und liefert erst dann Erfolg zurueck. UI-Clients duerfen keinen finalen Verkauf, keine finale Zahlung und keinen finalen Kuechenstatus selbst erfinden.

---

## 2. Naming

### `services/localMaster`

`localMaster` ist der lokale Backend-Core eines Standorts. Er laeuft auf dem Master-PC im Restaurant und besitzt die lokale SQLite-Wahrheit.

Der Begriff ersetzt alte oder kleinere Begriffe wie `localRealtimeManager`, `Print-Hub` oder lokale Tauri-DB-Kommandos. `localMaster` ist nicht nur Realtime oder Druck, sondern der lokale Core.

### `services/relaySyncApi`

`relaySyncApi` ist der zukuenftige Cloud-Server.

Er vereint zwei Cloud-Aufgaben in einer Node/Fastify-App:

* **Sync API:** Stammdaten, Reports, Tagesabschluss-Upload, Health, History.
* **Relay API:** Live Commands von Cloud/5G-Staff-Geraeten an den verbundenen `localMaster`.
* **PowerSync API:** Token- und Upload-Endpunkte fuer die technische Replikation lokaler Read Models.

Wichtig:

`Sync` und `Relay` teilen Auth, Tenant, Location, DB und Deployment, bleiben im Code aber logisch getrennt.

```text
services/relaySyncApi
  src/sync/*
  src/relay/*
  src/auth/*
  src/db/*
```

Es ist bewusst **eine** Cloud Node-App fuer v1, nicht zwei separate Cloud-Server. Spaeter kann Relay ausgelagert werden, falls Traffic oder Skalierung das erzwingen.

---

## 3. Hauptkomponenten

### 3.1 LocalMaster

Technologie:

* Node.js
* Fastify
* REST API
* WebSocket Server
* lokale SQLite-Datenbank
* PowerSync-Connector gegen dieselbe lokale SQLite-Datei
* NATS-Command-Poke-Subscription fuer Cloud Relay
* Cloud Connector zu `relaySyncApi`

Aufgaben:

* lokale SQLite-Datenbank besitzen und migrieren
* Katalog, Varianten, Tischplan, Orders, Payments und Day Close bereitstellen
* POS-Shell, Staff und KDS als Clients bedienen
* Realtime-Events verteilen
* Terminal-/Geraete-Pairing verwalten
* Tagesabschluss berechnen und speichern
* Print Queue und lokale Outbox/Inbox verwalten
* Cloud Binding, Bootstrap und Relay-Token verwalten
* PowerSync und Relay-Polling starten, ohne lokalen Betrieb zu blockieren

Netzwerkstandard:

```text
Host: 0.0.0.0
Port: 3000
```

Produktionsregel:

Der Master-PC bekommt eine stabile LAN-Adresse, bevorzugt per DHCP-Reservierung im Router. Beispiel:

```text
Master-PC:   192.168.1.20
LocalMaster: http://192.168.1.20:3000
```

### 3.2 POS-Shell

Die POS-Shell ist die stationaere Kassenoberflaeche.

Technologie:

* Tauri
* React
* LocalMaster API Client
* Tauri-Appconfig fuer gespeicherte Terminal-Kopplung

Aufgaben:

* Tischplan und Kasse anzeigen
* Produkte buchen
* Zahlungen erfassen
* Tagesabschluss anzeigen/speichern
* LocalMaster-Verbindung einrichten
* Realtime-Events empfangen

Wichtig:

Die POS-Shell besitzt keine eigene autoritative SQLite-Wahrheit. Persistenz und Geschaeftslogik gehoeren in den `localMaster`.

### 3.3 Staff-App

Die Staff-App ist eine mobile Web-App fuer Service, Owner und KDS-Rollen.

Rollenidee:

* `service`: Tischplan, Bestellung aufnehmen, offene Orders ergaenzen
* `kds`: eingehende Items nach Station sehen und Status aendern
* `owner`: Katalog, Steuern, Benutzer, Reports und Standortverwaltung

Local-first v1:

Staff/KDS im Restaurant laden die App lokal vom `localMaster` oder sprechen direkt mit ihm:

```text
http://192.168.1.20:3000/staff
```

Damit funktionieren lokale Realtime-Updates stabil im Restaurant-WLAN.

Hybrid:

Wenn ein Staff-Geraet nicht im lokalen WLAN ist, z.B. Terrasse, grosse Flaeche oder 5G-Fallback, kann die Staff-App Commands ueber `relaySyncApi` senden. Der `localMaster` bekommt diese Commands ueber seinen ausgehenden Cloud-Tunnel.

### 3.4 KDS

KDS ist ein Client gegen den `localMaster`.

Aufgaben:

* neue Items live anzeigen
* nach stabiler `station_id` filtern, z.B. Bar, Kueche, Shisha als Anzeigename
* Statusaenderungen senden

KDS speichert nicht final. Der `localMaster` bleibt Master.

Stationen sind Standort-/Tenant-Objekte. Routing nutzt stabile IDs wie `station_id`; Stationsnamen sind Anzeige- und Snapshot-Daten und duerfen nicht die technische Routing-Wahrheit sein.

### 3.5 RelaySyncApi

`relaySyncApi` ist der zukuenftige Cloud-Server.

Technologie:

* Node.js + TypeScript
* Fastify
* PostgreSQL
* Better Auth fuer Cloud-/Staff-Sessions
* PowerSync Token-/Upload-Endpunkte
* NATS fuer interne Command-Wakeups
* SSE fuer Relay-Staff-Realtime
* Docker Deployment

Aufgaben:

* Auth, Tenant, Location und Rollen kennen
* Sync-Daten speichern und ausliefern
* Commands persistent speichern
* verbundene `localMaster` Instanzen kennen
* Commands ueber HTTP Polling plus NATS-Poke an den passenden `localMaster` ausliefern
* Status zurueckgeben: `pending`, `delivered`, `accepted`, `failed`

---

## 4. Netzwerk- und Pairing-Lifecycle

Ein Standort hat genau einen aktiven `localMaster`.

Kleine Installation:

```text
Master-PC = localMaster + POS-Shell
POS URL   = http://localhost:3000
```

Groessere Installation:

```text
Master-PC = localMaster + optional POS-Shell
Kasse 2   = POS-Shell Client
Kasse 3   = POS-Shell Client
Staff     = Web/PWA Clients
KDS       = Web/PWA Clients
```

Alle Clients zeigen auf den Master-PC:

```text
http://192.168.1.20:3000
```

Pairing:

1. POS-Shell oeffnet `Mehr > Einstellungen > LocalMaster`.
2. Techniker traegt LocalMaster URL ein.
3. POS testet `/api/local-master/identity`.
4. LocalMaster erzeugt kurzen Pairing-Code.
5. Terminal koppelt sich mit Name und Rolle.
6. POS speichert dauerhaft:
   * `localMasterUrl`
   * `localMasterInstanceId`
   * `terminalId`
   * `terminalName`
   * `terminalRole`
   * `terminalSecret`
   * `pairedAt`
   * `lastSeenAt`

Beim Start prueft der Client die gespeicherte `localMasterInstanceId`. Wenn eine andere Instanz antwortet oder die Instanz nicht verifizierbar ist, wird blockiert und eine Neu-Kopplung oder Wiederverbindung verlangt. So bucht keine Kasse versehentlich auf den falschen Master.

---

## 5. Lokale Kommunikation

REST fuer klare Aktionen:

* Produktliste laden
* Varianten laden
* Tischplan laden
* Bestellung speichern
* Zahlung abschliessen
* Tagesabschluss speichern
* KDS-Status aendern

WebSocket fuer Benachrichtigungen:

* `ORDER_CREATED`
* `TABLE_UPDATED`
* `PAYMENT_COMPLETED`
* `KITCHEN_STATUS_UPDATED`
* `DEVICE_CONNECTED`
* `DEVICE_DISCONNECTED`
* `HEARTBEAT`

WebSocket-Events sind Hinweise. Die bestaetigte Wahrheit liegt lokal im `localMaster` und wird ueber REST/API erneut gelesen, wenn ein Client sicher synchron sein muss.

---

## 6. Command-, Idempotency- und Outbox-Modell

Alle operativen Aktionen werden als Commands oder idempotente Requests behandelt. Das gilt lokal und spaeter ueber Relay:

* Bestellung anlegen oder erweitern
* Zahlung starten, bestaetigen oder korrigieren
* KDS-Status aendern
* Storno, Void oder Rabatt buchen
* Tagesabschluss speichern
* Print Job erzeugen oder wiederholen

Jeder kritische Command braucht eine stabile `command_id` oder `request_id`. Wenn derselbe Command erneut ankommt, muss `localMaster` das bereits gespeicherte Ergebnis zurueckgeben oder sicher ablehnen. Reconnects, Doppelklicks, Timeouts und Relay-Replays duerfen keine doppelten Orders, Payments, Print Jobs oder Finanzrecords erzeugen.

Der `localMaster` fuehrt eine lokale Outbox/Inbox in SQLite:

* **Inbox:** eingehende lokale oder Relay-Commands, Idempotency-Key, Status und Ergebnis.
* **Outbox:** bestaetigte lokale Ereignisse fuer Sync, Reporting, Replay, Diagnose und Cloud-Abgleich.

Die Outbox ist nicht die operative Wahrheit, sondern ein durable Log der lokal bereits bestaetigten Wahrheit. Cloud-Sync liest spaeter daraus und darf langsam oder pausiert sein.

Payment-Flows muessen externe Provider-Zustaende und lokale Persistenz getrennt modellieren. Ein Zahlungsanbieter kann Geld erfolgreich autorisieren oder abbuchen, waehrend die lokale Speicherung, der Belegdruck oder die Cloud-Synchronisierung fehlschlaegt. Dieser Fall ist kein normaler `success/fail`, sondern ein eigener Stoerfall.

Mindestens diese Payment-Zustaende muessen unterscheidbar sein:

```text
payment_started
provider_authorized
local_recorded
receipt_queued
completed
failed
reversal_required
```

Eine Zahlung gilt erst lokal abgeschlossen, wenn `localMaster` den Payment-Datensatz, den Order-Zustand und die noetigen Audit-/Print-Folgen lokal persistiert hat.

---

## 7. Cloud Relay und Sync

Cloud ist in zwei Aufgaben getrennt.

### Sync

Sync transportiert Zustand und Historie:

* Katalogupdates
* Steuer-/Preisupdates
* Tagesabschluesse
* Orders/Payments fuer Reporting
* Remote Health
* Versionsstatus

Sync darf langsam oder periodisch sein.

Cloud-Orders und Cloud-Payments sind fuer Reporting, History, Sync und Remote-Auswertung gedacht. Sie sind Spiegel oder Read Models der lokalen Wahrheit, nicht der operative Master fuer den laufenden Restaurantbetrieb.

### Relay

Relay transportiert Live Commands mit Bestaetigung:

* Staff bucht ueber 5G einen Tisch
* Cloud speichert Command
* Cloud liefert an verbundenen `localMaster`
* `localMaster` fuehrt lokal aus
* `localMaster` bestaetigt oder lehnt ab
* Cloud aktualisiert Command-Status

Command-Status:

```text
pending    = Cloud hat Command gespeichert
delivered  = an localMaster gesendet
accepted   = localMaster hat lokal ausgefuehrt
failed     = localMaster hat abgelehnt oder Fehler
```

Wichtig:

Ein Staff-Client darf erst `gebucht` anzeigen, wenn `accepted` vom `localMaster` zurueckkam. Vorher ist der Command pending. Das gilt auch dann, wenn die Cloud den Command bereits gespeichert oder an den Tunnel geliefert hat.

Aktueller Transport:

```text
Staff/Owner/KDS ausserhalb WLAN
-> relaySyncApi speichert Command in PostgreSQL relay_commands
-> relaySyncApi published optional einen NATS-Poke
-> localMaster pollt /api/local-masters/commands/pending
-> localMaster fuehrt lokal aus
-> localMaster ACKt /api/local-masters/commands/:commandId/ack
```

NATS beschleunigt nur die Abholung. Die dauerhafte Queue, Redelivery und ACK-Wahrheit liegen in PostgreSQL und im lokalen Command-/Idempotency-Modell.

Beispiel Command:

```json
{
  "command_id": "cmd_123",
  "tenant_id": "tenant_basilica",
  "location_id": "loc_basilica_main",
  "local_master_instance_id": "lm_abc",
  "type": "ADD_ITEMS_TO_TABLE",
  "payload": {
    "table_id": "table_12",
    "items": [
      { "product_id": "prod_cola", "quantity": 2 }
    ]
  }
}
```

---

## 8. Sync- und Messaging-Infrastruktur

PowerSync, NATS, WebSocket und SSE haben verschiedene Aufgaben. Keine dieser Transportebenen ersetzt den `localMaster` als lokale Wahrheit.

### 8.1 PowerSync

PowerSync ist technische Sync-Infrastruktur fuer lokale und Cloud-Read-Models.

Aktuell:

* `services/localMaster` nutzt `@powersync/node`.
* Die PowerSync-Datenbank ist an dieselbe lokale SQLite-Datei gekoppelt, die `localMaster` besitzt.
* Der Connector holt Credentials ueber `relaySyncApi`:

```text
GET /api/local-masters/powersync-token
Authorization: Bearer <relay_token>
```

* Lokale CRUD-Batches werden an `relaySyncApi` hochgeladen:

```text
POST /api/local-masters/powersync-upload
Authorization: Bearer <relay_token>
```

* `relaySyncApi` mappt bekannte Tabellen auf PostgreSQL-Tabellen und ignoriert unbekannte Tabellen.

Soll-Regeln:

* PowerSync darf Stammdaten, Layout, Orders/Payments-Readmodels und Diagnosezustand replizieren.
* PowerSync darf keine Zahlung, Bestellung, KDS-Aenderung, Print-Queue oder Day-Close final entscheiden.
* Wenn PowerSync nicht verbunden ist oder Uploads fehlschlagen, muss der lokale Restaurantbetrieb weiterlaufen.
* Konflikte werden in der Cloud als Sync-/Reporting-Problem behandelt, nicht als Grund, lokale Kassenablaeufe zu stoppen.

### 8.2 NATS

NATS ist ein interner Wake-up-Bus fuer Relay Commands.

Aktuell:

* `relaySyncApi` published nach dem Speichern eines persistenten Commands ein Event.
* `localMaster` subscribed nach erfolgreichem Cloud-Pairing.
* Subject:

```text
commands.{tenantId}.{locationId}.{localMasterInstanceId}
```

* Die Message enthaelt nur einen Hinweis auf den Command, z.B. `commandId`.
* Nach einem Poke ruft `localMaster` trotzdem die durable Queue ab.

Soll-Regeln:

* NATS ist kein Command Store.
* NATS darf keine ACKs und keine finalen Ergebnisse ersetzen.
* Wenn NATS ausfaellt, muss periodisches HTTP Polling weiterhin Commands finden.
* Bei Reconnect triggert `localMaster` einen Catch-up-Poll.

### 8.3 Realtime fuer Clients

Lokales Realtime:

* `localMaster` sendet WebSocket-Events an lokale POS-/Staff-/KDS-Clients.
* Events sind Hinweise; Clients lesen bei Bedarf bestaetigte Wahrheit per REST erneut.

Relay-Realtime:

* `relaySyncApi` bietet Staff/Owner/KDS im Relay-Modus SSE-Events.
* SSE spiegelt Cloud-/Relay-Status und Readmodel-Aenderungen.
* SSE ersetzt keine lokale Ausfuehrung und keine `accepted`-ACKs.

---

## 9. Hybrid-Betrieb fuer grosse Flaechen

Fast Path:

```text
Staff im Restaurant-WLAN -> localMaster direkt
```

Fallback Path:

```text
Staff ueber 5G/anderes Netz -> relaySyncApi -> localMaster Cloud Connector
```

Restaurant-Anforderung fuer Live-Fallback:

Der `localMaster` braucht Internet, damit er Commands aus der Cloud-Queue abholen, NATS-Pokes empfangen und ACKs an `relaySyncApi` senden kann.

Wenn Staff 5G hat, aber der Master-PC kein Internet, kann die Cloud Commands nur speichern. Sie darf keinen Erfolg vortaeuschen. Die Staff-App zeigt dann `wartet auf Restaurant` oder `pending`.

Fuer sehr grosse Flaechen oder Terrassen ist empfohlen:

* internes Staff-WLAN mit Access Points bis Terrasse
* Router mit 5G-Backup fuer Restaurant-Internet
* Cloud Relay als Fallback, nicht als Ersatz fuer lokale Stabilitaet

---

## 10. Systembild

```text
                              CLOUD
                    services/relaySyncApi
        Sync API / Relay Commands / Auth / Reporting
                PowerSync API / SSE / NATS Pokes
                         ^              ^
                         |              |
              PowerSync/HTTP       HTTP Poll + ACK
              Sync/Health          optional NATS Poke
+---------------------------------------------------------+
|                    LOKALER STANDORT                     |
|                                                         |
|  +---------------------------------------------------+  |
|  |                    localMaster                    |  |
|  | Node.js + Fastify                                 |  |
|  | REST API + WebSocket                              |  |
|  | lokale SQLite Source of Truth                     |  |
|  | Orders / Payments / Day Close / KDS / Outbox      |  |
|  +------------------------^--------------------------+  |
|                           |                             |
|              REST / WebSocket / lokale API              |
|                           |                             |
|  +----------+  +-----------+  +------+  +------------+  |
|  |POS-Shell |  |Staff-App  |  | KDS  |  |Manager/Own.|  |
|  |Tauri UI  |  |Web/PWA    |  |PWA   |  |Web/PWA     |  |
|  +----------+  +-----------+  +------+  +------------+  |
+---------------------------------------------------------+

Fallback ausserhalb WLAN:

Staff-App -> relaySyncApi -> durable relay_commands -> localMaster pollt/ACKt -> lokale Realtime Events
```

---

## 11. Beispiel: lokale Bestellung

```text
Staff im WLAN nimmt Bestellung auf
-> Staff-App sendet idempotenten Command/REST Call an localMaster
-> localMaster validiert Tabelle, Produkte, Preise, Varianten
-> localMaster speichert Bestellung lokal
-> localMaster schreibt bestaetigtes Ereignis in die Outbox
-> localMaster broadcastet TABLE_UPDATED / ORDER_CREATED
-> POS-Shell und KDS aktualisieren live
-> Staff-App erhaelt bestaetigte Order
```

---

## 12. Beispiel: 5G/Cloud-Relay Bestellung

```text
Staff-Geraet ist nicht im Restaurant-WLAN
-> Staff-App sendet ADD_ITEMS_TO_TABLE an relaySyncApi
-> relaySyncApi speichert Command als pending
-> relaySyncApi published optional einen NATS-Poke
-> localMaster holt Command per HTTP Polling ab
-> localMaster prueft lokale Struktur, command_id und Idempotenz
-> localMaster speichert Order lokal
-> localMaster schreibt bestaetigtes Ereignis in die Outbox
-> localMaster broadcastet lokale Realtime Events
-> localMaster sendet accepted an relaySyncApi
-> Staff-App sieht gebucht
```

Falls der `localMaster` nicht verbunden ist:

```text
Command bleibt pending
Staff-App zeigt nicht gebucht, sondern wartet auf Restaurant
```

---

## 13. Lokale Datenverantwortung

| Bereich              | Master                         |
| -------------------- | ------------------------------ |
| Bestellungen         | localMaster / lokale SQLite    |
| Zahlungen            | localMaster / lokale SQLite    |
| Tagesabschluss       | localMaster / lokale SQLite    |
| Kuechenstatus        | localMaster / lokale SQLite    |
| Print Queue          | localMaster / lokale SQLite    |
| Terminal Pairing     | localMaster / lokale SQLite    |
| Relay Command Result | localMaster entscheidet final  |
| Sync Outbox          | localMaster / lokale SQLite    |
| Sync Inbox           | localMaster / lokale SQLite    |
| Sync History Cloud   | relaySyncApi / PostgreSQL      |
| Command Queue Cloud  | relaySyncApi / PostgreSQL      |
| NATS                 | Wake-up/Poke, nicht durable    |
| PowerSync            | Sync-Infrastruktur/Read Models |
| Produkte MVP         | localMaster lokal              |
| Produkte spaeter     | Cloud, localMaster pullt       |
| Staff-Drafts         | Staff-App lokal bis gesendet   |
| Reporting spaeter    | relaySyncApi / Cloud DB        |
| Cloud Orders/Payments| Spiegel/Read Model, nicht Master |

---

## 14. MVP-Reihenfolge

### MVP 1: LocalMaster Core + POS-Shell

Status: aktiv im Aufbau.

Enthaelt:

* LocalMaster mit Node/Fastify
* POS-Shell als Tauri/React Client
* LocalMaster URL und Terminal-Pairing
* Katalog, Tischplan, Orders, Payments, Cash Close lokal
* idempotente lokale Commands fuer kritische Aktionen
* WebSocket Events fuer POS-Refresh

### MVP 2: Staff/KDS lokal

Ziel:

Staff-App und KDS sprechen direkt mit demselben `localMaster`.

Enthaelt:

* Staff-App als Web/PWA Client
* Rollenbasierte Sidebar fuer `service`, `kds`, `owner`
* Service Flow: Tisch auswaehlen, Items buchen
* KDS Flow: station-id-basierte Anzeige
* lokale Realtime Events

### MVP 3: Finanz- und Tagesabschluss-Haertung

Enthaelt:

* Cash Session
* Startgeld
* Cash In / Cash Out
* Tagesabschluss
* Soll/Ist-Vergleich
* Audit-Metadaten
* Payment-Partial-Failure-Handling
* Z-Bon/Print Queue

### MVP 4: RelaySyncApi Grundgeruest

Ziel:

Ein Cloud-Server fuer Sync und Relay wird vorbereitet, ohne den lokalen Betrieb zu gefaehrden.

Enthaelt:

* `services/relaySyncApi` als Workspace-Service
* Fastify + TypeScript
* PostgreSQL Command-/Sync-Tabellen
* HTTP Polling + ACK-Endpunkte fuer `localMaster`
* NATS-Poke fuer schnellere Command-Abholung
* PowerSync Token-/Upload-Endpunkte fuer Sync-Readmodels
* erste Command Queue mit `pending/delivered/accepted/failed`
* erster Command: `ADD_ITEMS_TO_TABLE`

### MVP 5: Hybrid Staff Fallback

Ziel:

Staff-App kann bei grossen Flaechen/5G ueber Cloud Relay Commands senden.

Enthaelt:

* localMaster Cloud Connector
* idempotente Command-Verarbeitung
* Staff UI fuer pending/accepted/failed
* Reconnect und Retry

---

## 15. Kritische Regeln

1. `localMaster` ist die lokale Source of Truth.
2. Pro Standort gibt es genau einen aktiven `localMaster`.
3. POS-Shell, Staff-App und KDS sind Clients gegen `localMaster`.
4. POS-Shell fuehrt keine parallele autoritative SQLite-Wahrheit.
5. Staff-App darf keine finale Bestellung anzeigen, bevor `localMaster` akzeptiert hat.
6. KDS darf Statusaenderungen senden, aber `localMaster` speichert final.
7. Ohne Internet muss lokale Kasse weiterlaufen.
8. Ohne `localMaster` duerfen Clients nur Drafts/Pending Commands haben, keine finalen Verkaeufe.
9. Alle kritischen lokalen Commands brauchen eindeutige `command_id` oder `request_id` und lokale Idempotenz.
10. Cloud Relay darf keinen lokalen Erfolg vortaeuschen.
11. Sync transportiert Zustand; Relay transportiert Live Commands mit ACK.
12. Alle Preise werden als Integer in Rappen/Cents gespeichert.
13. Order Items speichern Produktname, Preis, Steuer und Routing-Snapshot.
14. Druckauftraege laufen ueber Queue, nicht nur Runtime-Events.
15. Lokale Outbox/Inbox wird persistent in SQLite gespeichert.
16. Payment Provider Erfolg ohne lokale Speicherung ist ein eigener Stoerfall und muss korrigierbar sein.
17. Station Routing nutzt stabile `station_id`; Namen sind Anzeige/Snapshot.
18. Cloud Orders/Payments sind Sync-/Reporting-Spiegel, nicht operative Master-Wahrheit.
19. Mehrere SQLite-Master pro Standort sind kein Ziel.
20. PowerSync ist Sync-Infrastruktur und darf lokale operative Entscheidungen nicht ersetzen.
21. NATS ist nur Wake-up/Poke; durable Commands und ACKs bleiben in PostgreSQL und lokalem Idempotency-State.

---

## 16. Naechster technischer Schnitt

Kurzfristig:

1. `relaySyncApi` als Cloud-Service mit Auth, Tenant/Location, Relay Commands, PowerSync und NATS klar halten.
2. PowerSync und NATS robust machen, ohne lokale Orders/Payments davon abhaengig zu machen.
3. Staff/KDS lokal gegen `localMaster` weiter stabilisieren.
4. Danach Hybrid Staff Fallback ueber durable Relay Commands ausbauen.

Die aktuelle Prioritaet bleibt:

```text
localMaster stabilisieren
-> POS-Shell koppeln und betreiben
-> Staff/KDS lokal bauen
-> relaySyncApi fuer Sync/Relay vorbereiten
```
