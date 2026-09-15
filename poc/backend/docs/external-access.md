# Külső előfeltételek jegyzéke – M0-19

2026-09-15 · Amit nem lehet kitalálni, csak megkapni. A hiányzó hozzáférés az
érintett fázist blokkolja, az M0 core kaput nem.

| # | Előfeltétel | Felelős | Célfázis | Állapot |
| --- | --- | --- | --- | --- |
| E01 | Konténerregiszter-elérés az image-ek húzásához és digest rögzítéséhez | Zoli | M0-16b | Hiányzik a jelen munkakörnyezetben; a `VERSIONS.md` digest sorai emiatt nyitottak |
| E02 | Authentik tesztpéldány vagy futtatható helyi Authentik, admin hozzáféréssel | Claude (beállítás), Zoli (hozzáférés) | M2 | Nyitott |
| E03 | Tényleges OIDC issuer, audience, JWKS URI és egy kiadott teszttoken | Claude | M2 | Nyitott; a discovery önmagában nem igazolja az audience-t |
| E04 | Három tesztidentitás (viewer, editor, publisher) és a csoport→jog leképezés | Zoli | M2 | Nyitott; a `poc-viewer/editor/publisher` csoportnevek javaslatok |
| E05 | Token- és refresh-élettartam tényleges providerbeállítása | Claude | M2 | Nyitott; a D06 célértékek (5 perc / 1 óra) még nem mértek |
| E06 | Ant Media tesztkörnyezet, asset- és broadcast-azonosítók | Zoli | M6 | Nyitott |
| E07 | DRMaaS sandbox, kulcs- és licencszolgáltatás, kompatibilis player | Zoli | M6 | Nyitott |
| E08 | Valós üzleti entitlement-szabályok a playback-authorize szerződéshez | Zoli | M6 | Nyitott |
| E09 | Szerkesztői szabályok megerősítése (kategórialista, kötelező mezők) | Zoli | M1 review | A jelenlegi hat kategória és publikálási minimum a rögzített döntés |
| E10 | A demó elfogadási kritériumainak megerősítése | Zoli | M5 | Nyitott |

Amíg E06–E08 nyitott, a médiaadapter szintetikus, kifejezetten jelölt tesztadatot
használ. Ez nem bizonyít Ant Media-, GPU- vagy DRM-integrációt.

Az E01 hiánya miatt a full Compose profil elindítása és az image-digestek
rögzítése nem történt meg. A definíció és a konfigurációs validálás elkészült
(`docker compose --profile full config -q`), a futás M0-16b marad.
