from copy import deepcopy
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import hashlib
import json
import sys

from lxml import etree as E


ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp" / "newstack_standup"
sys.path.insert(0, str(TMP))

from content_newstack import GROUPS, OFFICIAL_SOURCES, QUICK, VALIDATION


REFERENCE = Path("/Users/busizoltan/Downloads/indaplay_tv2_standup_kerdesek_2026-09-15.hu.docx")
OUTPUT = ROOT / "output" / "docx" / "indaplay_tv2_greenfield_backend_standup_kerdesek_2026-09-15.hu.docx"
NOTES = ROOT / "output" / "notes" / "indaplay_tv2_greenfield_backend_standup_kerdesek_2026-09-15.hu.md"
EXPECTED_SHA = "b5980b863b98c130a9147d17be94d17b70717dbff493ab6d2062fb14d85a0d22"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
Q = lambda name: f"{{{W}}}{name}"


def element(name, **attrs):
    node = E.Element(Q(name))
    for key, value in attrs.items():
        node.set(Q(key), str(value))
    return node


def text_of(node):
    return "".join(node.xpath(".//w:t/text()", namespaces=NS))


def paragraph_by_text(children, exact=None, starts=None):
    for node in children:
        if node.tag != Q("p"):
            continue
        value = text_of(node)
        if exact is not None and value == exact:
            return deepcopy(node)
        if starts is not None and value.startswith(starts):
            return deepcopy(node)
    raise RuntimeError(f"Reference paragraph not found: exact={exact!r} starts={starts!r}")


def replace_text(paragraph, text, bold=None, font_size_half_points=None):
    ppr = paragraph.find("w:pPr", NS)
    original_rpr = paragraph.find("w:r/w:rPr", NS)
    for child in list(paragraph):
        if child is not ppr:
            paragraph.remove(child)
    run = element("r")
    if original_rpr is not None:
        run.append(deepcopy(original_rpr))
    rpr = run.find("w:rPr", NS)
    if rpr is None:
        rpr = element("rPr")
        run.insert(0, rpr)
    for old_b in rpr.findall("w:b", NS):
        rpr.remove(old_b)
    if bold:
        rpr.append(element("b"))
    if font_size_half_points is not None:
        for old_sz in rpr.findall("w:sz", NS) + rpr.findall("w:szCs", NS):
            rpr.remove(old_sz)
        rpr.append(element("sz", val=font_size_half_points))
        rpr.append(element("szCs", val=font_size_half_points))
    text_node = element("t")
    text_node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    text_node.text = text
    run.append(text_node)
    paragraph.append(run)
    return paragraph


def tune_paragraph(paragraph, keep=False, keep_next=False, space_after=None):
    ppr = paragraph.find("w:pPr", NS)
    if ppr is None:
        ppr = element("pPr")
        paragraph.insert(0, ppr)
    for name in ("pageBreakBefore", "keepNext", "keepLines", "widowControl"):
        for item in ppr.findall(f"w:{name}", NS):
            ppr.remove(item)
    if keep_next:
        ppr.append(element("keepNext"))
    if keep:
        ppr.append(element("keepLines"))
    ppr.append(element("widowControl"))
    if space_after is not None:
        spacing = ppr.find("w:spacing", NS)
        if spacing is None:
            spacing = element("spacing")
            ppr.append(spacing)
        spacing.set(Q("after"), str(space_after))
    return paragraph


def set_cell_text(cell, text, template_paragraph, bold=False, size=19, center=False):
    tcpr = cell.find("w:tcPr", NS)
    for child in list(cell):
        if child is not tcpr:
            cell.remove(child)
    paragraph = replace_text(deepcopy(template_paragraph), text, bold=bold, font_size_half_points=size)
    ppr = paragraph.find("w:pPr", NS)
    if center:
        jc = ppr.find("w:jc", NS)
        if jc is None:
            jc = element("jc")
            ppr.append(jc)
        jc.set(Q("val"), "center")
    cell.append(paragraph)


def make_table(source_table, header_values, body_rows, widths, body_pattern, header_pattern, body_size=19):
    table = deepcopy(source_table)
    source_rows = table.findall("w:tr", NS)
    header_row = deepcopy(source_rows[0])
    odd_row = deepcopy(source_rows[1])
    even_row = deepcopy(source_rows[2])
    for row in source_rows:
        table.remove(row)
    grid = table.find("w:tblGrid", NS)
    for col, width in zip(list(grid), widths):
        col.set(Q("w"), str(width))

    all_rows = [header_values] + body_rows
    for index, values in enumerate(all_rows):
        row = deepcopy(header_row if index == 0 else odd_row if index % 2 else even_row)
        row_pr = row.find("w:trPr", NS)
        if row_pr is None:
            row_pr = element("trPr")
            row.insert(0, row_pr)
        for height in row_pr.findall("w:trHeight", NS):
            row_pr.remove(height)
        row_pr.append(element("cantSplit"))
        if index == 0:
            row_pr.append(element("tblHeader"))
        cells = row.findall("w:tc", NS)
        for col_index, (cell, value) in enumerate(zip(cells, values)):
            tcpr = cell.find("w:tcPr", NS)
            tc_width = tcpr.find("w:tcW", NS)
            if tc_width is not None:
                tc_width.set(Q("w"), str(widths[col_index]))
            set_cell_text(
                cell,
                value,
                header_pattern if index == 0 else body_pattern,
                bold=index == 0,
                size=20 if index == 0 else body_size,
                center=index == 0 or col_index in (0, len(values) - 1),
            )
        table.append(row)
    return table


