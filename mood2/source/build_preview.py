# A single-file copy of the app for previewing inside Claude: scripts and font inlined, no manifest, no service worker, check-ins kept in memory.
import base64, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); R = os.path.dirname(HERE) + '/'
out_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mood-app-preview.html'
html = open(R + 'index.html').read()
font = base64.b64encode(open(R + 'geist-mono-ui.woff2', 'rb').read()).decode()
html = html.replace('url(geist-mono-ui.woff2)', 'url(data:font/woff2;base64,%s)' % font)
for tag in (r'  <link rel="manifest"[^\n]*\n', r'  <link rel="icon"[^\n]*\n', r'  <link rel="apple-touch-icon"[^\n]*\n'): html = re.sub(tag, '', html)
data, app = open(R + 'data.js').read(), open(R + 'app.js').read()
html = html.replace('<script src="data.js"></script>', '<script>window.MOOD_PREVIEW = true; window.MOOD_NO_SW = true;</script>\n  <script>' + data.replace('</script', '<\\/script') + '</script>')
html = html.replace('<script src="app.js"></script>', '<script>' + app.replace('</script', '<\\/script') + '</script>')
assert 'src="data.js"' not in html and 'src="app.js"' not in html and 'rel="manifest"' not in html
open(out_path, 'w').write(html); print(out_path, len(html), 'bytes')
