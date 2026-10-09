import urllib.request
import re

html = urllib.request.urlopen('https://edu-manager-amber.vercel.app/').read().decode('utf-8')
match = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
if match:
    js_url = 'https://edu-manager-amber.vercel.app' + match.group(1)
    js = urllib.request.urlopen(js_url).read().decode('utf-8')
    matches = re.findall(r'[a-zA-Z0-9_]+\.get\([^\)]+\)', js)
    print("Found API calls:")
    for m in matches[:10]:
        print(m)
else:
    print("Could not find JS file")
