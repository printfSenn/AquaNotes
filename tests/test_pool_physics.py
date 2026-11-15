"""Pool view: the floating paper must react to the water (tilt, drift, twist), stay put when pinned, and never be frozen."""
import sys, os, re, math
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from fakedb import URL
PASS = 'correct horse battery'
READ = """() => Array.from(document.querySelectorAll('.card')).map(el => { const t = el.firstChild.style.transform || '';
  const num = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : 0; };
  return { id: el.dataset.id || el.querySelector('.ct').textContent, x: num(/translate\\(([-\\d.]+)px/), y: num(/translate\\([-\\d.]+px,([-\\d.]+)px/),
    rx: num(/rotateX\\(([-\\d.]+)deg/), ry: num(/rotateY\\(([-\\d.]+)deg/), rz: num(/rotateZ\\(([-\\d.]+)deg/),
    left: parseFloat(el.style.left), top: parseFloat(el.style.top), title: el.querySelector('.ct').textContent }; })"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1280, 'height': 720}).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1800); pg.fill('#pw', PASS); pg.fill('#pw2', PASS); pg.click('#unlockb'); pg.wait_for_selector('#lock', state='hidden', timeout=20000); pg.wait_for_timeout(1000)
    for name in ['Alpha card', 'Bravo card', 'Pinned card']:
        pg.click('#newb'); pg.fill('#body', name + '\nbody'); pg.wait_for_timeout(450)
    pg.locator('.item', has_text='Pinned card').click(); pg.click('#pinb'); pg.wait_for_timeout(300)
    pg.click('#poolb'); pg.wait_for_timeout(500); pg.click('#tog'); pg.wait_for_timeout(300)
    if pg.is_visible('.app'): pg.click('#tog')
    # place the cards at known spots by dragging them
    def drag(title, x, y):
        c = pg.locator('.card', has_text=title); bb = c.bounding_box()
        pg.mouse.move(bb['x'] + 20, bb['y'] + 15); pg.mouse.down(); pg.mouse.move(x, y, steps=8); pg.mouse.up(); pg.wait_for_timeout(250)
    drag('Alpha', 500, 330); drag('Bravo', 1000, 200); drag('Pinned', 300, 560); pg.wait_for_timeout(1500)
    if pg.is_visible('.app'): pg.click('#tog')
    pg.wait_for_timeout(800)
    idle = [pg.evaluate(READ) for _ in range(6) if not pg.wait_for_timeout(180)]
    a = lambda snap, t: [c for c in snap if t in c['title']][0]
    swing = max(abs(a(s, 'Alpha')['rz'] - a(idle[0], 'Alpha')['rz']) + abs(a(s, 'Alpha')['y'] - a(idle[0], 'Alpha')['y']) for s in idle)
    print('1. idle: card still moves a little (bob/sway):', round(swing, 2) > 0.05, f'({swing:.2f})')
    start = {t: a(pg.evaluate(READ), t) for t in ['Alpha', 'Bravo', 'Pinned']}
    ac = pg.locator('.card', has_text='Alpha').bounding_box(); cx, cy = ac['x'] + ac['width'] / 2, ac['y'] + ac['height'] / 2
    pg.mouse.click(cx - 175, cy + 40)                      # a click in the water, ~180px from the card
    pg.wait_for_timeout(450); pg.screenshot(path=os.path.join(os.path.dirname(__file__), '..', 'docs', 'floating-paper.png'), clip={'x': 150, 'y': 100, 'width': 1000, 'height': 520})
    peak_tilt = peak_drift = peak_twist = 0; pinned_drift = 0
    for _ in range(30):
        pg.wait_for_timeout(100); snap = pg.evaluate(READ); al = a(snap, 'Alpha'); pn = a(snap, 'Pinned')
        peak_tilt = max(peak_tilt, abs(al['rx']), abs(al['ry'])); peak_twist = max(peak_twist, abs(al['rz']))
        peak_drift = max(peak_drift, math.hypot(al['x'], al['y'])); pinned_drift = max(pinned_drift, math.hypot(pn['x'], pn['y']))
    pg.wait_for_timeout(3500); end = a(pg.evaluate(READ), 'Alpha')
    moved = math.hypot((end['left'] - start['Alpha']['left']) + end['x'], (end['top'] - start['Alpha']['top']) + end['y'])
    print(f'2. click ~180px away: peak tilt {peak_tilt:.1f} deg | peak twist {peak_twist:.1f} deg | peak drift {peak_drift:.1f}px | ended {moved:.1f}px from where it was')
    away = (end['left'] - start['Alpha']['left'] + end['x']) < 0
    print('   pushed away from the click (to the right):', (end['left'] - start['Alpha']['left'] + end['x']) > 0, '| pinned card moved:', round(pinned_drift, 1), 'px (should be ~0)')
    saved = pg.evaluate("Math.abs(parseFloat(document.querySelector('.card:nth-child(1)').style.left) || 0) > 0")
    # the mouse wake
    s0 = a(pg.evaluate(READ), 'Bravo'); bc = pg.locator('.card', has_text='Bravo').bounding_box()
    for _ in range(4):
        pg.mouse.move(bc['x'] - 120, bc['y'] + 90); pg.mouse.move(bc['x'] - 120, bc['y'] - 60, steps=6)
    wake_tilt = 0
    for _ in range(12): pg.wait_for_timeout(100); r = a(pg.evaluate(READ), 'Bravo'); wake_tilt = max(wake_tilt, abs(r['rx']), abs(r['ry']), abs(r['rz']))
    print(f'3. mouse sweeping near a card: tilt/twist reached {wake_tilt:.1f} deg')
    print('errors:', errs); b.close()
