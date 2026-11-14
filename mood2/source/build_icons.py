# The app icon: the dot field from the first screen, with the four mood colours gathered in the middle.
import math
from PIL import Image, ImageDraw
import os
HERE = os.path.dirname(os.path.abspath(__file__))   # …/mood2/source
R = os.path.dirname(HERE) + '/'                         # …/mood2/
BG = (16, 17, 22); GREY = (112, 114, 140)
RED, GOLD, BLUE, MINT = (244, 92, 84), (245, 196, 104), (122, 146, 255), (108, 230, 174)
S = 512; PITCH = 36; N = 6                  # lattice runs -N..N around the centre
RMAX = 188                                   # inside the circle that a round launcher mask keeps (205)
def lerp(a, b, t): return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
dots = []
for j in range(-N, N + 1):
    for i in range(-N, N + 1):
        dx, dy = i * PITCH, j * PITCH; r = math.hypot(dx, dy)
        if r > RMAX: continue
        u = (dx / RMAX + 1) / 2; e = (-dy / RMAX + 1) / 2                      # pleasant to the right, energy up
        w = [((1 - u) * e) ** 2.6, (u * e) ** 2.6, ((1 - u) * (1 - e)) ** 2.6, (u * (1 - e)) ** 2.6]; t = sum(w) or 1   # sharp, as on the first screen
        col = tuple(sum(w[q] * (RED, GOLD, BLUE, MINT)[q][k] for q in range(4)) / t for k in range(3))
        c = math.exp(-(r / (0.62 * RMAX)) ** 2)                                  # how much of the cluster this dot is in
        base = lerp(GREY, col, min(1, c * 1.7))
        rad = 3.2 + 9.8 * c
        a = 0.38 + 0.62 * min(1, c * 1.5)
        fade = 1 - 0.35 * (r / RMAX) ** 2
        mix = tuple(BG[k] + (base[k] - BG[k]) * a * fade for k in range(3))
        dots.append((S / 2 + dx, S / 2 + dy, rad, tuple(int(round(v)) for v in mix)))
def png(size, path):
    k = 4; im = Image.new('RGB', (S * k, S * k), BG); d = ImageDraw.Draw(im)
    for x, y, rad, col in dots: d.ellipse([(x - rad) * k, (y - rad) * k, (x + rad) * k, (y + rad) * k], fill=col)
    im.resize((size, size), Image.LANCZOS).save(path, optimize=True)
png(512, R + 'icon-512.png'); png(192, R + 'icon-192.png'); png(512, R + 'icon-maskable-512.png')
svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d"><rect width="%d" height="%d" fill="#101116"/>' % (S, S, S, S)]
for x, y, rad, col in dots: svg.append('<circle cx="%.1f" cy="%.1f" r="%.2f" fill="#%02x%02x%02x"/>' % (x, y, rad, *col))
svg.append('</svg>')
open(R + 'icon.svg', 'w').write(''.join(svg))
print(len(dots), 'dots')
