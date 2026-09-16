from pathlib import Path
import pdfplumber,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
pdf=pdfplumber.open(ROOT/'sources/doc02/IndaPlay-Audit-Konszolidalt-HU-v2.docx.pdf')
out=[]
for n,p in enumerate(pdf.pages,1):
 lines=[]
 for l in p.extract_text_lines():
  chars=[c for c in l['chars'] if c['text'].strip()]
  if not chars:continue
  lines.append(dict(text=l['text'],x0=l['x0'],x1=l['x1'],top=l['top'],bottom=l['bottom'],size=round(max(c['size'] for c in chars),2),bold=all('Bold' in c['fontname'] for c in chars),mono=sum('Mono' in c['fontname'] or 'Courier' in c['fontname'] or 'Consolas' in c['fontname'] for c in chars)>len(chars)/2))
 ts=[]
 for t in p.find_tables():
  rows=t.extract()
  ts.append(dict(bbox=t.bbox,rows=rows))
 out.append(dict(page=n,width=p.width,height=p.height,text=p.extract_text(),lines=lines,tables=ts,images=[{k:i[k] for k in ['x0','x1','top','bottom','width','height']} for i in p.images]))
 p.close()
 if n%25==0:print(n,flush=True)
(ROOT/'sources/doc02/layout.json').write_text(json.dumps(out,ensure_ascii=False))
(ROOT/'sources/doc02/extracted.md').write_text('\n\n'.join(f'## Eredeti PDF - {x["page"]}. oldal\n\n{x["text"]}' for x in out))
print('DONE',len(out),'chars',sum(len(x['text']) for x in out),'tables',sum(len(x['tables']) for x in out),'images',sum(len(x['images']) for x in out))
