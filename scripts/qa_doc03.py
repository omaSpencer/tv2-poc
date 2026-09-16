from pathlib import Path
import json,re,collections
from PIL import Image,ImageDraw
from pypdf import PdfReader,PdfWriter
import pdfplumber
R=Path(__file__).resolve().parents[1];D=R/'tmp/doc03/release';files=sorted(D.glob('page-*.png'),key=lambda p:int(p.stem.split('-')[-1]));print('Pages',len(files))
for off in range(0,len(files),12):
 sheet=Image.new('RGB',(1400,3*475),'#ccd6d8');draw=ImageDraw.Draw(sheet)
 for j,f in enumerate(files[off:off+12]):
  im=Image.open(f);im.thumbnail((335,447));x=(j%4)*350+(350-im.width)//2;y=(j//4)*475+22;sheet.paste(im,(x,y));draw.text(((j%4)*350+8,(j//4)*475+4),f'Output {off+j+1}',fill='black')
 sheet.save(D/f'contact-{off//12+1}.jpg')
pdf=PdfReader(next(D.glob('*.pdf')));texts=[p.extract_text() for p in pdf.pages];start=next(i for i,t in enumerate(texts) if 'A teljes forrás olvasóváltozata' in t);print('Guide',start,'Full starts',start+1)
(R/'sources/doc03/output_pdf_pages.json').write_text(json.dumps([{'page':i+1,'text':t} for i,t in enumerate(texts)],ensure_ascii=False))
issues=[]
with pdfplumber.open(next(D.glob('*.pdf'))) as pdfp:
 for n,p in enumerate(pdfp.pages,1):
  outside=[c['text'] for c in p.chars if c['x0']<40 or c['x1']>557 or c['top']<22 or c['bottom']>825]
  if outside:issues.append({'page':n,'text':''.join(outside)[:300]})
print('Bounds',issues)
report=json.loads((R/'sources/doc03/processing_report.json').read_text());report.update(output_pdf_pages=len(files),guide_pages=start,source_content_begins_output_page=start+1,text_outside_page_bounds=issues)
(R/'sources/doc03/processing_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
