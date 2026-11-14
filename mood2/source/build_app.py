# Builds the web app in mood2/: index.html from the three screens (prototype/flow.html) plus the "?" button and its help,
# then stamps sw.js with a hash of every file it caches, so a changed file always means a new cache and nobody has to bump a number.
import hashlib, re, shutil, subprocess
import os
HERE = os.path.dirname(os.path.abspath(__file__))   # …/mood2/source
R = os.path.dirname(HERE) + '/'                         # …/mood2/
for step in ('build_blobs.py', 'build_note.py', 'build_flow.py'): subprocess.run(['python3', HERE + '/' + step], check=True)
out = open(R + 'prototype/flow.html').read()

# the router moves to app.js
r0 = out.index('  <script>\n  // The flow: screen one, screen two, then screen three.'); r1 = out.index('</script>', r0) + len('</script>')
out = out[:r0] + '  <script src="data.js"></script>\n  <script src="app.js"></script>' + out[r1:]

head = '''  <title>Mood</title>
  <meta name="description" content="A short check-in with how you feel right now.">
  <link rel="manifest" href="manifest.json">
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="icon-192.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Mood">'''
out = re.sub(r'  <title>.*?</title>', lambda m: head, out, count=1)

css = '''
    /* the "?" and its help, in the style of the screen labels */
    .qbtn{position:fixed;z-index:50;top:calc(var(--app-top,0px) + var(--safe-t) + 2px);right:calc(var(--safe-r) + 6px);width:52px;height:46px;display:grid;place-items:center;color:var(--label)}
    .qbtn .ring{width:22px;height:22px;border:1.2px solid #6a6b72;border-radius:50%;display:grid;place-items:center;font-family:"Geist Mono",ui-monospace,"Roboto Mono",monospace;font-size:12px;line-height:1;transition:border-color .2s ease,color .2s ease}
    .qbtn .x{display:none;width:9px;height:9px}
    .qbtn[aria-expanded=true] .q{display:none}
    .qbtn[aria-expanded=true] .x{display:block}
    .qbtn[aria-expanded=true] .ring{border-color:var(--lavender);color:var(--lavender)}
    .qbtn:active .ring{border-color:var(--label)}
    [data-at=saved] .qbtn{visibility:hidden}
    @media (prefers-reduced-motion:reduce){.qbtn .ring{transition:none}}
    .help{position:fixed;z-index:40;left:0;top:var(--app-top,0px);width:100%;height:var(--app-h,100dvh);display:none;align-items:center;justify-content:center;
      padding:calc(var(--safe-t) + 60px) calc(var(--safe-r) + 18px) calc(var(--safe-b) + 24px) calc(var(--safe-l) + 18px);background:rgba(16,17,22,.9);touch-action:pan-y}
    .help.open{display:flex}
    .helpcard{width:100%;max-width:380px;max-height:100%;overflow-y:auto;overscroll-behavior:contain;padding:22px 20px;background:#1a1b21;border:1px solid #2a2b33;outline:none;scrollbar-width:none;
      font-family:"Geist Mono",ui-monospace,"Roboto Mono",monospace;font-weight:400;font-size:11.2px;line-height:1.85;letter-spacing:.09em;text-transform:uppercase;color:var(--label)}
    .helpcard::-webkit-scrollbar{display:none}
    .helpcard h2{margin:0 0 14px;font:inherit;color:#E2E0F4}
    .helpcard p{margin:0 0 12px}
    .helpcard p:last-child{margin-bottom:0}
    .helprule{height:1px;margin:18px 0 16px;background:#2a2b33}
    .helprow{display:flex;justify-content:space-between;gap:14px;margin:0 0 4px}
    .helprow span:last-child{color:#E2E0F4;text-align:right}
    .helpcard .helpnote{color:var(--lavender)}
    .helpbtns{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
    .helpbtn{flex:1 1 40%;min-height:46px;padding:0 10px;border:1px solid #3d3e49;color:var(--label);font:inherit;letter-spacing:inherit;text-transform:inherit;line-height:1.2}
    .helpbtn[data-kind=sync]{flex-basis:100%}
    .helpbtn:active{border-color:var(--lavender);color:var(--lavender)}
    .helpbtn:disabled{color:#505157;border-color:#2a2b33;cursor:default}
  '''
assert out.count('</style>') == 1
out = out.replace('</style>', css.rstrip(' ') + '</style>', 1)

markup = '''  <button class="qbtn" id="qbtn" type="button" aria-label="Help" aria-expanded="false" aria-controls="help"><span class="ring"><span class="q" aria-hidden="true">?</span><svg class="x" viewBox="0 0 9 9" aria-hidden="true"><path d="M.8.8l7.4 7.4M8.2.8.8 8.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></span></button>
  <aside class="help" id="help" hidden role="dialog" aria-modal="true" aria-label="Help"><div class="helpcard" id="helpcard" tabindex="-1"></div></aside>

'''
i = out.index('  <script>')
out = out[:i] + markup + out[i:]
open(R + 'index.html', 'w').write(out)

for f in ('geist-mono-ui.woff2', 'geist-mono-LICENSE.txt'):
    shutil.copyfile(R + 'prototype/' + f, R + f)

# stamp the service worker with a hash of what it caches
sw = open(R + 'sw.js').read()
shell = re.search(r"const SHELL = \[(.*?)\];", sw, re.S).group(1)
files = [f for f in re.findall(r"'([^']+)'", shell) if f != './']
h = hashlib.sha1()
for f in files: h.update(f.encode()); h.update(open(R + f, 'rb').read())
stamp = h.hexdigest()[:10]
sw = re.sub(r"const CACHE = 'mood2-[^']*';", "const CACHE = 'mood2-%s';" % stamp, sw)
open(R + 'sw.js', 'w').write(sw)
print('index.html', len(out), 'bytes; cache', stamp, '; files', files)
