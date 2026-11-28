# NCSOFT-Charakter-Abfrage (AION 2 Global) – Datenquelle

Stand 28.11.2026. Beobachtet an der öffentlichen Charakterseite `https://aion2.plaync.com/<sprache>/characters/index`
(deren eigenes Frontend ruft diese Endpunkte ohne Login per GET auf). Nur lesende GETs, keine Anmeldung, kein Cookie.
Nicht offiziell dokumentiert: Pfade und Felder können sich jederzeit ändern. Nichts von Drittprojekten (aion2lab.dev)
übernommen – nur die Idee „Suche über die öffentlichen NCSOFT-Dienste“.

## Hosts (feste Allowlist im Worker, `src/character-core.ts`)

| Host | Zweck |
| --- | --- |
| `api-search.plaync.com` | Charakter-Suche |
| `aion2.plaync.com` | Server, Charakter-Info, Ausrüstung, Einzel-Item |

Bilder liegen auf `assets.playnccdn.com` (Item-/Skill-Icons) und `profileimg.plaync.com` (Profilbild); der Worker reicht nur
`https://`-URLs dieser beiden Hosts durch, alles andere wird verworfen.

## Region / Sprache

`region`: `naw`, `nae`, `eu`, `la`, `as` (Nordamerika West/Ost, Europa, Südamerika, Asien). `lang`/`localeInfo`: `en-US`, `de-DE`, `fr-FR`, `es-ES`, `ja-JP`, `pt-BR`.
Ohne `region` + `localeInfo` antwortet die Suche mit 400 („region and localeInfo must not be empty for aion2global“).
Server-IDs hängen an der Region (z. B. eu: 13xx, naw/nae: 11xx).

## Endpunkte

1. **Server** `GET https://aion2.plaync.com/de-de/api/gameinfo/servers?lang=en-US&region=eu`
   → `{ serverList: [{ raceId, serverId, serverName, serverShortName }] }`
2. **Suche** `GET https://api-search.plaync.com/aion2global/search/v2/character?keyword=<Name>&region=eu&localeInfo=en-US&page=1&size=40[&serverId=1317][&race=1|2][&pcId=…][&sort=level]`
   → `{ list: [{ characterId, name (mit <strong>-Markierung!), race, pcId, level, serverId, serverName, profileImageUrl, region }], pagination: { page, size, total, endPage } }`.
   `characterId` kommt URL-kodiert (`…%3D`) und muss vor der Weitergabe einmal dekodiert werden. Nur Charaktere ab Stufe 45 sind suchbar (laut Seite).
3. **Info** `GET https://aion2.plaync.com/api/character/info?lang=en-US&region=eu&characterId=<id>&serverId=<sid>`
   → `profile` (characterName, className, characterLevel, combatPower, raceName, serverName, profileImage …), `stat.statList` (name/type/value, u. a. ItemLevel),
   `title`, `ranking`, `daevanion.boardList`.
4. **Ausrüstung** `GET https://aion2.plaync.com/api/character/equipment` (gleiche Parameter wie Info)
   → `equipment.equipmentList` (slotPos, slotPosName, id, name, grade, enchantLevel, exceedLevel, icon), `skinList`, `petwing`, `skill`.
5. **Einzel-Item** `GET https://aion2.plaync.com/api/character/equipment/item?lang=en-US&region=eu&id=<itemId>&enchantLevel=<n>&characterId=<id>&serverId=<sid>&slotPos=<n>`
   → Grunddaten (grade, level, maxEnchantLevel, mainStats[id,name,value,extra]), Zufallswerte `subStats` (id, name, value, added), `subSkills`,
   `magicStoneSlotCount` + `magicStoneStat` (id, name, value, grade, slotPos, icon), `soulBindRate`, `sources`.
   Mindest-/Maximalwerte der Zufallswerte oder Reroll-Kosten liefert die API NICHT.

## Verhalten des Proxys (`src/character.ts`)

- nur eingeloggte Dashboard-Nutzer (Session-Cookie, gleiche Origin), Schalter `CHARACTER_LOOKUP` (`"on"` = an, alles andere = aus → 404),
- Eingaben streng validiert (Region/Sprache aus fester Liste, Name 2–24 Zeichen Buchstaben/Ziffern, IDs per Regex), URLs entstehen nur aus Konstanten,
- Antworten auf die benötigten Felder gekürzt, `<strong>` aus Namen entfernt,
- Cache-API je Abfrage (Server 24 h, Suche 5 min, Info/Ausrüstung 10 min, Item 30 min), `User-Agent` neutral, Timeout 8 s,
- Drosselung: 60 Aufrufe/Minute je Raum (pro Worker-Instanz, grob) – Treffer im Cache zählen mit.