actual_sha = hashlib.sha256(REFERENCE.read_bytes()).hexdigest()
if actual_sha != EXPECTED_SHA:
    raise RuntimeError(f"Reference SHA mismatch: {actual_sha}")

with ZipFile(REFERENCE) as archive:
    parts = {name: archive.read(name) for name in archive.namelist()}

root = E.fromstring(parts["word/document.xml"])
body = root.find("w:body", NS)
children = list(body)
section_properties = deepcopy(children[-1])
source_table = next(deepcopy(node) for node in children if node.tag == Q("tbl"))

patterns = {
    "title": paragraph_by_text(children, exact="Standup kérdések"),
    "subtitle": paragraph_by_text(children, exact="IndaPlay és TV2 Play"),
    "meta": paragraph_by_text(children, starts="2026. szeptember 15."),
    "body": paragraph_by_text(children, starts="A standupon azt szeretném"),
    "quick": paragraph_by_text(children, starts="Q01  Melyik terv"),
    "h1": paragraph_by_text(children, exact="Döntések és az éles rendszer"),
    "h2": paragraph_by_text(children, exact="Q01  Hatályos terv és tényleges készültség"),
    "priority": paragraph_by_text(children, starts="A prioritás · Verzióváltás"),
    "question": paragraph_by_text(children, starts="Melyik jóváhagyott tervből"),
    "context": paragraph_by_text(children, starts="A májusi auditot"),
    "source": paragraph_by_text(children, starts="Forrás: DOC01 1."),
    "pagebreak": next(deepcopy(node) for node in children if node.tag == Q("p") and node.find(".//w:br", NS) is not None),
}

for node in list(body):
    body.remove(node)

markdown = []
manifest = []


def add(text, pattern, bold=False, keep=False, keep_next=False, space_after=None, markdown_level=None):
    paragraph = replace_text(deepcopy(patterns[pattern]), text, bold=bold)
    tune_paragraph(paragraph, keep=keep, keep_next=keep_next, space_after=space_after)
    body.append(paragraph)
    manifest.append(text)
    prefix = "" if markdown_level is None else "#" * markdown_level + " "
    markdown.append(prefix + text)
    return paragraph


def page_break():
    body.append(deepcopy(patterns["pagebreak"]))
    markdown.append("\n---\n")


add("Greenfield backend standup kérdések", "title", markdown_level=1)
add("IndaPlay és TV2 Play", "subtitle", markdown_level=2)
add("2026. szeptember 15. · Új architektúra és technológiai döntések", "meta")
add(
    "A standupon a greenfield rendszer döntéseit szeretném lezárni. A három projektanyag és a Cursor-kutatás alapján a technológiai irány többnyire védhető, de a stack még nem teljes és több kulcselem csak feltételesen alkalmas a vállalt méretre. Ha kevés az idő, ezzel a hat kérdéssel kezdenék.",
    "body",
)
for question_id, question in QUICK:
    add(f"{question_id}  {question}", "quick", keep=True, keep_next=True, markdown_level=2)
add(
    "Minden válasz végén rögzítsük a döntést, a felelőst, a határidőt és az elkészítendő ADR, mérés, ajánlat vagy PoC linkjét. A részletes megoldástervezés kapjon külön alkalmat.",
    "body",
)
add(
    "A = döntést kér a továbblépéshez. B = szükséges szakmai tisztázás. A DOC02-ből csak korábbi termék- és kapacitáselvárásokat használunk; a kérdések nem a legacy rendszer javításáról szólnak.",
    "meta",
)

page_break()
add("A Cursor kutatás validációja", "h1", markdown_level=1)
add(
    "A legerősebb állítás helyes: az egymillió élő néző forgalmát CDN-nek kell elnyelnie, a NestJS pedig kontrollsík marad. A kutatás jó kockázatokat talált, de több benchmark és listaár csak példaszám, ezért nem használható TV2-kapacitás vagy költség bizonyítékaként. Az alábbi minősítés a projekt döntési alapja szempontjából értendő.",
    "body",
)
validation_table = make_table(
    source_table,
    ["Komponens", "Minősítés", "Validált következtetés", "Kapcsolódó kérdés"],
    [list(row) for row in VALIDATION],
    [1400, 1500, 4960, 1500],
    patterns["body"],
    patterns["question"],
    body_size=18,
)
body.append(validation_table)
markdown.append("\n" + "\n".join(f"- {name}: {rating}. {finding} ({qids})" for name, rating, finding, qids in VALIDATION))

