# Frank Energie voor Homey

Homey Pro-app die de dynamische prijzen van [Frank Energie](https://www.frankenergie.nl) als **live waarden** beschikbaar maakt, zodat je ze kunt gebruiken in dashboards (bijv. Dashboard Studio), energiebeheer-apps (bijv. Ultimate EMS) en flows.

Port van de [Home Assistant Frank Energie-integratie](https://github.com/HiDiHo01/home-assistant-frank_energie) van HiDiHo01.

## Status

| Fase | Inhoud | Status |
|---|---|---|
| 1 | Dynamische prijzen (geen account nodig) | ✅ v0.1.0 |
| 2 | Frank-account: eigen prijzen, kosten, verbruik, facturen | ✅ v0.2.0 |
| 3 | Thuisbatterij (Smart Trading), Slim Laden (auto/laadpaal), zonnepanelen (slim terugleveren) | ✅ v0.3.0 |
| 4 | Laadinstellingen, batterijmodus en -strategie, slimme warmtepomp, Belgische prijzen | ✅ v0.4.0 |

## Apparaat: Dynamische prijzen

Waarden: stroomprijs nu en volgende, laagste/hoogste/gemiddelde prijs vandaag (met tijdstip), gemiddelde morgen, goedkoopste blok (instelbare lengte) en gasprijs nu.

Instellingen: land (Nederland of België), soort prijs (all-in, markt+, marktprijs), resolutie (kwartier of uur), lengte goedkoopste blok. Voor België levert Frank geen all-in prijs; de app telt btw, inkoopvergoeding en energiebelasting dan zelf op.

**Triggers:** stroomprijs veranderd · zakt onder / stijgt boven een prijs · goedkoopste of duurste moment van de dag begonnen · goedkoopste blok van N uur begonnen · prijzen voor morgen bekend.

**Condities:** prijs onder/boven een waarde · nu een van de N goedkoopste of duurste uren · onder/boven het daggemiddelde · nu in het goedkoopste blok van N uur.

**Actie:** prijzen verversen.

De triggers, condities en de actie werken voor beide apparaten.

## Apparaat: Frank-account

Inloggen met je Frank Energie e-mailadres en wachtwoord. Het wachtwoord wordt niet bewaard: de app bewaart alleen de tokens van Frank en vernieuwt die automatisch. Alle accountapparaten (adres, thuisbatterij, auto/laadpaal, zonnepanelen) delen één login: ben je al ingelogd, dan slaat het toevoegen van een volgend apparaat het inlogscherm over. Is de login verlopen, dan worden de apparaten onbeschikbaar; **Repareren** bij één apparaat maakt ze allemaal weer actief.

Per leveringsadres één apparaat, met:

- je **eigen klantprijzen** (dezelfde waarden als het prijzenapparaat, maar met jouw inkoopvergoeding en contractresolutie)
- **kosten deze maand** tot de laatste meterstand, verwachte kosten tot nu en voor de hele maand, datum laatste meterstand
- **verbruik en kosten gisteren** voor stroom, teruglevering en gas
- bedrag van de **vorige en huidige factuur**
- of de **slimme warmtepomp** (Smart HVAC) van Frank actief is

## Apparaat: Thuisbatterij (Smart Trading)

Per batterij: laadniveau, status, batterijmodus, handelsstrategie, handelsresultaat vandaag, gisteren, deze maand en totaal, tijdstip laatste update. Wordt elk kwartier ververst.

**Acties:** zet batterijmodus op Zelfconsumptie Plus of Handelen · zet handelsstrategie (standaard, gebalanceerd, conservatief, agressief, alleen onbalans).

## Apparaat: Auto of laadpaal (Slim Laden)

Per auto of laadpaal die via Frank Slim Laden (Enode) gekoppeld is: slim laden en zonneladen aan/uit (schakelbaar), accuniveau, aan het laden, aangesloten, laadvermogen, actieradius, laadlimiet van de auto, minimale en maximale laadlimiet bij Frank, klaar-om-tijd en resterende laadtijd. Wordt elke 5 minuten ververst.

**Triggers:** begon/stopte met laden · aangesloten/losgekoppeld. **Condities:** is aan het laden · is aangesloten · slim laden staat aan. **Acties:** zet slim laden aan/uit · zet zonneladen aan/uit · stel maximale (50–100%) of minimale laadlimiet in · klaar met laden om (tijd).

Het weekschema met vaste vertrektijden per dag pas je aan in de Frank-app.

## Apparaat: Zonnepanelen (slim terugleveren)

Per installatie: status, sturingsstatus, totaal resultaat, totale bonus en of slim terugleveren actief is.

## Ontwikkelen

```bash
npm install
npx homey login
npm run images                  # genereert de PNG-afbeeldingen (na elke update)
npx homey app run --remote      # draait de app op je Homey (zonder Docker)
npm test                        # unit tests prijslogica en API-client
npx homey app validate --level verified
```

Loopt `git pull` vast op `app.json`, typ dan eerst `git checkout -- app.json` (Homey herschrijft dat bestand bij het starten).

## Licentie

MIT. Bevat code afgeleid van de Home Assistant-integratie (MIT, HiDiHo01) en python-frank-energie (Apache-2.0). Niet geassocieerd met Frank Energie.
