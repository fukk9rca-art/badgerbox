#!/usr/bin/env python3
"""Turn the screen sources in screens/ into the site's pages.

    python3 tools/build.py

Each screens/<Name>.dc.html is the design's source for one screen. This swaps
the design runtime for js/dc-lite.js, points links at the real page names and
lets the fixed 1440x1040 frames fill the browser window.
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = {
    'Landing.dc.html': 'index.html',
    'Enter.dc.html': 'enter.html',
    'MonoTerminal.dc.html': 'app.html',
    'Results.dc.html': 'walkthrough.html',
    'States.dc.html': 'states.html',
}
HEAD = (
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<link rel="icon" href="favicon.svg" type="image/svg+xml">\n'
    '<link rel="stylesheet" href="css/site.css">\n'
    '<script src="vendor/morphdom-umd.min.js" defer></script>\n'
    '<script src="js/bb-api.js" defer></script>\n'
    '<script src="js/bb-plot.js" defer></script>\n'
    '<script src="js/dc-lite.js" defer></script>'
)


def convert(src, dst):
    page = os.path.basename(dst)
    s = io.open(src, encoding='utf-8').read()
    s = s.replace('<script src="./support.js"></script>', HEAD, 1)
    # keep the raw template out of the live page until the runtime renders it
    s = s.replace('<x-dc>', '<template data-dc>', 1).replace('</x-dc>', '</template>', 1)
    s = s.replace('<html lang="en">', '<html lang="en" data-page="%s">' % page[:-5], 1)
    for a, b in PAGES.items():
        s = s.replace('href="%s"' % a, 'href="%s"' % b)
    if page == 'states.html':
        s = s.replace('width: 1440px; height: 1040px;', 'width: 100%; min-height: 100vh;', 1)
    else:
        s = s.replace('width: 1440px; height: 1040px;', 'width: 100%; height: 100vh;', 1)
    s = '<!-- generated from screens/%s by tools/build.py, edit the screen, not this file -->\n%s' % (
        os.path.basename(src), s)
    io.open(dst, 'w', encoding='utf-8').write(s)


if __name__ == '__main__':
    for name, page in PAGES.items():
        convert(os.path.join(ROOT, 'screens', name), os.path.join(ROOT, page))
        print('screens/%s -> %s' % (name, page))
