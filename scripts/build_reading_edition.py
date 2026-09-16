from pathlib import Path
import re,json,hashlib,html
import pdfplumber
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,PageBreak,Image,Table,TableStyle,KeepTogether,CondPageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor,white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'sources/old_new_summary.hu.pdf'
pdf=pdfplumber.open(SRC)
blocks=[]
def add(kind,text='',pages=None,**kw):
 blocks.append(dict(kind=kind,text=text,pages=pages or [],**kw))
# Recover complete rows from the source's three narrow, multipage tables.
TABLES={
3:[['Komponens','Hibatípus','Helyreállási idő','Súlyosság'],['Fizikai szerver','Hardver','Órák - napok','KRITIKUS'],['Caddy','Folyamat','Percek (kézi újraindítás)','KRITIKUS'],['Django (egyetlen konténer)','Folyamat','Percek','KRITIKUS'],['PostgreSQL (nincs replika)','Folyamat + adat','Percek - órák','KRITIKUS'],['Keycloak','Folyamat','Percek (bejelentkezés lehetetlen)','KRITIKUS'],['Redis (nincs sentinel)','Folyamat + cache','Percek','MAGAS'],['PeerTube','Folyamat','Percek (nincs videó)','MAGAS'],['Celery Beat','Folyamat','Percek (nincsenek ütemezett taskok)','KÖZEPES']],
18:[['Group','Repók'],['core/','core (Nx: core-logic + core-ui-web + core-ui-native)'],['web/','tv2play · indaplay · cms (admin SPA)'],['native/','tv2play-tv (tvOS) · tv2play-mobile (React Native, PoC folyamatban)'],['backend/','backend (core-modules + tv2-api + inda-api) - R6: nyitott, ruling-ra vár'],['services/','playback-authorize (Go, D16)'],['contract/','openapi-types'],['Infra','már létezik, ~19 repo']],
25:[['Terület','Döntés'],['Kliens','TS + React, Capacitor (web/mobil/TV); tvOS react-native-tvos (PoC - P2 fallback, RN 84%)'],['Backend','NestJS (TS) modular monolith; Go csak a playback-authorize hot-pathre'],['DB','PostgreSQL 17 + CNPG, 3-instance HA'],['Async','NATS JetStream (egyetlen substrate)'],['Keresés','Meilisearch + DIY fan-out HA (2026-09-01: felülírta a korábbi ParadeDB-döntést)'],['DRM','Menedzselt multi-DRM (DRMaaS); Phase 1 AES-128, Phase 2 multi-DRM flag-gel'],['Média','On-prem Ant Media cluster, közös GPU pool'],['Identity','Authentik self-hosted'],['K8s','RKE2 (2026-09-02: felváltotta a Talos/K3s döntést - biztonsági kontroll-vesztés, D8-ban pótlás alatt), ArgoCD GitOps'],['Ingress','Traefik (2026-09-02: felváltotta NGINX Gateway Fabric-ot)'],['Edge','Cloudflare + saját Varnish VOD CDN'],['CI/CD','GitLab.com SaaS (2026-09-02: felváltotta a self-hosted GitLab CE-t; self-hosted runnerek maradnak)'],['Infra-szolgáltató','Invitech/One (VMware) (2026-09-02: felváltotta a Hetzner-feltevést)']]}
ends={3:9,18:24,25:41}
raw_lines=[]
for n,page in enumerate(pdf.pages,1):
 tables=[t for t in page.find_tables() if (3<=n<=9 or 18<=n<=41) and t.bbox[2]-t.bbox[0]<65]
 events=[]
 for l in page.extract_text_lines():
  if any(t.bbox[1]-1<=l['top']<=t.bbox[3]+1 and l['x0']<t.bbox[2]+2 for t in tables):continue
  events.append((l['top'],'line',l))
 for j,im in enumerate(page.images,1):events.append((im['top'],'image',f'sources/images/p{n:02}_{j}.png'))
 if n in TABLES:events.append((tables[0].bbox[1],'table',TABLES[n]))
 prev=None
 for top,kind,data in sorted(events,key=lambda x:x[0]):
  if kind in ['image','table']:
   add(kind,pages=list(range(n,ends[n]+1)) if kind=='table' else [n],**({'rows':data} if kind=='table' else {'path':data}))
   prev=None;continue
  l=data;t=l['text'];chars=[c for c in l['chars'] if c['text'].strip()]
  size=max(c['size'] for c in chars)
  allbold=all('Bold' in c['fontname'] for c in chars)
  raw_lines.append(t)
  if size>20:k='h1'
  elif size>=15:k='h2'
  elif size>=12:k='h3'
  elif allbold:k='label' if t in ['Problémák','Függőségek'] else 'h4'
  elif t.startswith('●'):k='bullet';t=t[1:].strip()
  elif size<9.5:k='caption'
  else:k='p'
  # Preserve paragraphs and bullet continuations, including across original page boundaries.
  canjoin=blocks and k in ['p','caption'] and blocks[-1]['kind'] in ['p','bullet','caption']
  if canjoin:
   gap=top-prev['bottom'] if prev else None
   canjoin=(gap is not None and gap<4.8) or (prev is None and n>1 and blocks[-1]['pages'][-1]==n-1)
   if blocks[-1]['kind']=='caption' and k!='caption':canjoin=False
  if k=='h1' and blocks and blocks[-1]['kind']=='h1':canjoin=True
  if canjoin:
   blocks[-1]['text']+=' '+t
   if n not in blocks[-1]['pages']:blocks[-1]['pages'].append(n)
  else:add(k,t,[n])
  prev=l
