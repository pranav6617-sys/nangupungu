import os
HERE = os.path.dirname(os.path.abspath(__file__))   # …/mood2/source
R = os.path.dirname(HERE) + '/'                         # …/mood2/
P = R + 'prototype/'
src = open(P + 'stipple.html').read()
tpl = open(HERE + '/note.template.html').read()
blobs = open(HERE + '/blobs.template.html').read()

style = src.split('<style>', 1)[1].split('</style>', 1)[0]
style = '\n'.join(l for l in style.split('\n') if not l.lstrip().startswith('.axis'))
style = style.replace('/* Labels only need eight capital letters, so the font is cut down to a few kilobytes. */',
                      '/* The font is cut down to the few letters the screens use, so it is a few kilobytes. */')

a = src.index('    const TAU = Math.PI * 2;')
b = src.index('\n', src.index('    const LAB = {')) + 1
helpers = src[a:b]


# The words for the three questions and the sentence rule live in one place: the screen-two template.
a = blobs.index('    // The three questions, from 1 (bottom)'); b = blobs.index('    /*lanes:end*/') + len('    /*lanes:end*/')
lanes = blobs[a:b]
a = blobs.index('    // The sentence at the top. Phrases go in lane order.'); b = blobs.index('    /*compose:end*/') + len('    /*compose:end*/')
compose = blobs[a:b]

out = (tpl.replace('/*@STYLE*/', style.strip('\n')).replace('/*@LANES*/', lanes + '\n\n' + compose)
          .replace('/*@HELPERS*/', helpers))
assert '/*@' not in out
open(P + 'note.html', 'w').write(out)
assert 'url(geist-mono-ui.woff2)' in out
print('note.html', len(out), 'bytes')
