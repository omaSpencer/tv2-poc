from pathlib import Path
import json,re,collections,hashlib
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]
pages=json.loads((ROOT/'sources/doc02/layout.json').read_text())
art=ROOT/'sources/doc02/images';art.mkdir(exist_ok=True)
reader=PdfReader(ROOT/'sources/doc02/IndaPlay-Audit-Konszolidalt-HU-v2.docx.pdf')
for n in [12,13,310]:
 for j,im in enumerate(reader.pages[n-1].images,1):
  im.image.save(art/f'p{n:03}_{j}.png')
  print('IMAGE',n,im.image.size)
def normal(s):return re.sub(r'\s+','',s)
def counter(s):return collections.Counter(normal(s))
def bodyline(l):return not (l['text']=='IndaPlay — Konszolidált Audit-jelentés' or re.fullmatch(r'Bizalmas\s*\|\s*\d+\s*/\s*311',l['text']))
def parse_lines(events):
 blocks=[];prev=None
 for top,typ,thing in sorted(events,key=lambda e:e[0]):
  if typ in ['table','image']:
   blocks.append({'kind':typ,**thing});prev=None;continue
  l=thing;t=l['text'];k='p'
  if l['size']>=20:k='h1'
  elif l['size']>=15:k='h2'
  elif l['size']>=12.5:k='h3'
  elif l['mono']:k='code'
  elif l['bold'] and len(t)<200:k='h4'
  elif re.match(r'^[A-K]\.\d+(?:\.[A-Za-z0-9]+)+\s',t) and len(t)<150:k='h4'
  elif t.startswith(('●','•')):k='bullet'
  elif re.match(r'^\d+[.)]\s',t):k='numbered'
  elif re.fullmatch('[─━_—-]{5,}',t):k='rule'
  elif re.search(r'\.{8,}',t):k='toc'
  join=False
  if blocks and prev:
   gap=l['top']-prev['bottom']
   if k=='p' and blocks[-1]['kind'] in ['p','bullet','numbered'] and gap<6.2:join=True
   if k=='code' and blocks[-1]['kind']=='code' and gap<7:join=True
   if k.startswith('h') and blocks[-1]['kind']==k and gap<7:join=True
  if join:blocks[-1]['text']+=('\n' if k=='code' else ' ')+t
  else:blocks.append({'kind':k,'text':t,'top':l['top']})
  prev=l
 return blocks
out=[];fallback=[];tablecount=0;verified=0;chunks=[];toc=[];section='Címlap és eredeti tartalomjegyzék'
for p in pages:
 n=p['page'];lines=[l for l in p['lines'] if bodyline(l)];events=[];tables=[]
 for t in p['tables']:
  # Bordered code blocks can be one-cell tables. Keep them, with all content.
  x0,y0,x1,y1=t['bbox'];rows=[[c or '' for c in row] for row in t['rows']]
  tables.append((x0,y0,x1,y1));events.append((y0,'table',{'rows':rows,'bbox':t['bbox']}))
 for l in lines:
  if not any(y0-2<=l['top'] and l['bottom']<=y1+2 and l['x0']>=x0-3 and l['x1']<=x1+4 for x0,y0,x1,y1 in tables):events.append((l['top'],'line',l))
 for j,im in enumerate(p['images'],1):events.append((im['top'],'image',{'path':str(art/f'p{n:03}_{j}.png')}))
 blocks=parse_lines(events)
 def txt(bs):return ''.join(''.join(''.join(row) for row in b['rows']) if b['kind']=='table' else b.get('text','') for b in bs)
 source=''.join(l['text'] for l in lines)
 good=counter(source)==counter(txt(blocks))
 if not good:
  missing=counter(source)-counter(txt(blocks));extra=counter(txt(blocks))-counter(source)
  fallback.append({'page':n,'missing':dict(missing),'extra':dict(extra)})
  events=[(l['top'],'line',l) for l in lines]+[(im['top'],'image',{'path':str(art/f'p{n:03}_{j}.png')}) for j,im in enumerate(p['images'],1)]
  blocks=parse_lines(events)
  assert counter(source)==counter(txt(blocks)),n
  # Original-page facsimile is the primary view for ambiguous table cells.
 else:verified+=len(tables)
 tablecount+=len(tables)
 # Capture high-level heading positions from the real pages, not the stale TOC.
 for b in blocks:
  if b['kind'] in ['h1','h2','h3'] and n>=4 and not re.search(r'\.{8,}',b.get('text','')):
   t=b['text']
   if len(t)>220:continue
   if n==4 and 'Függelék' in t:continue
   toc.append({'page':n,'title':t,'level':b['kind']});section=t
 for i,b in enumerate(blocks,1):
  b['id']=f'DOC02-P{n:03}-B{i:03}'
  if b['kind'].startswith('h'):section=b.get('text',section)
  text='\n'.join(' | '.join(row) for row in b['rows']) if b['kind']=='table' else b.get('text','')
  if b['kind']=='image':text=f'Az eredeti {n}. oldal architektúra-ábrája. Részletek a megőrzött képen.'
  chunks.append({'id':b['id'],'source':'IndaPlay-Audit-Konszolidalt-HU-v2.docx.pdf','page':n,'section':section,'kind':b['kind'],'evidence_labels':re.findall(r'\[(?:DIRECT|CROSS-VERIFIED|INFERRED|ESTIMATE|NOT VERIFIED|INDUSTRY-REF|REGULATORY-TEXT)\]',text),'text':text,**({'image':b['path']} if b['kind']=='image' else {})})
 out.append({'page':n,'blocks':blocks,'fallback':not good,'text':'\n'.join(l['text'] for l in lines)})
(ROOT/'sources/doc02/reader_pages.json').write_text(json.dumps(out,ensure_ascii=False))
(ROOT/'sources/doc02/toc.json').write_text(json.dumps(toc,ensure_ascii=False,indent=2))
(ROOT/'sources/doc02/chunks.jsonl').write_text('\n'.join(json.dumps(c,ensure_ascii=False) for c in chunks)+'\n')
report={'source_pages':311,'body_text_character_multiset_preserved_on_all_pages':True,'table_fragments_detected':tablecount,'table_fragments_in_verified_reflow_pages':verified,'fallback_pages':fallback,'raster_images_preserved':3,'chunks':len(chunks),'source_sha256':hashlib.sha256((ROOT/'sources/doc02/IndaPlay-Audit-Konszolidalt-HU-v2.docx.pdf').read_bytes()).hexdigest()}
(ROOT/'sources/doc02/processing_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('REPORT',{k:v for k,v in report.items() if k!='fallback_pages'})
print('FALLBACK_PAGES',[x['page'] for x in fallback]);print('TOC',len(toc))