# Split long appendix entries into a component title, its role and a separate technology paragraph.
expanded=[]
for b in blocks:
 t=b['text']
 if b['kind']=='bullet' and b['pages'][0]>=42 and ' — ' in t:
  name,body=t.split(' — ',1)
  if len(name)<120:
   expanded.append(dict(b,kind='h4',text=name))
   role,*tech=body.split('Technológia:',1)
   expanded.append(dict(b,kind='p',text=role.strip()))
   if tech:expanded.append(dict(b,kind='p',text='Technológia: '+tech[0].strip()))
   continue
 expanded.append(b)
blocks=expanded
# Normalize typographical line-wrap debris only; no substantive audit correction.
for b in blocks:
 b['text']=b['text'].replace('Kéréseknként','Kérésenként')
# Build source-text coverage check, ignoring whitespace and typographical dash differences.
def norm(s):return re.sub(r'\s+','',s.replace('●','').replace('—','-').replace('–','-').replace('Kéréseknként','Kérésenként'))
a=norm(''.join(raw_lines));z=norm(''.join(b['text'] for b in blocks))

assert a.replace('-','')==z.replace('-',''), 'Non-table source-text coverage mismatch'
(ROOT/'sources/reading_blocks.json').write_text(json.dumps(blocks,ensure_ascii=False,indent=2))

