"""Floating paper: texture, rough edge, per-note looks, pin for pinned notes, and the favicon links."""
import sys, os, datetime
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from fakedb import URL
HERE = os.path.dirname(os.path.abspath(__file__))
PASS = 'correct horse battery'
def day(n): return (datetime.date.today() + datetime.timedelta(days=n)).isoformat()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1800); pg.fill('#pw', PASS); pg.fill('#pw2', PASS); pg.click('#unlockb'); pg.wait_for_selector('#lock', state='hidden', timeout=20000); pg.wait_for_timeout(1000)
    notes = [('Catatan kuliah', 'Statistika bab 4\nrangkuman rumus', None), ('Belanja', 'susu, roti, telur', None), ('Ide proyek', 'bot discord baru', None), ('Laporan basis data', 'ERD dan normalisasi', day(2)), ('Tugas telat', 'kumpul kemarin', day(-1)), ('Dipin', 'jangan hilang', None)]
    for t, body, due in notes:
        pg.click('#newb'); pg.fill('#body', t + '\n' + body)
        if due: pg.fill('#due', due); pg.evaluate("document.getElementById('due').dispatchEvent(new Event('change'))")
        pg.wait_for_timeout(450)
    pg.locator('.item', has_text='Dipin').click(); pg.click('#pinb'); pg.wait_for_timeout(300)
    pg.click('#poolb'); pg.wait_for_timeout(600)
    if pg.is_visible('.app'): pg.click('#tog')
    pg.wait_for_timeout(500)
    # lay them out on a grid so a screenshot shows every one
    cards = pg.locator('.card'); n = cards.count()
    for i in range(n):
        bb = cards.nth(i).bounding_box(); pg.mouse.move(bb['x'] + 20, bb['y'] + 15); pg.mouse.down(); pg.mouse.move(130 + (i % 4) * 260, 170 + (i // 4) * 170, steps=6); pg.mouse.up(); pg.wait_for_timeout(120)
    pg.wait_for_timeout(2500)
    info = pg.evaluate("""() => ({ paperVar: !!document.documentElement.style.getPropertyValue('--paper'),
      cards: Array.from(document.querySelectorAll('.card')).map(el => { const c = el.firstChild, cs = getComputedStyle(c), bs = getComputedStyle(c, '::before');
        return { clip: cs.clipPath.startsWith('polygon'), tex: bs.backgroundImage.startsWith('url'), bg: c.style.background.length, pin: getComputedStyle(c.querySelector('.pin')).display }; }) })""")
    print('paper texture set:', info['paperVar'], '| cards:', len(info['cards']))
    print('every card has a rough-edge outline:', all(c['clip'] for c in info['cards']), '| every card has the paper texture layer:', all(c['tex'] for c in info['cards']), '| exactly one pin:', sum(c['pin'] == 'block' for c in info['cards']))
    print('favicon links in page:', pg.evaluate("Array.from(document.querySelectorAll('link[rel=icon],link[rel=apple-touch-icon]')).map(l => l.rel + ' ' + l.href.slice(0, 22))"))
    pg.screenshot(path=os.path.join(HERE, '..', 'docs', 'paper-cards.png'), clip={'x': 60, 'y': 110, 'width': 1100, 'height': 420})
    print('errors:', errs); b.close()
