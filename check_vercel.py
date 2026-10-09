import urllib.request
import re

html = urllib.request.urlopen('https://edu-manager-amber.vercel.app/').read().decode('utf-8')
match = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
if match:
    js_url = 'https://edu-manager-amber.vercel.app' + match.group(1)
    js = urllib.request.urlopen(js_url).read().decode('utf-8')
    print("Has Logout:", "Đăng xuất" in js)
    print("Has LT1 EDUCATION:", "LT1 EDUCATION" in js)
    print("Has Title LT1 EDUCATION:", "LT1 EDUCATION" in html)
else:
    print("Could not find JS file")