intro=[]
def g(k,t='',**kw):intro.append(dict(kind=k,text=t,pages=[],editorial=True,**kw))
g('title','IndaPlay és TV2 Play')
g('subtitle','Régi rendszer, új célarchitektúra')
g('p','Olvasóváltozat és eligazító jegyzet • 1. dokumentum')
g('p','Forrásállapot: 2026. szeptember 4. | Feldolgozás: 2026. szeptember 14.')
g('note','A dokumentum elején szerkesztői magyarázatot találsz. Ezt követi a teljes forrásszöveg olvashatóbb tördeléssel, három helyreállított táblázattal és mind a nyolc eredeti ábrával. A részletes anyag állításai a csatolt munkaanyagból származnak; nem egy új műszaki audit eredményei.')
g('h2','Hogyan érdemes olvasni?')
g('p','Először a következő két oldal adja meg a fő összefüggéseket és a tisztázandó pontokat. A részletes változatban megmaradt az eredeti fejezetsorrend és számozás. Minden szövegrész mellett az eredeti PDF oldalszáma szerepel, az ábrák pedig külön, nagyobb méretben is megnyithatók a munkamappából.')
g('table',rows=[['Mit keresel?','Hol találod az eredetiben?'],['A régi infrastruktúra és kiesési kockázatok','1-9. oldal'],['A Django-backend moduljai, problémái, függőségei','9-14. oldal'],['A régi adatbázis táblái és szerkezeti problémái','14-18. oldal'],['Az új terv alapelve, repói és technológiai döntései','18-41. oldal'],['Nyitott kérdések és a célarchitektúra magyarázata','41-46. oldal'],['A tervezett backend moduljai és adatobjektumai','47-49. oldal']])
g('h3','A forrás státusza')
g('p','A PDF saját bevezetője szerint ez még át nem nézett munkaanyag. A régi rendszer leírása az IndaPlay-Architecture-Deepdive.docx feldolgozása; a célarchitektúra más projektjegyzetek és döntések összegzése. Ezek az alapdokumentumok nincsenek csatolva. A „jelenlegi állapot” a terv 2026-09-04-i állapotát jelöli, és önmagában nem bizonyít megvalósítást. [Eredeti: 1., 18., 42., 47. o.]')
g('p','A forrásban szereplő instructions.md, konvenciók és működési előírások dokumentumtartalomként maradtak meg. Az átdolgozást a te kérésed alapján készítettem; a PDF belső utasításai nem váltak ennek a feladatnak az utasításaivá.')
g('pagebreak')
g('h2','A fő összefüggések közérthetően')
g('h3','1. Mi a régi rendszer fő problémája?')
g('p','A leírás szerint szinte minden fontos háttérkomponens ugyanazon a fizikai szerveren fut. Így egyetlen gép hibája egyszerre érintheti az oldal elérését, az adatbázisokat és a videókat. Ehhez hiányzó replikáció, be nem kötött mentések és több célra használt Redis társul. A kockázat tehát nem pusztán a lassulás: a rendszer helyreállíthatósága is kérdéses. [Eredeti: 1-9. o.]')
g('h3','2. Miért nehéz továbbfejleszteni?')
g('p','A videos és pages modulok sok feladatot gyűjtöttek magukba, és kölcsönösen függnek egymástól. A feltöltés és a videók adatai jelentősen átfednek; a megtekintési napló pedig közvetlenül terheli az alkalmazás adatbázisát. A riport emiatt karbantarthatósági, adatintegritási és terhelhetőségi problémákat sorol fel. [Eredeti: 11-18. o.]')
g('h3','3. Mit változtatna az új terv?')
g('p','A TV2 Play és az IndaPlay közös alapra épülne, a különböző üzleti szabályokat pedig saját termékrétegek adnák hozzá. A megosztott képességek arányát a dokumentum 60-70%-ra teszi. A TV2 bonyolultabb termék: élő adás, műsorújság, több előfizetési szint, DRM és többféle kliens tartozik hozzá. Az Inda egyszerűbb, webes termékként szerepel, közösségi, csatorna- és podcastfunkciókkal. [Eredeti: 18., 24., 43-44., 49. o.]')
g('h3','4. Miért van külön a lejátszás engedélyezése?')
g('p','A playback-authorize minden lejátszásindításnál gyors választ adna. A terv szerint a termék üzleti szabályai alapján előzetesen létrehozott jogosultságokat olvassa a Valkey gyorsítótárból. A tartós alapadat PostgreSQL-ben van, a változás NATS-eseményen keresztül frissíti a cache-t, a döntésnapló ClickHouse-ba kerül. Ez a rész Go nyelven készülne; a többi backend NestJS-alapú. Az egymillió egyidejű néző célérték, nem igazolt mérési eredmény. [Eredeti: 44., 48-49. o.]')
g('h3','5. Mit érdemes különválasztani?')
g('bullet','Azonosítás: ki a felhasználó? A tervben ezt az Authentik támogatja.')
g('bullet','Jogosultság: mit nézhet meg? Ezt a saját backend szabályai és a playback-authorize kezelik.')
g('bullet','DRM: hogyan kap a kliens hozzáférést a védett tartalom kulcsához? Ehhez külső, menedzselt multi-DRM szolgáltatót terveznek. A szolgáltatójelöltek felsorolása nem jelent lezárt beszerzést. [Eredeti: 44-45., 48-49. o.]')
g('pagebreak')
g('h2','Nyitott kérdések és olvasási kapaszkodók')
g('h3','A forrás által nyitva hagyott kérdések')
g('bullet','R6: pontosan hány repóra bontsák a backend/ csoportot? Az egy repós javaslat döntésre vár. [18-24., 41. o.]')
g('bullet','Az RKE2-re váltás után hogyan pótolják a korábbi Talos-megoldás biztonsági kontrolljait? A D8-ban folyamatban szerepel. [34-36., 41., 46. o.]')
g('bullet','Hogyan egyeztethető össze a GitLab.com használata a projekt EU-adatrezidencia-keretével? A dokumentum ezt tisztázandóként kezeli. [42., 46. o.]')
g('bullet','A keresés redundáns indexelője, a célrendszerenként elkülönített seed-fájlok és a main ágba történő összevonás döntése is nyitott. [42. o.]')
g('h3','Szerkesztői jelzések: a forrás nem mindenütt egységes')
g('bullet','A core-modules a 44. oldalon verziózott, importált csomagként jelenik meg; a 47. oldal négy önállóan telepíthető egység közé sorolja. A könyvtár, a repó és a futó szolgáltatás határa ezért tisztázandó.')
g('bullet','A kliens-technológiák táblázata a tvOS mellett említi a P2 fallback/RN 84% megjegyzést; a 43. oldal részletes szövege ezt a mobilos React Native alternatívához köti. A két leírást változatlan tartalommal megőriztem. [25-26., 43. o.]')
g('bullet','A 9 Django-appként összegzett rendszer felsorolásában több név szerepel, a 35 táblásként leírt adatbázishoz pedig nincs teljes, 35 elemű tételes lista. Ezek a számok a riport állításai; a hiányzó elemeket nem egészítettem ki találgatással. [9-18. o.]')
g('bullet','A notifications modul leírása email-értesítéseket, a VideoUploadNotification tábláé push-értesítési sort említ. A pontos csatornakiosztás ebből nem dönthető el. [13., 16. o.]')
g('p','A technológiák működéséről, licenceiről, biztonságáról és teljesítményéről szóló megállapításokat is a forrás állításaiként érdemes olvasni. Ezeket ez a tartalommegőrző átdolgozás nem ellenőrzi külső dokumentáció vagy a tényleges kódbázis alapján.')
g('h3','Rövid fogalomtár a dokumentum olvasásához')
g('table',rows=[['Kifejezés','Jelentése ebben az anyagban'],['SPOF / HA','Egyetlen hibapont / magas rendelkezésre állás, redundanciával.'],['Core / port / adapter','Közös alap / a bővítés kijelölt kapcsolódási felülete / a termék saját megvalósítása.'],['Repo / csomag / deployable','Kódtároló / verziózottan importálható kód / külön telepíthető futó egység.'],['Hot path / cache','Nagyon gyakran futó, gyors választ igénylő útvonal / gyorsítótár.'],['Entitlement / paywall','Tartalomhoz való jogosultság / a hozzáférési és előfizetési szintek szabályozása.'],['PoC / fallback','Megvalósíthatósági próba / tartalék megoldás, ha az elsődleges út nem megfelelő.']])
g('pagebreak')
g('h2','Teljes, helyreállított dokumentum')
g('note','Az alábbi rész a forrás teljes szövegtartalmát őrzi meg. A bekezdések és listák tördelése rendezett, a hosszú komponensleírások külön címet és technológiai bekezdést kaptak. A három hibás táblázat celláit az eredeti PDF-ből állítottam helyre. Az eredeti állításokat, minősítéseket, becsléseket és belső hivatkozásokat nem írtam felül.')
# Captions, source pages and block IDs make retrieval deterministic.
for i,b in enumerate(blocks,1):b['id']=f'DOC01-{i:03d}'
allblocks=intro+blocks
# Additional image-only labels made searchable, while the original images remain authoritative.
image_notes={
'p01_1.png':'Régi topológia: frontend_indaplay (Next.js), mobile_indaplay, frontend_accessible; Caddy; backend_indaplay; PostgreSQL x4; Redis; PeerTube; OAuth, mail, ads, analytics, push integrációk.',
'p10_1.png':'Régi modultérkép: core, filters, healthcheck, videos, pages, API router, users, profiles, ads, notifications, feeds, translations; Celery worker; külső integrációk. A képen az API routernél 17 endpoints szerepel; a szöveg 17 router.register()-hívást és 5 nyers útvonalat említ.',
'p14_1.png':'Channel-család: Category, Channel (önhivatkozó parent), ContentUpload, ZoneCodes, VideoChannelMonthlySize, Video.',
'p14_2.png':'Video-család: Subtitles, WeeklyVideoViews, VideoAdsConfig, PreviewStartTiming, VideoView, VideoUploadNotification.',
'p15_1.png':'User-család: UserDetail, Like, Playback, SavedVideo, Subscription, VideoProgress, Interest.',
'p15_2.png':'CMS-kapcsolatok az ábrán: Layout → Component → ContentFilter → Channel.',
'p42_1.png':'Célarchitektúra-ábra: Cloudflare, Varnish VOD CDN, Traefik; tv2play, tv2play-tv, tv2play-mobile, indaplay, cms; core-ui; openapi-types; core-modules; tv2-api, inda-api; playback-authorize; PostgreSQL 17/CNPG, NATS JetStream, Meilisearch, Valkey 8; Authentik, multi-DRM, Ant Media; RKE2, ArgoCD, Calico, Longhorn/CNPG, GitLab.com, Harbor, Invitech/One. scope:tv2 és scope:inda termékhatárok.',
'p47_1.png':'A modultérkép adatobjektumai: Identity: user_account. Profil: profile, user_consent, dsr_request, dsa_report. Eszközök: device, push_token. User-library: follow, saved_item, playlist (+item), playback_preference. Catalog/CMS: content_item (+5 subtype), article_block, media_asset (+subtitle/marker), image_asset, url_redirect, genre/tag/person, page/ribbon (+item). Entitlement: entitlement_grant, watch_progress. Billing: plan, subscription, payment (+method), invoice_profile, coupon (+redemption). Notification: notification, notification_pref. Reklám: ad_rule; a keresésnek nincs saját táblája, index a content_item felett. TV2 EPG: broadcast_channel, epg_program (+broadcast), epg_reminder, live_event. Kábel-Premium: premium_provider, provider_link, voucher. Inda-csatorna: content_channel, channel_assignment. Community: comment, content_like, dsa_report_comment. Podcast: podcast, podcast_episode. A portoknak és szabályadaptereknek nincs saját táblájuk; a playback-authorize Valkey-ből olvas, ClickHouse-ba auditál. K15: minden domain-esemény ugyanabban a tranzakcióban ír az outbox-táblába, ezt NATS relay, majd a fogyasztó modulok feldolgozása követi. K14: session/token/pairing-kód a Valkey/NATS KV-ban; keresés a Meilisearch-ben; nézettség/mérés a ClickHouse-ban, ezek nem PostgreSQL-táblaként modellezve. Az ML-ajánló induláskor editorial/trending; később pgvector.'}
for b in blocks:
 if b['kind']=='image':b['search_text']=image_notes[Path(b['path']).name]