page_break()
for group_title, questions in GROUPS:
    add(group_title, "h1", keep_next=True, markdown_level=1)
    for question_id, priority, title, kind, question, context, expected, role, refs in questions:
        add(f"{question_id}  {title}", "h2", keep_next=True, markdown_level=2)
        add(f"{priority} prioritás · {kind} · Javasolt válaszadó: {role}", "priority", keep=True, keep_next=True)
        add(question, "question", bold=True, keep=True, keep_next=True)
        add(context, "context", keep=True)
        add(expected, "context", keep=True)
        add(f"Forrás: {refs}", "source")

page_break()
add("Válaszok és következő lépések", "h1", markdown_level=1)
add(
    "A hat első kérdéshez töltsük ki a konkrét döntést vagy következő lépést. A státusz legyen megválaszolt, nyitott vagy külön egyeztetés szükséges.",
    "body",
)
answer_table = make_table(
    source_table,
    ["ID", "Döntés és következő lépés", "Felelős és határidő", "Státusz és link"],
    [[question_id, "\n\n", "\n\n", "\n\n"] for question_id, _ in QUICK],
    [700, 4060, 1900, 2700],
    patterns["body"],
    patterns["question"],
    body_size=20,
)
body.append(answer_table)

add("Projektforrások", "h2", keep_next=True, markdown_level=2)
add(
    "DOC01 · old_new_summary.hu.pdf · 2026. szeptember 4. A legfrissebb célarchitektúra és nyitott döntések.\n"
    "DOC03 · Vezetoi-osszefoglalo-dontestamogato-rev2.docx · 2026. június 2. Technológiai döntések és üzleti indokok.\n"
    "DOC02 · IndaPlay-Audit-Konszolidalt-HU-v2.docx.pdf · 2026. május 6. Ebben a dokumentumban kizárólag korábbi termék- és kapacitáselvárások forrása.\n"
    "Kiegészítő kutatás · backend-tech-stack.md · 2026. szeptember 14. Külső technológiai kutatás, most validált következtetésekkel.",
    "meta",
)
add("Ellenőrzött elsődleges technológiai források", "h2", keep_next=True, markdown_level=2)
for start in range(0, len(OFFICIAL_SOURCES), 5):
    add(" · ".join(OFFICIAL_SOURCES[start : start + 5]), "meta", keep=True)

body.append(section_properties)


def serialize(node):
    return E.tostring(node, xml_declaration=True, encoding="UTF-8", standalone=True)


parts["word/document.xml"] = serialize(root)

for part_name in ("word/header1.xml", "word/footer1.xml"):
    node = E.fromstring(parts[part_name])
    for text_node in node.findall(".//w:t", NS):
        if text_node.text and "Standup kérdéslista" in text_node.text:
            text_node.text = text_node.text.replace("Standup kérdéslista", "Greenfield backend standup")
    parts[part_name] = serialize(node)

settings = E.fromstring(parts["word/settings.xml"])
update_fields = settings.find("w:updateFields", NS)
if update_fields is None:
    update_fields = element("updateFields")
    settings.append(update_fields)
update_fields.set(Q("val"), "true")
parts["word/settings.xml"] = serialize(settings)

core = E.fromstring(parts["docProps/core.xml"])
DC = {"dc": "http://purl.org/dc/elements/1.1/"}
for tag, value in (
    ("title", "IndaPlay és TV2 Play greenfield backend standup kérdések"),
    ("subject", "2026. szeptember 15. új architektúra és technológiai döntések"),
    ("creator", ""),
):
    target = core.find(f"dc:{tag}", DC)
    if target is not None:
        target.text = value
parts["docProps/core.xml"] = serialize(core)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as archive:
    for name, data in parts.items():
        archive.writestr(name, data)

NOTES.parent.mkdir(parents=True, exist_ok=True)
NOTES.write_text("\n\n".join(markdown), encoding="utf-8")
(TMP / "content_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

with ZipFile(REFERENCE) as archive:
    changed = [name for name in archive.namelist() if archive.read(name) != parts[name]]
    inventory = [
        {
            "part": name,
            "bytes": len(archive.read(name)),
            "sha256": hashlib.sha256(archive.read(name)).hexdigest(),
            "classification": "editable" if name in changed else "preserve-only",
        }
        for name in archive.namelist()
    ]
(TMP / "package_inventory.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")

print(OUTPUT)
print("Changed parts:", ", ".join(changed))
print("Questions:", sum(len(items) for _, items in GROUPS))
print("Validation rows:", len(VALIDATION))
