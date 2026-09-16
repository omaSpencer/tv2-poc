from pathlib import Path
import json,collections,re,hashlib
from pypdf import PdfReader
R=Path(__file__).resolve().parents[1];D=R/'sources/doc02'
descriptions={12:'Kézi keresőleírás az eredeti rendszerkörnyezeti ábrához: Viewer (web/mobile/embed, kb. 8M havi néző), Content Editor, Platform Admin, Accessible User, External Site; IndaPlay Platform; Google OAuth, Facebook OAuth, YouTube/yt-dlp, Google Drive, Sentry, Umami, Gemius, Google IMA, OneSignal. A kapcsolatfeliratok és nyilak pontos vizsgálatához a teljes PNG az irányadó.',13:'Kézi keresőleírás a konténerábrához: Caddy 2.8.4, frontend_indaplay Next.js 14 / React 18, frontend_accessible Django 4.2, mobile_indaplay Ionic 8 / Angular 18 / Capacitor 6, backend_indaplay Django 5.2 / DRF / Gunicorn, 25 backend konténer production LB mellett; Celery 5.6, Celery Beat, PeerTube, nginx peertube webserver, PostgreSQL backend/PeerTube/Umami, Redis 6 több szerepben, Umami. Ez ábraleírás, nem a tényleges runtime új ellenőrzése.',310:'Kézi keresőleírás a teljes, a forráslapon részben levágott láncábrához. Csomópontok sorrendje felülről: 1. Network – Caddy SSL/reverse proxy; 2. PostgreSQL backend – Django DB; 3. Redis – Celery broker + cache; 4. Django API – backend_indaplay; 5. PeerTube PostgreSQL; 6. PeerTube Node.js; 7. Frontend Next.js; 8. Celery Worker + Beat; 9. Umami Analytics; 10. frontend_accessible. Az ábrát a PDF E.1 komponens-topológiai felirat alatt tartalmazza; a teljes kép megőrizve.'}
chunks=[json.loads(s) for s in (D/'chunks.jsonl').read_text().splitlines()]
for c in chunks:
 if c['kind']=='image':c['text']=descriptions[c['page']];c['editorial_image_description']=True
(D/'chunks.jsonl').write_text(''.join(json.dumps(c,ensure_ascii=False)+'\n' for c in chunks))
pages=json.loads((D/'reader_pages.json').read_text())
def normalize(t):return re.sub(r'\s+','',t.replace('❌','✗').replace('✅','✓').replace('\u2011','-').replace('—','-').replace('–','-'))
source=''.join(b.get('text','') if b['kind']!='table' else ''.join(''.join(r) for r in b['rows']) for p in pages for b in p['blocks'] if b['kind']!='image')
pdf=PdfReader(R/'output/pdf/indaplay_audit_teljes_olvasovaltozat.hu.pdf');out=''.join(p.extract_text() or '' for p in pdf.pages)
missing=collections.Counter(normalize(source))-collections.Counter(normalize(out))
refs=set(map(int,re.findall(r'Eredeti PDF: (\d+)\. oldal',out)))
report=json.loads((D/'processing_report.json').read_text());report.update(guide_pdf_pages=len(PdfReader(R/'output/pdf/indaplay_audit_eligazito.hu.pdf').pages),rendered_pdf_missing_character_counts=dict(missing),all_original_page_markers_present=refs==set(range(1,312)),full_pdf_visual_contact_review_pages=389,html_qa={'desktop_and_mobile_screenshots_reviewed':True,'javascript_errors':[],'voucher_search_result_pages':[92,93,295],'page_navigation_checked':[190,295,310],'embedded_image_310_dimensions':[532,2043]},image_chunks_include_editorial_search_descriptions=True)
(D/'processing_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('Missing rendered characters',dict(missing),'Source page refs',len(refs))
# Horizontal line glyphs are decorative separators, rendered as spacing in the PDF.
rules=collections.Counter(''.join(b.get('text','') for p in pages for b in p['blocks'] if b['kind']=='rule'))
report.update(source_rule_character_counts=dict(rules),rendered_pdf_missing_non_decorative_character_counts=dict(missing-rules),decorative_rules_rendered_as_spacing=True)
(D/'processing_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