transcript=[
['Modul az eredeti 47. oldal ábráján','Adatobjektumok / ábrán jelzett tartalom'],
['Identity & Access','user_account'],
['Profil & Compliance','profile, user_consent, dsr_request, dsa_report'],
['Eszközök & Push','device, push_token'],
['User-library','follow, saved_item, playlist (+item), playback_preference'],
['Content Catalog / CMS','content_item (+5 subtype), article_block, media_asset (+subtitle/marker), image_asset, url_redirect, genre/tag/person, page/ribbon (+item)'],
['Entitlement-keret & Progress','entitlement_grant, watch_progress'],
['Subscription & Billing','plan, subscription, payment (+method), invoice_profile, coupon (+redemption)'],
['Notification','notification, notification_pref'],
['Ad-manager keret & Search','ad_rule; a keresésnek nincs saját táblája, index a content_item felett'],
['TV2: MultiTierPaywall','PaywallPort; nincs saját tábla; az entitlement_grant scope-ját értelmezi: Free/Zero/Premium'],
['TV2: entitlement-adapter','EntitlementPolicy; nincs saját tábla; kábeles Premium jog-szabály'],
['TV2: ML-RecommenderAdapter','RecommenderPort; nincs saját tábla; launch: editorial/trending, később pgvector'],
['TV2: EPG / Live','broadcast_channel, epg_program (+broadcast), epg_reminder, live_event'],
['TV2: Kábel-Premium','premium_provider, provider_link, voucher'],
['Inda: SimplePremium','PaywallPort; nincs saját tábla, nincs DRM, egyszerű előfizetés-jog'],
['Inda: entitlement-adapter','EntitlementPolicy; nincs saját tábla'],
['Inda: Csatorna-rendszer','content_channel, channel_assignment'],
['Inda: Community','comment, content_like, dsa_report_comment'],
['Inda: Podcast','podcast, podcast_episode'],
['playback-authorize','Nincs saját PostgreSQL-tábla; Valkey-cache olvasás, ClickHouse audit-írás; D9 1M-spike, D16, K6']]
allblocks += [dict(kind='pagebreak',text='',pages=[]),dict(kind='h2',text='Olvasási segédlet a sűrű backend-ábrához',pages=[]),dict(kind='note',text='Szerkesztői átírás az eredeti PDF 47. oldalának ábrájából. A kis betűs adatobjektumok itt kereshető és olvasható formában is szerepelnek. Az eredeti ábrát a teljes dokumentum részeként változatlanul megőriztem.',pages=[]),dict(kind='table',text='',rows=transcript,pages=[]),dict(kind='p',text='Portok: EntitlementPolicy, PaywallPort, RecommenderPort, AdTargetingPort. A termékadapterek töltik ki őket; nincs saját adatobjektumuk, a core táblái felett értelmezik a szabályokat.',pages=[]),dict(kind='p',text='K15 az ábrán: minden domain-esemény ugyanabban a tranzakcióban ír az outbox-táblába; ezt a NATS relay, majd a fogyasztó modulok feldolgozása követi. Példák: entitlement-cache frissítése, értesítés.',pages=[]),dict(kind='p',text='K14 az ábrán: session/token/pairing-kód a Valkey/NATS KV-ban; keresés a Meilisearch-ben, a content_item feletti indexszel; nézettség/mérés a ClickHouse-ban. Ezek nem PostgreSQL-táblaként modellezett adatok.',pages=[]),dict(kind='p',text='A másik, 42. oldali célarchitektúra-ábra kiegészítő feliratai: scope:tv2 és scope:inda termékhatárok; a platformrétegben Longhorn/CNPG is szerepel. Mindkét összefoglaló ábra a 2026-09-04-i tervet mutatja; nem formális C4/ERD.',pages=[])]

