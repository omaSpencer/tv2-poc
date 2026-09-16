from pathlib import Path
import zipfile,json,shutil
from lxml import etree
from docx import Document
R=Path(__file__).resolve().parents[1];p=R/'sources/doc03/Vezetoi-osszefoglalo-dontestamogato-rev2.docx';D=R/'sources/doc03';ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'};out=[]
def text(e):
 return ''.join(n.text or '' if n.tag.endswith('}t') else '\n' if n.tag.endswith('}br') or n.tag.endswith('}cr') else '\t' if n.tag.endswith('}tab') else '' for n in e.iter())
with zipfile.ZipFile(p) as z:
 root=etree.fromstring(z.read('word/document.xml'));body=root.find('w:body',ns)
 for i,e in enumerate(body):
  if e.tag.endswith('}sectPr'):continue
  if e.tag.endswith('}tbl'):
   rows=[['\n'.join(text(p) for p in c.findall('w:p',ns)) for c in r.findall('w:tc',ns)] for r in e.findall('w:tr',ns)]
   out.append({'id':f'DOC03-B{i+1:03}','kind':'table','rows':rows})
  else:
   txt='\n'.join(text(p) for p in e.findall('.//w:p',ns)) if e.tag.endswith('}sdt') else text(e);style=e.find('w:pPr/w:pStyle',ns)
   out.append({'id':f'DOC03-B{i+1:03}','kind':'paragraph','style':style.get('{'+ns['w']+'}val') if style is not None else '', 'text':txt,'images':e.xpath('.//*[local-name()="blip"]/@*[local-name()="embed"]')})
 (D/'blocks.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
 (D/'extracted.md').write_text('\n\n'.join(b['id']+' '+b.get('style','')+'\n'+(b['text'] if 'text'in b else '\n'.join(' | '.join(r) for r in b['rows'])) for b in out))
 print('blocks',len(out),'tables',sum(b['kind']=='table' for b in out),'textchars',sum(len(b.get('text','')) for b in out))
 print('tracked',len(root.findall('.//w:ins',ns)),len(root.findall('.//w:del',ns)),'textboxes',len(root.findall('.//w:txbxContent',ns)))
 print('extras',[n for n in z.namelist() if any(k in n for k in ['comments','footnotes','endnotes','media/'])]);print('core-properties-present','docProps/core.xml' in z.namelist())
 for n in z.namelist():
  if n.startswith('word/media/'):
   (D/'images').mkdir(exist_ok=True);(D/'images'/Path(n).name).write_bytes(z.read(n))
