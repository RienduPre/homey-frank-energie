# Frank Energie voor Homey

Homey Pro-app die de dynamische prijzen van [Frank Energie](https://www.frankenergie.nl) als **live waarden** beschikbaar maakt, zodat je ze kunt gebruiken in dashboards (bijv. Dashboard Studio), energiebeheer-apps (bijv. Ultimate EMS) en flows.

Port van de [Home Assistant Frank Energie-integratie](https://github.com/HiDiHo01/home-assistant-frank_energie) van HiDiHo01.

## Status

| Fase | Inhoud | Status |
|---|---|---|
| 1 | Dynamische prijzen (geen account nodig) | ✅ v0.1.0 |
| 2 | Frank-account: eigen prijzen, kosten, verbruik, facturen | gepland |
| 3 | Smart Trading (thuisaccu), Slim Laden (Enode), PV / slim terugleveren | gepland |

## Apparaat: Dynamische prijzen

Waarden: stroomprijs nu en volgende, laagste/hoogste/gemiddelde prijs vandaag (met tijdstip), gemiddelde morgen, goedkoopste blok (instelbare lengte) en gasprijs nu.

Instellingen: soort prijs (all-in, markt+, marktprijs), resolutie (kwartier of uur), lengte goedkoopste blok.

**Triggers:** stroomprijs veranderd · zakt onder / stijgt boven een prijs · goedkoopste of duurste moment van de dag begonnen · goedkoopste blok van N uur begonnen · prijzen voor morgen bekend.

**Condities:** prijs onder/boven een waarde · nu een van de N goedkoopste of duurste uren · onder/boven het daggemiddelde · nu in het goedkoopste blok van N uur.

**Actie:** prijzen verversen.

## Ontwikkelen

```bash
npm install -g homey
homey login
npm run images      # genereert de PNG-afbeeldingen (eenmalig)
homey app run        # draait de app op je eigen Homey
npm test             # unit tests prijslogica
homey app validate --level verified
```

## Licentie

MIT. Bevat code afgeleid van de Home Assistant-integratie (MIT, HiDiHo01) en python-frank-energie (Apache-2.0). Niet geassocieerd met Frank Energie.
