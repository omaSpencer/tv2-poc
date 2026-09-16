from pathlib import Path
from PIL import Image,ImageOps,ImageDraw
import json,pdfplumber
R=Path(__file__).resolve().parents[1];D=R/'tmp/pdfs/doc02'
files=sorted(D.glob('final-*.png'))
for off in range(0,len(files),30):
 sheet=Image.new('RGB',(1500,6*235),'#c5cfd3');draw=ImageDraw.Draw(sheet)
 for j,f in enumerate(files[off:off+30]):
  im=Image.open(f);im.thumbnail((286,210));x=(j%5)*300+(300-im.width)//2;y=(j//5)*235+19;sheet.paste(im,(x,y));draw.text(((j%5)*300+8,(j//5)*235+3),f'PDF {off+j+1}',fill='#143c45')
 sheet.save(D/f'qa-final-{off//30+1:02}.jpg')
issues=[]
with pdfplumber.open(R/'output/pdf/indaplay_audit_teljes_olvasovaltozat.hu.pdf') as pdf:
 for n,p in enumerate(pdf.pages,1):
  chars=p.chars
  outside=[c.get('text') for c in chars if c['x0']<40 or c['x1']>556 or c['top']<25 or c['bottom']>825]
  if outside:issues.append({'page':n,'outside':''.join(outside)[:200]})
 print('PAGES',len(pdf.pages),'BOUNDS',issues)
(R/'sources/doc02/layout_qa.json').write_text(json.dumps({'pages':len(files),'text_outside_bounds':issues,'contact_sheets':13},ensure_ascii=False,indent=2))
