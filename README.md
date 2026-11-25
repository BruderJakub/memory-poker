# Memory Poker

Ein Partyspiel für den Browser: 16 Karten merken, 2 davon wählen und mit 3 Gemeinschaftskarten die beste Pokerhand bilden. Es spielt immer ein Duell auf einmal, alle anderen schauen zu.

## So spielt man

1. **Host** öffnet die Seite, wählt «Spiel hosten» und stellt den Raum ein: Merkzeit, Auswahlzeit, Spiele pro Person (gerade Zahl).
2. **Spieler** öffnen die Seite auf dem Handy, wählen «Spiel beitreten», geben den 4-stelligen Raumcode und ihren Namen ein (oder scannen den QR-Code) und drücken «Bereit».
3. Sobald alle bereit sind, drückt der Host **Start**.
4. Pro Duell:
   - Die zwei Spieler sehen die 16 Karten A–P für die Merkzeit.
   - Danach sind die Karten verdeckt, 3 Gemeinschaftskarten werden gezeigt. Jeder wählt 2 Buchstaben (zwei Eingabefelder oder Karten antippen, jeder Buchstabe nur einmal).
   - Wer fertig ist, drückt «Bereit». Sind beide bereit, endet die Auswahl sofort. Läuft die Zeit ab, zählt, was eingetragen ist, auch ohne «Bereit».
   - Die Auflösung zeigt alle Karten und beide Hände. Sieg 1 Punkt, Unentschieden 0,5, Niederlage 0. Wer keine gültige Auswahl hat, verliert.
5. Wenn alle ihre Spiele gespielt haben, erscheint die Rangliste.

Niemand spielt zweimal gegen dieselbe Person, alle spielen gleich oft, und wenn möglich spielt niemand zweimal hintereinander.

## Technik

- Reine statische Seite (HTML, CSS, JavaScript), läuft auf GitHub Pages.
- Der Host-Browser führt das Spiel. Die Spieler verbinden sich per WebRTC über [PeerJS](https://peerjs.com/) (öffentlicher Vermittlungsserver, keine eigenen Server nötig).
- Am zuverlässigsten, wenn alle im selben WLAN sind.
- Lädt der Host die Seite neu, kann er das laufende Spiel fortsetzen; Spieler verbinden sich automatisch neu.
- Testmodus ohne Internet: `index.html?local` in mehreren Tabs desselben Browsers.

## Dateien

- `index.html` – Seite
- `style.css` – Aussehen
- `poker.js` – Pokerhände, Kartendeck, Spielplan
- `app.js` – Host, Spieler, Verbindung
