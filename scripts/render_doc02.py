from pathlib import Path
import json,html,re,math,base64,collections
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,PageBreak,Table,TableStyle,Flowable,CondPageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor,white
from reportlab.lib.utils import ImageReader
ROOT=Path(__file__).resolve().parents[1]
P=json.loads((ROOT/'sources/doc02/reader_pages.json').read_text());G=json.loads((ROOT/'sources/doc02/guide.json').read_text());T=json.loads((ROOT/'sources/doc02/toc.json').read_text());L=json.loads((ROOT/'sources/doc02/layout.json').read_text())
PDFOUT=ROOT/'output/pdf';PDFOUT.mkdir(exist_ok=True)
FONT=Path('/Users/busizoltan/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype')
for name,f in [('Doc','DejaVuSans.ttf'),('Doc-Bold','DejaVuSans-Bold.ttf'),('Mono','DejaVuSansMono.ttf')]:pdfmetrics.registerFont(TTFont(name,str(FONT/f)))
pdfmetrics.registerFontFamily('Doc',normal='Doc',bold='Doc-Bold',italic='Doc',boldItalic='Doc-Bold')
styles={}
for k in ['p','bullet','numbered','h1','h2','h3','h4','title','subtitle','note','code','toc','ref']:
 d=dict(fontName='Doc',fontSize=10.3,leading=15.1,textColor=HexColor('#263648'),spaceAfter=7)
 if k in ['title','subtitle','h1','h2','h3','h4']:
  d.update(fontName='Doc-Bold',fontSize={'title':29,'subtitle':19,'h1':19,'h2':14,'h3':12,'h4':10.7}[k],spaceBefore=13,spaceAfter=7,keepWithNext=True,textColor=HexColor('#164e63'));d['leading']=d['fontSize']*1.3
 if k in ['bullet','numbered']:d.update(leftIndent=11,firstLineIndent=-8,spaceAfter=6)
 if k=='note':d.update(fontSize=9.3,leading=13.5,backColor=HexColor('#edf4f5'),borderPadding=9,spaceBefore=8,spaceAfter=14)
 if k=='code':d.update(fontName='Mono',fontSize=8,leading=11.3,backColor=HexColor('#f1f4f6'),borderPadding=6,spaceBefore=4,spaceAfter=10)
 if k=='toc':d.update(fontSize=8,leading=11)
 if k=='ref':d.update(fontSize=8,leading=11,textColor=HexColor('#647487'),spaceBefore=8,spaceAfter=8,keepWithNext=True)
 styles[k]=ParagraphStyle(k,**d)
def clean(t):
 return t.replace('❌','✗').replace('✅','✓').replace('\u2011','-').replace('—','-').replace('–','-')
def esc(t):return html.escape(clean(t))
class Panel(Flowable):
 def __init__(self,path,width,start,height):
  super().__init__();self.path=path;self.width=width;self.start=start;self.height=height
  iw,ih=ImageReader(path).getSize();self.fullheight=ih*width/iw
 def draw(self):
  c=self.canv;c.saveState();p=c.beginPath();p.rect(0,0,self.width,self.height);c.clipPath(p,stroke=0)
  c.drawImage(self.path,0,self.height-self.fullheight+self.start,width=self.width,height=self.fullheight,mask='auto');c.restoreState()
class Doc(SimpleDocTemplate):
 def __init__(self,*a,**kw):super().__init__(*a,**kw);self.page_map={};self.headings=[]
 def afterFlowable(self,f):
  if hasattr(f,'source_page'):
   n=f.source_page;self.page_map[n]=self.page;self.canv.bookmarkPage(f'original-{n}')
  if hasattr(f,'bm'):
   self.canv.bookmarkPage(f.bm);self.canv.addOutlineEntry(f.getPlainText(),f.bm,level=0,closed=False);self.headings.append([f.getPlainText(),self.page])
def foot(c,doc):
 c.setStrokeColor(HexColor('#d9e3e8'));c.line(45,39,550,39);c.setFont('Doc',7.5);c.setFillColor(HexColor('#617385'))
 c.drawString(45,25,'Bizalmas • DOC02 • IndaPlay audit • Olvasóváltozat');c.drawRightString(550,25,str(doc.page))
