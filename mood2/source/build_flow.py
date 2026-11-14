import os
HERE = os.path.dirname(os.path.abspath(__file__))   # …/mood2/source
R = os.path.dirname(HERE) + '/'                         # …/mood2/
P = R + 'prototype/'
one = open(P + 'stipple.html').read()
two = open(P + 'blobs.html').read()

css = two.split('/* screen two: the title and the three lanes */', 1)[1].split('</style>', 1)[0]
css = '/* screen two: the title and the three lanes */' + css.rstrip() + '\n  '
m0 = two.index('  <main class="heart pad" id="pad">'); m1 = two.index('</main>', m0) + len('</main>')
pad = two[m0:m1].replace('class="heart pad"', 'class="heart pad off"')
s0 = two.index('  <script>'); s1 = two.rindex('</script>') + len('</script>')
script2 = two[s0:s1]

three = open(P + 'note.html').read()
css3 = '/* screen three: a flat grey block on the still grid' + three.split('/* screen three: a flat grey block on the still grid', 1)[1].split('</style>', 1)[0].rstrip() + '\n  '
n0 = three.index('  <main class="heart note" id="note">'); n1 = three.index('</main>', n0) + len('</main>')
note = three[n0:n1].replace('class="heart note"', 'class="heart note off"')
t0 = three.index('  <script>'); t1 = three.rindex('</script>') + len('</script>')
script3 = three[t0:t1]

router = '''  <script>
  // The flow: screen one, screen two, then screen three. Screens swap with a plain cut for now; the animation between them comes last.
  (() => {
    const one = document.getElementById('heart'), two = document.getElementById('pad'), three = document.getElementById('note');
    let at = 'one', sel = null, pad = null;
    const f1 = window.__f1, f2 = window.__f2, f3 = window.__noteFrame;
    if (f1 && f2 && f3) window.__heartFrame = () => (at === 'one' ? f1() : at === 'two' ? f2() : f3());
    one.addEventListener('mood:continue', e => { sel = e.detail; at = 'two'; window.screenOne.pause(); window.screenTwo.show(sel); });
    two.addEventListener('pad:back', () => { at = 'one'; window.screenTwo.hide(); window.screenOne.resume(); });
    two.addEventListener('pad:continue', e => { pad = e.detail; at = 'three'; window.screenTwo.hide(); window.screenThree.show(sel, pad); });
    three.addEventListener('note:back', () => { at = 'two'; window.screenThree.hide(); window.screenTwo.show(sel); });
    three.addEventListener('note:save', e => {
      // Nothing is stored yet. The finished check-in is kept here for the data step, and the app starts a fresh one.
      window.moodFlowDone = { selection: sel, pad, note: e.detail.text, summary: e.detail.summary };
      window.screenThree.hide(); window.screenThree.reset(); window.screenTwo.reset(); window.screenOne.reset();
      at = 'one'; sel = null; pad = null; window.screenOne.resume();
    });
    window.moodFlow = { at: () => at };
  })();
  </script>'''

out = one.replace('  </style>', css + css3 + '</style>', 1)
out = out.replace('  </main>\n\n  <script>', '  </main>\n' + pad + '\n' + note + '\n\n  <script>', 1)
end = out.rindex('</script>') + len('</script>')
out = out[:end] + '\n  <script>window.__f1 = window.__heartFrame; window.__FLOW = true;</script>\n' + script2 + '\n  <script>window.__f2 = window.__heartFrame;</script>\n' + script3 + '\n' + router + out[end:]
out = out.replace('<title>', '<title>Flow · ', 1) if '<title>' in out else out
open(P + 'flow.html', 'w').write(out)
assert 'url(geist-mono-ui.woff2)' in out
print('flow.html', len(out), 'bytes')
