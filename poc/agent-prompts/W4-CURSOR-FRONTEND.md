# W4 Cursor feladatlap – FE-F4 UX, accessibility és navigáció

Te vagy a Wave 4 frontend implementáló agentje. A kijelölt worktree és branch:

- worktree: `/private/tmp/tv2-poc-fe-f4`
- branch: `codex/final-fe-f4`
- baseline: a W3 integrációs kapuját lezáró tiszta `main`, commit `98dc729`;
  ne merge-elj és ne rebase-elj

## Kizárólagos scope

Zárd le a `poc/FINAL-FRONTEND-MILESTONE.md` FE-F4 fázisát: **L12, L13, I1,
I5**. Frontend production forrás, frontend teszt/E2E,
`poc/frontend/README.md`, `poc/FINAL-FRONTEND-EVIDENCE.md`, valamint kizárólag
az FE-F4 checklist a `poc/FINAL-FRONTEND-MILESTONE.md` fájlban módosítható.
Backend, OpenAPI snapshot, generated contract, dependency-verzió, Compose,
koordinációs dokumentum és milestone-összesítés nem módosítható.

## Rögzített termékdöntés

A jelenlegi PoC és az ebből készülő belső operátori felület **magyar-only**.
Ebben a fázisban nem vezetünk be i18n runtime-ot vagy fordítási kulcsrendszert.
Minden felhasználói mondat, akció, üres/hibaállapot és accessibility label
magyar. Technikai azonosítók és szabványos rövidítések – például UUID, HTTP,
correlation ID, audit/event code és role/permission code – változatlanul
megjelenhetnek, de a körülöttük lévő magyarázó label magyar legyen. Az
`<html lang="hu">` marad az igazságforrás.

## Kötelező megoldási szerződés

1. **L12 – bezárható, szüneteltethető értesítések**
   - Minden toast kapjon billentyűzettel elérhető, magyar nevű bezárás gombot.
     Megjelenéskor ne kapjon automatikusan fókuszt és ne mozgassa el a felhasználó
     aktuális fókuszát.
   - Sikeres értesítés alapból 5 másodperc után eltűnhet. Error értesítés legyen
     perzisztens kézi bezárásig; ne veszítsen hibát vak automatikus timeout miatt.
   - A sikeres toast visszaszámlálása hover és a toaston belüli keyboard focus
     alatt álljon meg, majd a hátralévő idővel folytatódjon. Minden timer és
     listener cleanupja legyen determinisztikus; unmount után ne írjon state-et.
   - A live-region szerződés ne duplázza a bejelentést: success `polite`, error
     `assertive`/alert szemantikával, értelmes atomikussággal. A bezáró gomb
     neve önmagában is érthető legyen.
2. **L13 – saját 404 route**
   - A wildcard route ne redirecteljen. Az `AppShell`-en belül magyar „Az oldal
     nem található” nézet jelenjen meg a kért út visszhangozása nélkül.
   - Legyen főoldal-link és biztonságos „Vissza” akció. A vissza csak ismert,
     alkalmazáson belüli history entryre léphet; közvetlen deep linknél a
     főoldalra menjen, ne küldje a felhasználót ismeretlen külső originre.
   - Router/component teszt fedje a deep linket, shell-megőrzést, főoldal-linket,
     belső visszalépést és fallbacket.
3. **I1 – stabil dirty-navigation adapter**
   - Az `unstable_usePrompt` közvetlen importja szűnjön meg. Az aktuális, pinelt
     React Router stabil `useBlocker` API-jára épülő egyetlen adapter tulajdonolja
     a belső route-váltás blokkolását és annak magyar megerősítő szövegét,
     továbbá a `beforeunload` regisztrációt. A tab/window bezárásakor a böngésző
     natív, saját lokalizált promptját csak `preventDefault`/`returnValue`
     jelzéssel kérjük; annak szövegét az alkalmazás nem állítja és nem teszteli.
   - Dirty állapotban confirm → proceed pontosan egyszer, cancel → reset és az
     oldalon maradás; tiszta állapotban nincs prompt. Mentés utáni redirect és a
     lap saját explicit „mégse/vissza” akciója ugyanazt a policyt kövesse, ne
     jelenjen meg kettős confirm.
   - Contract teszt kontrollált routerrel fedje a belső linket, browser backet,
     cancel/confirm ágakat és clean transitiont. A `beforeunload` teszt az
     attach/detachot, valamint dirty állapotban a natív promptot kérő
     `defaultPrevented`/`returnValue` viselkedést ellenőrizze, nem a copyt.
4. **I5 – magyar-only UI konzisztencia**
   - Dokumentáld a döntést a frontend README-ben: támogatott nyelv, technikai
     tokenek kivétele és az a feltétel, amely később valódi i18n projektet indít.
   - Végezz inventoryt minden routolt oldal, shell, hiba/üres állapot, toast,
     dialog és accessibility label felhasználói szövegén. Fordítsd magyarra az
     angol termékszöveget; nyers backend state/code csak magyar labellel vagy
     ismert view-model leképezéssel jelenhet meg.
   - A teszt-fixture szövege nem termékcopy, de a production komponensbe kerülő
     fallback ne szivárogtasson angol exception message-et pusztán a nyelvi
     egységesítés kedvéért. A már rögzített biztonsági hiba-megjelenítést őrizd
     meg.

## Tesztek és kapuk

- Notification fake clock: success timeout, hover/focus pause-resume a maradék
  idővel, error perzisztencia, egér/billentyűzetes bezárás, timer cleanup és
  fókuszmegőrzés.
- Component szemantikai teszt: toast live-region és close button, valamint 404
  heading/link/button. A meglévő Playwright `@axe-core/playwright`
  accessibility spec bővítése ne találjon új violationt; új axe dependency nem
  része a feladatnak.
- Router contract: ismeretlen deep link, belső back/fallback, dirty belső
  navigáció, browser back, confirm/cancel és `beforeunload`.
- Nyelvi smoke a kritikus route-okra; technikai tokenek megengedettek, angol
  felhasználói mondat vagy akció nem.
- `npm run verify`, `npm run e2e:typecheck` és a releváns Playwright
  accessibility/navigációs szelet Node 24.20.0-n.

## Evidence, review és átadás

- Jelöld készre kizárólag a négy FE-F4 ID-t és a ténylegesen teljesült kapukat;
  evidence-ben legyenek pontos tesztszámok és timer/focus invariánsok.
- Egy review-zható commit vagy világosan indokolt, kis commitsor; ne merge-elj,
  ne rebase-elj és ne pusholj.
- Átadás: branch, commit SHA, ID-k, fájlok/viselkedés,
  parancsok/eredmények, nem futtatott kapuk, kockázat és explicit
  scope-nyilatkozat.
- Az FE-F4 átadása után Cursor read-only review-t kap a Codex BE-F4 commitjára.
  Backend találatot ne javíts ezen a frontend ágon; add vissza Codexnek
  fájl/sor, súlyosság és reprodukció megadásával.