def tab(rows,header=True):
 n=len(rows[0]);size=8.3 if n>=6 else 9
 st=ParagraphStyle('cell',fontName='Doc',fontSize=size,leading=size*1.4,textColor=HexColor('#263648'))
 hd=ParagraphStyle('head',parent=st,fontName='Doc-Bold',textColor=white)
 # Each table fragment retains its full original cell strings and row/column order.
 data=[[Paragraph(esc(c).replace('\n','<br/>'),hd if header and i==0 else st) for c in row] for i,row in enumerate(rows)]
 weights=[]
 for j in range(n):
  vals=[len(r[j].replace('\n',' ')) for r in rows]
  avg=sum(min(v,150) for v in vals)/max(1,len(vals));weights.append(max(5,math.sqrt(avg)*3))
 minimum=32 if n>=6 else 65
 widths=[minimum+(505-minimum*n)*w/sum(weights) for w in weights]
 t=Table(data,colWidths=widths,repeatRows=1 if header else 0,splitInRow=1,hAlign='LEFT')
 commands=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,-1),.3,HexColor('#dbe4e8'))]
 if header:commands += [('BACKGROUND',(0,0),(-1,0),HexColor('#164e63')),('ROWBACKGROUNDS',(0,1),(-1,-1),[HexColor('#f0f5f7'),white])]
 else:commands += [('ROWBACKGROUNDS',(0,0),(-1,-1),[white,HexColor('#f0f5f7')])]
 t.setStyle(TableStyle(commands));return t
# Determine genuine table headers; carry them over a source page break when the table continues.
lasttable=None
for page,layout in zip(P,L):
 bs=page['blocks']
 for i,b in enumerate(bs):
  if b['kind']=='table':
   x0,y0,x1,y1=b['bbox'];lines=[l for l in layout['lines'] if y0-2<=l['top'] and l['bottom']<=y1+2]
   b['header']=bool(lines and lines[0]['bold'])
   if i==0 and lasttable and len(lasttable['rows'][0])==len(b['rows'][0]) and not b['header']:
    inherited=lasttable.get('inherited_header') or (lasttable['rows'][0] if lasttable.get('header') else None)
    if inherited:b['inherited_header']=inherited
 lasttable=bs[-1] if bs and bs[-1]['kind']=='table' else None

def renderblocks(bs,story,prefix,source=False):
 for i,b in enumerate(bs):
  k=b['kind'];text=b.get('text','')
  if k=='pagebreak':story.append(PageBreak());continue
  if k=='rule':story.append(Spacer(1,6));continue
  if source and k=='h1' and not text.startswith('IndaPlay'):story.append(CondPageBreak(170))
  if k=='table':
   rows=b['rows'];header=b.get('header',True)
   if b.get('inherited_header'):rows=[b['inherited_header']]+rows;header=True
   story.extend([tab(rows,header),Spacer(1,9)]);continue
  if k=='image':
   path=b['path'];iw,ih=ImageReader(path).getSize();width=min(505,iw);total=ih*width/iw
   count=math.ceil(total/620);height=total/count
   for part in range(count):
    story.append(Paragraph(f'Eredeti ábra - {part+1}/{count}. képrész; minden képrész a teljes beágyazott képből származik.',styles['ref']))
    story.append(Panel(path,width,part*height,height));story.append(Spacer(1,8))
   continue
  text=esc(text)
  if k=='code':text=text.replace('\n','<br/>')
  if k=='bullet' and not text.startswith(('●','•')):text='• '+text
  para=Paragraph(text,styles.get(k,styles['p']))
  if k in ['title','h1','h2','h3']:
   para.bm=f'{prefix}-{i}'
  story.append(para)
