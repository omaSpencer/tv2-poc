from pathlib import Path
from copy import deepcopy
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json,hashlib,sys
R=Path(__file__).resolve().parents[1];T=R/'tmp/standup';sys.path.insert(0,str(T));from content import GROUPS
REF=Path('/Users/busizoltan/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-strategy-memorandum/assets/reference.docx')
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';ns={'w':W};q=lambda n:'{'+W+'}'+n
with ZipFile(REF) as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find('w:body',ns);old=list(body);sect=deepcopy(old[-1]);manifest=[];md=[]
def el(n,**attrs):
 e=E.Element(q(n))
 for k,v in attrs.items():e.set(q(k),str(v))
 return e

def para(text,pattern=33,bold=False,keep=False):
 p=deepcopy(old[pattern]);ppr=p.find('w:pPr',ns);rpr=p.find('w:r/w:rPr',ns)
 for c in list(p):
  if c is not ppr:p.remove(c)
 for k in list(p.attrib):p.attrib.pop(k)
 if ppr is None:ppr=el('pPr');p.insert(0,ppr)
 for n in ['pageBreakBefore','keepNext']:
  for c in ppr.findall('w:'+n,ns):ppr.remove(c)
 if keep or pattern in [3,4,32,41]:ppr.append(el('keepNext'))
 ppr.append(el('widowControl'))
 r=el('r')
 if rpr is not None:r.append(deepcopy(rpr))
 if bold:
  rp=r.find('w:rPr',ns)
  if rp is None:rp=el('rPr');r.insert(0,rp)
  rp.append(el('b'))
 t=el('t');t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');t.text=text;r.append(t);p.append(r)
 return p

def add(text,pat=33,bold=False,keep=False):
 body.append(para(text,pat,bold,keep));manifest.append(text);md.append(('# ' if pat==3 else '## ' if pat==32 else '### ' if pat==41 else '')+text)

def page():
 p=el('p');r=el('r');r.append(el('br',type='page'));p.append(r);body.append(p);md.append('\n---\n')
for x in list(body):body.remove(x)
add('Standup kérdések',3);add('IndaPlay és TV2 Play',4)
add('2026. szeptember 15. · Kérdések a három dokumentum alapján',38)
add('A standupon azt szeretném tisztázni, mi a jelenlegi döntés és készültség, mi akadályozza a továbblépést, és kitől mikorra kapunk választ. Ha kevés az idő, az alábbi hat kérdéssel kezdenék.')
quick=[('Q01','Melyik terv az irányadó, és mi valósult meg igazoltan az audit javításaiból?'),('Q03','Lezártuk a kritikus biztonsági hibákat és a hitelesítő adatok cseréjét?'),('Q05','Ki kezeli a fizetést és az előfizetést, és mikorra születik szolgáltatói döntés?'),('Q07','Lezárt-e a DRM megoldása, és mi kell a prémium tartalmak indulásához?'),('Q13','Van sikeres visszaállítási próba, mért adatvesztéssel és helyreállítási idővel?'),('Q18','Mi a jóváhagyott indulási megfelelőségi lista, felelőssel és dátumokkal?')]
for id,txt in quick:add(id+'  '+txt,41)
add('Minden válasznál rögzítsük: jelenlegi állapot, következő lépés, felelős, határidő és a kapcsolódó feladat vagy bizonyíték linkje. A részletes technikai egyeztetés kapjon külön alkalmat.')
add('A = elsőként felteendő; B = szükséges szakmai tisztázás; C = külön egyeztetésre vihető. Ez a kérdéslista javasolt sorrendje, nem az audit súlyossági besorolása.',38)
for group_index,(title,items) in enumerate(GROUPS):
 if group_index==0:page()
 add(title,32)
 for id,priority,title,kind,question,context,want,role,refs in items:
  add(id+'  '+title,41)
  add(priority+' prioritás · '+kind+' · Javasolt válaszadó: '+role,38,keep=True)
  add(question,bold=True,keep=True)
  add(context,keep=True)
  add(want,keep=True)
  add('Forrás: '+refs,38)
