import sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1])
ss = []
if 'xl/sharedStrings.xml' in z.namelist():
    x = z.read('xl/sharedStrings.xml').decode('utf8')
    ss = [re.sub('<[^>]+>', '', m) for m in re.findall(r'<si>(.*?)</si>', x, re.S)]
sheet = z.read('xl/worksheets/sheet1.xml').decode('utf8')
for row in re.findall(r'<row [^>]*>(.*?)</row>', sheet, re.S):
    cells = []
    for m in re.finditer(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', row, re.S):
        attrs, inner = m.group(2), m.group(3) or ''
        v = re.search(r'<v>(.*?)</v>', inner)
        if v is None:
            t = re.search(r'<t[^>]*>(.*?)</t>', inner)
            cells.append(t.group(1) if t else ''); continue
        cells.append(ss[int(v.group(1))] if 't="s"' in attrs else v.group(1))
    if any(cells): print(' | '.join(cells))