# Guide on its own.
story=[];renderblocks(G,story,'guide')
guidepath=PDFOUT/'indaplay_audit_eligazito.hu.pdf'
doc=Doc(str(guidepath),pagesize=(595.28,841.89),leftMargin=45,rightMargin=45,topMargin=44,bottomMargin=53,title='IndaPlay audit - eligazító',author='Olvasóváltozat a csatolt forrás alapján')
doc.build(story,onFirstPage=foot,onLaterPages=foot)
print('GUIDE PDF',doc.page,flush=True)
# Complete reading edition.
story=[];renderblocks(G,story,'g');story.extend([PageBreak(),Paragraph('Teljes, tartalommegőrző olvasóváltozat',styles['h1']),Paragraph('A következő rész a csatolt audit teljes szövegét és táblázatait tartalmazza. A számok, állítások, minősítések és belső utasítások forrástartalomként szerepelnek. A régi tartalomjegyzék is megmaradt; a tájékozódáshoz az új könyvjelzőket és az eligazító tényleges oldalszámait használd. A forráslapokon átívelő táblázatok folytatásánál szükség esetén megismételtem az előző fejlécet. A hosszú ábrák egymást követő képrészekben olvashatók. A pipa és kereszt jelölések egyszínű karakterként szerepelnek.',styles['note'])])
for p in P:
 ref=Paragraph(f'Eredeti PDF: {p["page"]}. oldal • DOC02-P{p["page"]:03}',styles['ref']);ref.source_page=p['page'];story.append(ref)
 renderblocks(p['blocks'],story,f'p{p["page"]}',True)
fullpath=PDFOUT/'indaplay_audit_teljes_olvasovaltozat.hu.pdf'
doc=Doc(str(fullpath),pagesize=(595.28,841.89),leftMargin=45,rightMargin=45,topMargin=44,bottomMargin=53,title='IndaPlay konszolidált audit - teljes olvasóváltozat',author='Tartalommegőrző feldolgozás')
doc.build(story,onFirstPage=foot,onLaterPages=foot)
(ROOT/'sources/doc02/output_page_map.json').write_text(json.dumps(doc.page_map,indent=2))
print('FULL PDF',doc.page,'mapped',len(doc.page_map),flush=True)
# Output normalized, searchable Markdown as an additional plain-text artifact.
md=['# IndaPlay - teljes olvasóváltozat','Forrás: 2026-05-06. A következő szöveg a DOC02 audit tartalma. Az értelmezési megjegyzések a külön eligazítóban szerepelnek.']
for p in P:
 md.append(f'## Eredeti PDF - {p["page"]}. oldal')
 for b in p['blocks']:
  k=b['kind'];t=b.get('text','')
  md.append(f'<a id="{b["id"]}"></a>')
  if k=='table':
   rows=b['rows'];md.append('\n'.join(['| '+' | '.join(c.replace('\n','<br>').replace('|','\\|') for c in r)+' |' for r in rows[:1]]+['| '+' | '.join(['---']*len(rows[0]))+' |']+['| '+' | '.join(c.replace('\n','<br>').replace('|','\\|') for c in r)+' |' for r in rows[1:]]))
  elif k=='image':md.append(f'![Eredeti ábra - {p["page"]}. oldal]({b["path"]})')
  elif k=='code':md.append('```text\n'+t+'\n```')
  elif k=='rule':md.append('---')
  else:md.append({'h1':'### ','h2':'#### ','h3':'##### ','h4':'###### '}.get(k,'')+t)
(ROOT/'output/notes/doc02/indaplay_audit_teljes.hu.md').write_text('\n\n'.join(md)+'\n')
# Prepare browser reader: the original PDF is embedded, so it travels with the single HTML file.
image_data={str(p):'data:image/png;base64,'+base64.b64encode(p.read_bytes()).decode() for p in (ROOT/'sources/doc02/images').glob('*.png')}
for page in P:
 for b in page['blocks']:
  if b['kind']=='image':b['image_url']=image_data[b['path']]
asset={'pages':P,'guide':G,'toc':T,'pdf':base64.b64encode((ROOT/'sources/doc02/IndaPlay-Audit-Konszolidalt-HU-v2.docx.pdf').read_bytes()).decode()}
(ROOT/'tmp/pdfs/doc02/reader_payload.json').write_text(json.dumps(asset,ensure_ascii=False).replace('<','\\u003c'))
report=json.loads((ROOT/'sources/doc02/processing_report.json').read_text());report.update(full_reading_pdf_pages=doc.page,original_to_output_page_mapping=len(doc.page_map),pdf_symbol_substitution={'❌':'✗','✅':'✓'})
(ROOT/'sources/doc02/processing_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
