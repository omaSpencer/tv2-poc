import { scenarioDefinitionSchema } from './schema';
import { SCENARIO_VERSION, type ScenarioDefinition } from './types';

const definitions = [
  {
    id: 'S01', version: SCENARIO_VERSION,
    title: 'Kiadói életciklus',
    description: 'Új, egyedi tartalom teljes piszkozat → publikált → visszavont → publikált életciklusa, katalógus-, kereső- és auditbizonyítással.',
    requiredPermissions: ['content:read', 'content:write', 'content:publish'],
    preflight: { authenticated: true, backendReady: true, searchEnabled: true },
    steps: [
      { id: 'create', title: 'Piszkozat létrehozása', detail: 'Az adott futáshoz tartozó új tartalom.', mode: 'automatic', operation: 'content.create-complete', expected: [{ kind: 'http', status: 201 }, { kind: 'content', status: 'draft', version: 1 }] },
      { id: 'edit', title: 'Piszkozat szerkesztése', detail: 'Összefoglaló és címkék módosítása.', mode: 'automatic', operation: 'content.edit', expected: [{ kind: 'http', status: 200 }, { kind: 'content', status: 'draft', version: 2 }] },
      { id: 'publish', title: 'Publikálás', detail: 'Optimista verzióval publikál.', mode: 'automatic', operation: 'content.publish', expected: [{ kind: 'http', status: 200 }, { kind: 'content', status: 'published', version: 3 }] },
      { id: 'admin-published', title: 'Admin visszaolvasás', detail: 'A publikált v3 állapot egzakt ellenőrzése.', mode: 'automatic', operation: 'content.admin-read', expected: [{ kind: 'content', status: 'published', version: 3 }] },
      { id: 'catalog-visible', title: 'Katalógus láthatóság', detail: 'Csak olvasható lekérdezés a publikus projekcióra.', mode: 'automatic', operation: 'content.catalog-present', timeoutMs: 30_000, expected: [{ kind: 'http', status: 200 }, { kind: 'catalog', present: true }] },
      { id: 'search-visible', title: 'Keresési láthatóság', detail: 'Az egyedi tartalomazonosító megjelenik a találatokban.', mode: 'automatic', operation: 'content.search-present', timeoutMs: 30_000, expected: [{ kind: 'search', containsContent: true }] },
      { id: 'withdraw', title: 'Visszavonás', detail: 'A publikált tartalom visszavont állapotba kerül.', mode: 'automatic', operation: 'content.withdraw', expected: [{ kind: 'content', status: 'withdrawn', version: 4 }] },
      { id: 'catalog-hidden', title: 'Katalógusból eltűnt', detail: 'A publikus végpont egzakt 404-et ad.', mode: 'automatic', operation: 'content.catalog-absent', timeoutMs: 30_000, expected: [{ kind: 'problem', status: 404, code: 'content_not_found' }, { kind: 'catalog', present: false }] },
      { id: 'search-hidden', title: 'Keresésből eltűnt', detail: 'Csak olvasható lekérdezés, amíg nincs találat.', mode: 'automatic', operation: 'content.search-absent', timeoutMs: 30_000, expected: [{ kind: 'search', containsContent: false }] },
      { id: 'edit-withdrawn', title: 'Visszavont tartalom szerkesztése', detail: 'Új cím az újrapublikálás előtt.', mode: 'automatic', operation: 'content.edit-withdrawn', expected: [{ kind: 'content', status: 'withdrawn', version: 5 }] },
      { id: 'republish', title: 'Újrapublikálás', detail: 'A v5 tartalom ismét publikált lesz.', mode: 'automatic', operation: 'content.publish', expected: [{ kind: 'content', status: 'published', version: 6 }] },
      { id: 'catalog-visible-again', title: 'Újra látható', detail: 'Katalógus és új cím visszaellenőrzése.', mode: 'automatic', operation: 'content.catalog-present', timeoutMs: 30_000, expected: [{ kind: 'catalog', present: true }] },
      { id: 'search-visible-again', title: 'Újra kereshető', detail: 'A módosított címmel is megtalálható.', mode: 'automatic', operation: 'content.search-present', timeoutMs: 30_000, expected: [{ kind: 'search', containsContent: true }] },
      { id: 'audit', title: 'Audit lánc', detail: 'Az életciklus akcióinak és verzióinak ellenőrzése.', mode: 'automatic', operation: 'content.audit', expected: [{ kind: 'audit', sequence: [
        { action: 'published', version: 6 }, { action: 'updated', version: 5 }, { action: 'withdrawn', version: 4 },
        { action: 'published', version: 3 }, { action: 'updated', version: 2 }, { action: 'created', version: 1 },
      ] }] },
    ],
  },
  {
    id: 'S02', version: SCENARIO_VERSION,
    title: 'Negatív szerződések',
    description: 'Az öt legfontosabb hibaág egzakt HTTP-, hibakód-, mező- és verzióellenőrzése.',
    requiredPermissions: ['content:write', 'content:publish'],
    preflight: { authenticated: true, backendReady: true, searchEnabled: false },
    steps: [
      { id: 'create-incomplete', title: 'Hiányos piszkozat', detail: 'Médiaazonosító nélküli, egyedi piszkozat.', mode: 'automatic', operation: 'negative.create-incomplete', expected: [{ kind: 'http', status: 201 }] },
      { id: 'publish-incomplete', title: 'Hiányos publikálás', detail: 'Csak a dokumentált 422 fogadható el.', mode: 'automatic', operation: 'negative.publish-incomplete', expected: [{ kind: 'problem', status: 422, code: 'validation_failed', fields: ['mediaAssetId'] }] },
      { id: 'create-published', title: 'Publikált teszttartalom', detail: 'Külön tartalom a tiltott szerkesztéshez.', mode: 'automatic', operation: 'negative.create-published', expected: [{ kind: 'content', status: 'published', version: 2 }] },
      { id: 'patch-published', title: 'Publikált tartalom módosítása tiltott', detail: 'Egzakt 409 content_not_editable.', mode: 'automatic', operation: 'negative.patch-published', expected: [{ kind: 'problem', status: 409, code: 'content_not_editable' }] },
      { id: 'create-advanced', title: 'Verzió előreléptetése', detail: 'Külön piszkozat v2-re emelése.', mode: 'automatic', operation: 'negative.create-advanced', expected: [{ kind: 'content', status: 'draft', version: 2 }] },
      { id: 'patch-stale', title: 'Elavult verzió', detail: 'A v1 módosítás csak version_conflict hibát adhat.', mode: 'automatic', operation: 'negative.patch-stale', expected: [{ kind: 'problem', status: 409, code: 'version_conflict', versionRelation: 'expected-less-than-actual' }] },
      { id: 'invalid-payload', title: 'Érvénytelen kéréstörzs', detail: 'Rögzített, kódba zárt hibás tesztadat; nem szerkeszthető a felületről.', mode: 'automatic', operation: 'negative.invalid-payload', expected: [{ kind: 'problem', status: 422, code: 'validation_failed', fields: ['title'] }] },
      { id: 'oversized', title: 'Túlméretes kéréstörzs', detail: 'Rögzített, nem érzékeny 257 KiB-os tesztadat.', mode: 'automatic', operation: 'negative.oversized-payload', expected: [{ kind: 'problem', status: 413, code: 'payload_too_large' }] },
    ],
  },
  {
    id: 'S03', version: SCENARIO_VERSION,
    title: 'Jogosultsági mátrix',
    description: 'Kézi identitásváltásokkal ellenőrzi a viewer, editor és publisher szerepkörök határait. Az identitásváltás után külön megerősítés szükséges.',
    requiredPermissions: [], preflight: { authenticated: true, backendReady: true, searchEnabled: false },
    steps: [
      { id: 'viewer-login', title: 'Viewer szerepkör', detail: 'A futtató a /me végpont alapján ellenőriz.', mode: 'manual', operation: 'auth.me', instruction: 'Jelentkezz be viewer szerepkörrel, majd erősítsd meg az ellenőrzést.', expected: [{ kind: 'identity', roles: ['viewer'] }] },
      { id: 'viewer-forbidden', title: 'Viewer admin tiltás', detail: 'Az admin olvasás csak 403 forbidden hibát adhat.', mode: 'automatic', operation: 'permission.admin-read', expected: [{ kind: 'problem', status: 403, code: 'forbidden' }] },
      { id: 'editor-login', title: 'Editor szerepkör', detail: 'Kézi identitásváltás.', mode: 'manual', operation: 'auth.me', instruction: 'Válts editor szerepkörre. Ha az oldal újratöltődik, a futás biztonsági okból nem eldönthető lesz; indítsd újra ezt a forgatókönyvet editorként.', expected: [{ kind: 'identity', roles: ['editor'] }] },
      { id: 'editor-create', title: 'Az editor írhat', detail: 'Egyedi piszkozat létrehozása.', mode: 'automatic', operation: 'permission.create', expected: [{ kind: 'http', status: 201 }] },
      { id: 'editor-publish-forbidden', title: 'Az editor nem publikálhat', detail: 'Csak 403 forbidden hiba fogadható el.', mode: 'automatic', operation: 'permission.publish', expected: [{ kind: 'problem', status: 403, code: 'forbidden' }] },
      { id: 'publisher-login', title: 'Publisher szerepkör', detail: 'Kézi identitásváltás.', mode: 'manual', operation: 'auth.me', instruction: 'Válts publisher szerepkörre, majd erősítsd meg.', expected: [{ kind: 'identity', roles: ['publisher'] }] },
      { id: 'publisher-publish', title: 'A publisher publikálhat', detail: 'Az előző piszkozat publikálása.', mode: 'automatic', operation: 'permission.publish', expected: [{ kind: 'http', status: 200 }] },
      { id: 'missing-token', title: 'Hiányzó token', detail: 'A /me kifejezetten auth fejléc nélkül csak 401 lehet.', mode: 'automatic', operation: 'permission.missing-token', expected: [{ kind: 'problem', status: 401, code: 'unauthenticated' }] },
    ],
  },
  {
    id: 'S04', version: SCENARIO_VERSION,
    title: 'Kereső tartalék üzem és kiesés',
    description: 'Az A/B index kiesését kézi üzemeltetési pontokkal, a szolgáltatás állapotát engedélyezett, csak olvasható ellenőrzésekkel bizonyítja.',
    requiredPermissions: ['content:write', 'ops:read'], preflight: { authenticated: true, backendReady: false, searchEnabled: true },
    steps: [
      { id: 'normal', title: 'Normál állapot', detail: 'Mindkét index elérhető és forgalomképes.', mode: 'automatic', operation: 'outage.processing', expected: [{ kind: 'processing', routeEligible: 2, reachable: 2 }] },
      { id: 'stop-a', title: 'A index leállítása', detail: 'Külső, kézi hibainjektálás.', mode: 'manual', instruction: 'Állítsd le az A keresőindexet a dokumentált üzemeltetési leírás szerint. A futtató nem indít parancsértelmező parancsot.', expected: [] },
      { id: 'fallback-a', title: 'Tartalék B-re', detail: 'Pontosan egy index marad elérhető és forgalomképes.', mode: 'automatic', operation: 'outage.processing', expected: [{ kind: 'processing', routeEligible: 1, reachable: 1 }] },
      { id: 'search-a', title: 'Keresés tartalék üzemben', detail: 'A kereső végpont továbbra is 200.', mode: 'automatic', operation: 'outage.search', expected: [{ kind: 'http', status: 200 }] },
      { id: 'stop-b', title: 'B index leállítása', detail: 'Külső, kézi hibainjektálás.', mode: 'manual', instruction: 'Állítsd le a B indexet is. Mindkét index kiesése után folytasd.', expected: [] },
      { id: 'unavailable', title: 'Keresés nem elérhető', detail: 'Csak 503 search_unavailable fogadható el.', mode: 'automatic', operation: 'outage.search', expected: [{ kind: 'problem', status: 503, code: 'search_unavailable' }] },
      { id: 'cms-survives', title: 'A CMS-írás működik', detail: 'A kereső kiesése nem blokkolja a piszkozat létrehozását.', mode: 'automatic', operation: 'outage.cms-write', expected: [{ kind: 'http', status: 201 }] },
      { id: 'recover', title: 'Indexek visszaállítása', detail: 'Kézi helyreállítás.', mode: 'manual', instruction: 'Indítsd újra mindkét indexet, és várd meg a feldolgozó felzárkózását.', expected: [] },
      { id: 'normal-again', title: 'Helyreállt állapot', detail: 'Mindkét index ismét elérhető és forgalomképes.', mode: 'automatic', operation: 'outage.processing', timeoutMs: 60_000, expected: [{ kind: 'processing', routeEligible: 2, reachable: 2 }] },
    ],
  },
  {
    id: 'S05', version: SCENARIO_VERSION,
    title: 'M5 operátori műveletek',
    description: 'A dedikált operátori felületen végrehajtandó újraindexelés, karantén-visszajátszás és javítás ellenőrzőlistája; a futtató csak állapotot olvas.',
    requiredPermissions: ['ops:read', 'ops:write'], preflight: { authenticated: true, backendReady: true, searchEnabled: true },
    steps: [
      { id: 'reindex', title: 'A/B újraindexelés', detail: 'Előellenőrzés, megerősítés, párhuzamos futás tiltása és sikeres átváltás.', mode: 'manual', instruction: 'Nyisd meg az Operáció / Újraindexelés oldalt, futtasd végig a bizonyított folyamatot, majd erősítsd meg.', expected: [] },
      { id: 'quarantine', title: 'Karantén és visszajátszás', detail: 'Hibás elem, javított visszajátszás és feldolgozás.', mode: 'manual', instruction: 'Az Operáció / Karantén oldalon futtasd végig a visszajátszási folyamatot.', expected: [] },
      { id: 'repair', title: 'Javítás mindkét indexen', detail: 'Próbafutás, megerősítés és célindexenkénti bizonyíték.', mode: 'manual', instruction: 'Az Operáció / Javítás oldalon futtasd végig az A és B célindex javítását.', expected: [] },
      { id: 'processing', title: 'Végállapot', detail: 'Mindkét index forgalomképes és elérhető.', mode: 'automatic', operation: 'outage.processing', expected: [{ kind: 'processing', routeEligible: 2, reachable: 2 }] },
    ],
  },
] satisfies ScenarioDefinition[];

export const SCENARIOS: readonly ScenarioDefinition[] = definitions.map((definition) =>
  scenarioDefinitionSchema.parse(definition) as ScenarioDefinition,
);

export function getScenario(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
