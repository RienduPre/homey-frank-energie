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
| 5 | Dashboard-widgets: Prijs nu, Prijsverwachting, Prijsgrafiek | ✅ v0.5.0 |

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

## Dashboard-widgets

Drie widgets voor Homey-dashboards, naar voorbeeld van de kaarten van [Tibber Prices](https://github.com/jpawlowski/hass.tibber_prices) voor Home Assistant. Kies ze in een dashboard via **Widget toevoegen → Frank Energie**. Ze tonen de prijzen van een apparaat *Dynamische prijzen* of *Frank-account* (instelling **Prijzen van**; leeg = het eerste) en verversen zichzelf zodra er een nieuw kwartier of nieuwe prijzen zijn.

| Widget | Wat je ziet |
|---|---|
| **Prijs nu** | De prijs van nu met niveau en een korte duiding (goedkope of dure periode, wanneer het goedkoop wordt). Drie weergaven: *Meter* (prijs op de schaal van vandaag, met tick voor het daggemiddelde), *Tegel* (één regel tussen andere tegels) en *Klok* (de komende 12 uur rond een wijzerplaat, goedkope en dure periodes als bogen). Kan ook de gasprijs tonen. |
| **Prijsverwachting** | Als een weerbericht: de prijs nu, de komende uren als staafjes (tik een uur voor de kwartierprijzen), de dagdelen (nacht, ochtend, middag, avond) met gemiddelde en bandbreedte, en vandaag/morgen op één schaal met mediaan, gemiddelde en verschil met vandaag. Groene chips laten zien hoeveel je bespaart door te wachten. Elk onderdeel is aan/uit te zetten. |
| **Prijsgrafiek** | De prijscurve per kwartier of uur, gekleurd per prijsniveau, met daggemiddelde, laagste en hoogste prijs en balkjes voor goedkope en dure periodes. Schuif met je vinger over de grafiek om prijzen af te lezen. Weergaven: *Vooruit*, *Vandaag*, *Morgen* en *2 dagen*. |

Begrippen (berekend in de app, want Frank levert ze niet zelf):

- **Prijsniveau**: afwijking van het gemiddelde van die dag. Zeer goedkoop ≤ −20 %, goedkoop ≤ −10 %, duur ≥ +10 %, zeer duur ≥ +20 %; negatieve prijzen zijn altijd zeer goedkoop.
- **Goedkope periode**: aaneengesloten kwartieren (minstens 30 minuten) die goedkoop of zeer goedkoop zijn; één kwartier ertussen mag. Een dag zonder goedkope kwartieren krijgt zijn goedkoopste uur. **Dure periode** werkt net zo met dure kwartieren.
- **Schommeling**: verschil tussen hoogste en laagste prijs ten opzichte van het gemiddelde.

Widgets vragen Homey 12.3 of nieuwer en werken niet op Homey Cloud.

## Ontwikkelen

```bash
npm install
npx homey login
npm run images                  # genereert PNG-afbeeldingen en widget-previews, kopieert de gedeelde widgetcode (na elke update)
npx homey app run --remote      # draait de app op je Homey (zonder Docker)
npm test                        # unit tests prijslogica, widgetdata en API-client
npm run widgets                 # kopieert widgets-src/frank.js en frank.css naar elke widget
npx homey app validate --level verified
```

Loopt `git pull` vast op `app.json`, typ dan eerst `git checkout -- app.json` (Homey herschrijft dat bestand bij het starten).

## Licentie

MIT. Bevat code afgeleid van de Home Assistant-integratie (MIT, HiDiHo01) en python-frank-energie (Apache-2.0). Niet geassocieerd met Frank Energie.