# Fonts with Hungarian coverage.
fontdir=Path('/System/Library/Fonts/Supplemental')
for name,file in [('Body','Arial.ttf'),('Body-Bold','Arial Bold.ttf'),('Body-Italic','Arial Italic.ttf')]:pdfmetrics.registerFont(TTFont(name,str(fontdir/file)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Body-Bold',italic='Body-Italic',boldItalic='Body-Bold')
styles={}
base=dict(fontName='Body',fontSize=10.2,leading=14.8,textColor=HexColor('#243547'),spaceAfter=7)
for k in ['p','bullet','note','caption','label','h1','h2','h3','h4','title','subtitle','ref']:
 opts=base.copy()
 if k=='bullet':opts.update(leftIndent=12,firstLineIndent=-8,spaceAfter=5)
 if k in ['h1','h2','h3','h4','label','title','subtitle']:
  opts.update(fontName='Body-Bold',keepWithNext=True,spaceBefore=13,spaceAfter=6)
  opts['fontSize']={'title':29,'subtitle':19,'h1':20,'h2':16,'h3':12.5,'h4':11,'label':10.2}[k];opts['leading']=opts['fontSize']*1.22
  opts['textColor']=HexColor('#124d64')
 if k=='note':opts.update(backColor=HexColor('#edf4f6'),borderPadding=10,spaceBefore=7,spaceAfter=14,fontSize=9.5,leading=14)
 if k in ['caption','ref']:opts.update(fontSize=8,leading=11,textColor=HexColor('#627387'),spaceAfter=6)
 styles[k]=ParagraphStyle(k,**opts)
styles['ref'].keepWithNext=True
styles['cell']=ParagraphStyle('cell',fontName='Body',fontSize=9,leading=12.4,textColor=HexColor('#243547'))
styles['cellhead']=ParagraphStyle('cellhead',parent=styles['cell'],fontName='Body-Bold',textColor=white)
def esc(t):return html.escape(t.replace('—','-').replace('–','-').replace('\u2011','-').replace('`',''))
def ref(pages):
 if not pages:return ''
 return f'Eredeti PDF: {pages[0]}. o.' if len(pages)==1 else f'Eredeti PDF: {pages[0]}-{pages[-1]}. o.'
class Doc(SimpleDocTemplate):
 def afterFlowable(self,f):
  if hasattr(f,'bookmark'):
   self.canv.bookmarkPage(f.bookmark)
   self.canv.addOutlineEntry(f.getPlainText(),f.bookmark,level=0,closed=False)
class Pages(canvas.Canvas):
 def __init__(self,*a,**kw):super().__init__(*a,**kw);self.saved=[]
 def showPage(self):self.saved.append(dict(self.__dict__));self._startPage()
 def save(self):
  count=len(self.saved)
  for state in self.saved:
   self.__dict__.update(state);self.setStrokeColor(HexColor('#dae3e9'));self.line(45,39,550,39)
   self.setFillColor(HexColor('#627387'));self.setFont('Body',8)
   self.drawString(45,26,'DOC01 • IndaPlay / TV2 Play • Olvasóváltozat')
   self.drawRightString(550,26,f'{self._pageNumber} / {count}')
   super().showPage()
  super().save()
story=[];md=[];lastref=None
for idx,b in enumerate(allblocks):
 k=b['kind'];t=b['text'];r=ref(b['pages'])
 if k=='h2' and (t.startswith('Célarchitektúra') or t.startswith('Melléklet')):story.append(PageBreak())
 if k=='pagebreak':story.append(PageBreak());continue
 if b.get('id'):md.append(f'<a id="{b["id"]}"></a>')
 if r and r!=lastref:
  story.append(Paragraph(esc(r),styles['ref']));md.append(f'*{r}*');lastref=r
 if k=='table':
  rows=b['rows'];w=([310,195] if rows[0][0]=='Mit keresel?' else [125,380]) if len(rows[0])==2 else [142,86,190,87]
  data=[[Paragraph(esc(c),styles['cellhead'] if j==0 else styles['cell']) for c in row] for j,row in enumerate(rows)]
  table=Table(data,colWidths=w,repeatRows=1,hAlign='LEFT')
  table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#124d64')),('ROWBACKGROUNDS',(0,1),(-1,-1),[HexColor('#f0f5f7'),white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.3,HexColor('#d6e0e6'))]))
  story.extend([table,Spacer(1,10)])
  md.append('\n'.join(['| '+' | '.join(rows[0])+' |','| '+' | '.join(['---']*len(rows[0]))+' |']+['| '+' | '.join(row)+' |' for row in rows[1:]]));continue
 if k=='image':
  path=ROOT/b['path'];iw,ih=ImageReader(str(path)).getSize();scale=min(505/iw,490/ih)
  story.append(Image(str(path),width=iw*scale,height=ih*scale));story.append(Spacer(1,8))
  md.append(f'![Eredeti ábra - {r}]({path})')
  continue
 if not t:continue
 text=esc(t)
 if k=='bullet':text='• '+text
 if k=='label':text='<b>'+text+'</b>'
 # Small headings and paragraphs are separate blocks, so long appendix bullets are navigable.
 para=Paragraph(text,styles[k])
 if k in ['h1','h2','title']:para.bookmark=f'heading-{idx}'
 story.append(para)
 prefix={'title':'# ','subtitle':'## ','h1':'# ','h2':'## ','h3':'### ','h4':'#### ','bullet':'- ','note':'> '}.get(k,'')
 md.append(prefix+t if k!='label' else '**'+t+'**')
output=ROOT/'output/pdf/indaplay_tv2_olvasovaltozat.hu.pdf'
Doc(str(output),pagesize=(595.28,841.89),leftMargin=45,rightMargin=45,topMargin=43,bottomMargin=51,title='IndaPlay és TV2 Play - teljes olvasóváltozat',author='Szerkesztett változat a csatolt dokumentum alapján').build(story,canvasmaker=Pages)
(ROOT/'output/notes/indaplay_tv2_olvasovaltozat.hu.md').write_text('\n\n'.join(md)+'\n')
# Source-linked local retrieval corpus (no claim of an installed embedding/search service).
with (ROOT/'sources/doc01_chunks.jsonl').open('w') as f:
 section='Bevezető'
 for b in blocks:
  if b['kind'] in ['h1','h2','h3','h4']:section=b['text']
  text=b.get('search_text') or ('\n'.join(' | '.join(r) for r in b['rows']) if b['kind']=='table' else b['text'])
  row=dict(id=b['id'],source='old_new_summary.hu.pdf',pages=b['pages'],section=section,kind=b['kind'],text=text)
  if b['kind']=='image':row['image']=b['path'];row['note']='Kép szöveges keresőleírása; pontos vizuális tartalom az eredeti képen.'
  f.write(json.dumps(row,ensure_ascii=False)+'\n')
report={'source_pages':len(pdf.pages),'source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'non_table_text_coverage_after_whitespace_and_structural_dash_normalization':a.replace('-','')==z.replace('-',''),'restored_tables':3,'preserved_images':sum(b['kind']=='image' for b in blocks),'source_blocks':len(blocks),'original_text_characters_normalized':len(a)}
(ROOT/'sources/processing_report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
print(report)
print(output)
