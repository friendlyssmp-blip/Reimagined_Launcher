import hashlib
import json
import urllib.request

HOSTS = [
    'https://raw.githubusercontent.com/friendlyssmp-blip/Reimagined_Launcher/main/update/latest.json',
    'https://github.com/friendlyssmp-blip/Reimagined_Launcher/raw/main/update/latest.json',
]

for h in HOSTS:
    try:
        with urllib.request.urlopen(h, timeout=30) as r:
            d = json.loads(r.read().decode('utf-8'))
        print(h)
        print('  version :', d.get('version'))
        print('  url     :', d.get('url'))
        print('  sha256  :', str(d.get('sha256'))[:16], '...')
        print('  size    :', d.get('size'))
    except Exception as e:
        print(h, 'ERROR', e)

# End-to-end: download the file the manifest points at and compare its sha256.
try:
    with urllib.request.urlopen(HOSTS[0], timeout=30) as r:
        d = json.loads(r.read().decode('utf-8'))
    if d.get('version') == '1.0.46' and '1.0.46' in d.get('url', ''):
        print('\nEND-TO-END download + verify:')
        with urllib.request.urlopen(d['url'], timeout=300) as r:
            body = r.read()
        got = hashlib.sha256(body).hexdigest()
        print('  bytes    :', len(body))
        print('  got sha  :', got[:16], '...')
        print('  want sha :', d['sha256'][:16], '...')
        print('  MATCH    :', got == d['sha256'])
    else:
        print('\nSKIP end-to-end: manifest still not 1.0.46 (CDN propagation pending)')
except Exception as e:
    print('\nEND-TO-END ERROR', e)
