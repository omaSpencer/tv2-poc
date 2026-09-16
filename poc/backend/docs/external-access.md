# Külső előfeltételek jegyzéke – M0-19

2026-09-15 · Amit nem lehet kitalálni, csak megkapni. A hiányzó hozzáférés az
érintett fázist blokkolja, az M0 core kaput nem.

| # | Előfeltétel | Felelős | Célfázis | Állapot |
| --- | --- | --- | --- | --- |
| E01 | Konténerregiszter-elérés az image-ek húzásához és digest rögzítéséhez | Zoli | M0-16b | Hiányzik a jelen munkakörnyezetben; a `VERSIONS.md` digest sorai emiatt nyitottak |
| E02 | Authentik tesztpéldány vagy futtatható helyi Authentik, admin hozzáféréssel | Claude (beállítás), Zoli (hozzáférés) | M2 | Nyitott; blueprint + Compose mount és a strict CLI/SPA/post-logout redirect lista kész (`authentik/blueprints/poc.yaml`), image húzás E01-től függ |
| E03 | Tényleges OIDC issuer, audience, JWKS URI és egy kiadott teszttoken | Claude | M2 | Nyitott; L1 mock JWKS kész; L2 discovery a blueprint szerinti `…/application/o/poc-backend/` |
| E04 | Három tesztidentitás (viewer, editor, publisher) és a csoport→jog leképezés | Zoli | M2 | Blueprint létrehozza a `poc-*` usereket/csoportokat; `ROLE_GROUPS` bekötve; L2 login pending |
| E05 | Token- és refresh-élettartam tényleges providerbeállítása | Claude | M2 | Blueprint: 5 perc / 1 óra; mérés (M2-T21) pending |
| E06 | Ant Media tesztkörnyezet, asset- és broadcast-azonosítók | Zoli | M6 | Nyitott |
| E07 | DRMaaS sandbox, kulcs- és licencszolgáltatás, kompatibilis player | Zoli | M6 | Nyitott |
| E08 | Valós üzleti entitlement-szabályok a playback-authorize szerződéshez | Zoli | M6 | Nyitott |
| E09 | Szerkesztői szabályok megerősítése (kategórialista, kötelező mezők) | Zoli | M1 review | A jelenlegi hat kategória és publikálási minimum a rögzített döntés |
| E10 | A demó elfogadási kritériumainak megerősítése | Zoli | M5 | Nyitott |

Amíg E06–E08 nyitott, a médiaadapter szintetikus, kifejezetten jelölt tesztadatot
használ. Ez nem bizonyít Ant Media-, GPU- vagy DRM-integrációt.

Az E02–E05 tervezett kezelése a [M2 implementációs tervben](../../M2-IMPLEMENTATION.md) van: az
Authentik-független tokenellenőrzési próbák (L1) külső hozzáférés nélkül is futnak,
a valódi tokenes kapu (L2) viszont nem helyettesíthető, és hiányában pendingként
jelölendő, nem sikerként.

Az E01 hiánya miatt az image-digestek továbbra is nyitottak. Az M3 próbák
Compose NATS-szal vagy külső `NATS_URL` / `SMOKE_EXTERNAL_NATS_URL` mellett
futtathatók; mock brokerrel M3 nem zárható.