page();add('Válaszok és következő lépések',32)
add('A megbeszélésen kitöltendő. A státusz legyen például: megválaszolt, nyitott, külön egyeztetés vagy újabb bizonyíték szükséges. A válaszadóként megjelölt szerepek javaslatok; a konkrét felelőst itt nevezzük meg.')
# Clone the retained four-column matrix, repurposed as six meeting records.
t=deepcopy(old[53]);trs=t.findall('w:tr',ns);head=deepcopy(trs[0]);even=deepcopy(trs[1]);odd=deepcopy(trs[2])
for tr in t.findall('w:tr',ns):t.remove(tr)
widths=[700,4060,1900,2700];grid=t.find('w:tblGrid',ns)
for c,v in zip(grid,widths):c.set(q('w'),str(v))
rows=[['ID','Válasz és következő lépés','Felelős és határidő','Státusz és link']]+[[id,'\n\n','\n\n','\n\n'] for id,_ in quick]
for i,values in enumerate(rows):
 tr=deepcopy(head if i==0 else even if i%2 else odd)
 rp=tr.find('w:trPr',ns)
 if rp is None:rp=el('trPr');tr.insert(0,rp)
 for h in rp.findall('w:trHeight',ns):rp.remove(h)
 rp.append(el('cantSplit'))
 if i==0:rp.append(el('tblHeader'))
 for j,(c,value) in enumerate(zip(tr.findall('w:tc',ns),values)):
  cp=c.find('w:tcPr',ns);cw=cp.find('w:tcW',ns)
  if cw is not None:cw.set(q('w'),str(widths[j]))
  p=c.find('w:p',ns);ppr=p.find('w:pPr',ns);rpr=p.find('w:r/w:rPr',ns)
  for x in list(c):
   if x is not cp:c.remove(x)
  p=el('p')
  if ppr is not None:p.append(deepcopy(ppr))
  for line in value.split('\n'):
   r=el('r')
   if rpr is not None:r.append(deepcopy(rpr))
   tt=el('t');tt.text=line or ' ';tt.set('{http://www.w3.org/XML/1998/namespace}space','preserve');r.append(tt);p.append(r)
   if '\n' in value:r.append(el('br'))
  c.append(p)
 t.append(tr)
body.append(t)
add('Források és hivatkozások',41)
add('DOC02 · IndaPlay-Audit-Konszolidalt-HU-v2.docx.pdf · 2026. május 6. A meglévő rendszer auditja.\nDOC03 · Vezetoi-osszefoglalo-dontestamogato-rev2.docx · 2026. június 2. Technológiai döntések és indoklás.\nDOC01 · old_new_summary.hu.pdf · 2026. szeptember 4. Régi rendszer és későbbi célarchitektúra.',38)
add('Az időrend DOC02 → DOC03 → DOC01. Az oldalszámok a két eredeti PDF-re vonatkoznak; a DOC03-nál a számozott fejezetet használjuk. A későbbi terv nem igazolja önmagában a megvalósítást. A kérdésként megjelölt ellenőrzési pontok nem állítják, hogy a rendszerben biztosan fennáll a hiba.',38)
add('További jegyzet',41)
add('........................................................................................................................\n........................................................................................................................')
body.append(sect)
serialize=lambda x:E.tostring(x,xml_declaration=True,encoding='UTF-8',standalone=True)
parts['word/document.xml']=serialize(root)
# Keep recurring elements and fields, only fill wording slots.
for name in ['word/header1.xml','word/footer1.xml']:
 e=E.fromstring(parts[name])
 for tt in e.findall('.//w:t',ns):
  if tt.text=='Strategy Memo':tt.text='IndaPlay és TV2 Play'
  elif tt.text and '[Confidentiality]' in tt.text:tt.text=tt.text.replace('[Confidentiality]','Standup kérdéslista')
  elif tt.text==' of ':tt.text=' / '
 parts[name]=serialize(e)
e=E.fromstring(parts['word/settings.xml']);uf=e.find('w:updateFields',ns)
if uf is None:uf=el('updateFields');e.append(uf)
uf.set(q('val'),'true');parts['word/settings.xml']=serialize(e)
e=E.fromstring(parts['docProps/core.xml']);cns={'dc':'http://purl.org/dc/elements/1.1/'}
for tag,val in [('title','IndaPlay és TV2 Play standup kérdések'),('subject','2026. szeptember 15. kérdéslista'),('creator','')]:
 e1=e.find('dc:'+tag,cns)
 if e1 is not None:e1.text=val
parts['docProps/core.xml']=serialize(e)
out=R/'output/docx/indaplay_tv2_standup_kerdesek_2026-09-15.hu.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
(T/'content_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));(T/'questions.json').write_text(json.dumps(GROUPS,ensure_ascii=False,indent=2));(R/'output/notes/indaplay_tv2_standup_kerdesek_2026-09-15.hu.md').write_text('\n\n'.join(md))
with ZipFile(REF) as z:
 changed=[n for n in z.namelist() if z.read(n)!=parts[n]]
 inventory=[{'part':n,'bytes':len(z.read(n)),'sha256':hashlib.sha256(z.read(n)).hexdigest(),'editable':n in changed} for n in z.namelist()]
(T/'template-package.json').write_text(json.dumps(inventory,indent=2));(T/'artifact.md').write_text((T/'artifact.md').read_text()+'\nReference SHA256 '+hashlib.sha256(REF.read_bytes()).hexdigest()+'\nEditable parts '+', '.join(changed)+'\n')
print(out);print('Changed only',changed);print('Questions',sum(len(g[1]) for g in GROUPS))
