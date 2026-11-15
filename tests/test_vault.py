"""Vault, lock, deadlines and auto-lock on a single device (no cloud)."""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
import json, datetime
from playwright.sync_api import sync_playwright
from fakedb import URL
PASS = 'correct horse battery'
def day(n): return (datetime.date.today() + datetime.timedelta(days=n)).isoformat()
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':1280,'height':720}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    # legacy plaintext data from the old version
    pg.add_init_script("if(!localStorage.getItem('water-vault-v1') && !localStorage.getItem('__seeded')){localStorage.setItem('__seeded','1');localStorage.setItem('water-notes-v1', JSON.stringify([{id:'old1',body:'Legacy note\\nplain text',tags:['rahasia'],updated:Date.now()}])); localStorage.setItem('water-notes-prefs-v1', JSON.stringify({theme:'water',tagColors:{rahasia:'#ff6b6b'}}));}")
    pg.goto(URL); pg.wait_for_timeout(700)
    print('1. lock visible:', pg.is_visible('#lock'), '| title:', pg.inner_text('#lt'), '| app inert:', pg.evaluate("document.querySelector('.app').inert"))
    pg.fill('#pw', 'short'); pg.fill('#pw2', 'short'); pg.click('#unlockb'); print('   short pass ->', pg.inner_text('#lm'))
    pg.fill('#pw', PASS); pg.fill('#pw2', 'different pass'); pg.click('#unlockb'); print('   mismatch ->', pg.inner_text('#lm'))
    pg.fill('#pw2', PASS); pg.click('#unlockb'); pg.wait_for_selector('#lock', state='hidden', timeout=20000); pg.wait_for_timeout(1500)
    raw = pg.evaluate("localStorage.getItem('water-vault-v1')"); keys = pg.evaluate("Object.keys(localStorage)")
    print('2. unlocked | items:', pg.locator('.item').count(), '| legacy migrated:', 'Legacy note' in pg.inner_text('#list'), '| keys:', keys)
    print('   vault has no plaintext:', all(w not in raw for w in ['Legacy', 'plain text', 'rahasia', 'Welcome']), '| prefs has no tag names:', 'rahasia' not in pg.evaluate("localStorage.getItem('water-notes-prefs-v1')"))
    # a secret note
    pg.click('#newb'); pg.fill('#body', 'SECRET123 top secret\nmore'); pg.fill('#tags', 'privat'); pg.wait_for_timeout(1500)
    raw = pg.evaluate("localStorage.getItem('water-vault-v1')")
    print('3. secret not in storage:', 'SECRET123' not in raw and 'privat' not in raw)
    # deadlines in pool view
    pg.click('#poolb'); pg.wait_for_timeout(300)
    pg.locator('.card', has_text='SECRET123').click(); pg.wait_for_timeout(200)
    res = {}
    for label, dd in [('tomorrow', day(1)), ('in 5 days', day(5)), ('in 40 days', day(40)), ('overdue 2d', day(-2))]:
        pg.fill('#due', dd); pg.evaluate("document.getElementById('due').dispatchEvent(new Event('change'))"); pg.wait_for_timeout(250)
        res[label] = pg.eval_on_selector('.card:has-text("SECRET123")', 'e => [e.querySelector(".cm").textContent, e.style.opacity, e.style.getPropertyValue("--d")]')
    print('4. deadline wetness [label, opacity, depth]:'); [print('   ', k, v) for k, v in res.items()]
    # lock and check DOM wiped
    pg.click('#lockb'); pg.wait_for_timeout(1600)
    txt = pg.evaluate("document.body.innerText + '|' + Array.from(document.querySelectorAll('textarea,input')).map(e=>e.value).join('|') + '|' + document.querySelectorAll('.card').length")
    print('5. locked:', pg.is_visible('#lock'), '| secret gone from page:', 'SECRET123' not in txt and 'Legacy' not in txt, '| cards left:', txt.split('|')[-1], '| app inert:', pg.evaluate("document.querySelector('.app').inert"))
    pg.screenshot(path='/tmp/ice.png')
    # wrong then right passphrase
    for i in range(3):
        pg.fill('#pw', 'nope nope nope'); pg.click('#unlockb'); pg.wait_for_timeout(1800)
    print('6. wrong x3 ->', pg.inner_text('#lm'))
    pg.evaluate("window.__fix = 1")
    pg.wait_for_timeout(5000)   # let the wrong-passphrase wait expire (slow machines take longer to derive keys)
    pg.fill('#pw', PASS); pg.click('#unlockb'); pg.wait_for_timeout(2500)
    print('   still locked after block?', pg.is_visible('#lock'), '|', pg.inner_text('#lm') if pg.is_visible('#lock') else '')
    if pg.is_visible('#lock'):
        pg.wait_for_timeout(5000); pg.fill('#pw', PASS); pg.click('#unlockb')
    pg.wait_for_selector('#lock', state='hidden', timeout=20000); pg.wait_for_timeout(500)
    print('7. unlocked again, notes:', pg.locator('.card').count(), '| SECRET back:', pg.locator('.card', has_text='SECRET123').count() == 1)
    # reload -> unlock mode
    pg.reload(); pg.wait_for_timeout(800); print('8. after reload:', pg.inner_text('#lt'), '| visible:', pg.is_visible('#lock'))
    pg.fill('#pw', PASS); pg.click('#unlockb'); pg.wait_for_selector('#lock', state='hidden', timeout=20000); print('   unlock ok, cards:', pg.locator('.card').count() or pg.locator('.item').count())
    # auto-lock
    pg.evaluate("(()=>{const r=Date.now; Date.now=()=>r()+6*60000})()"); pg.wait_for_timeout(6500)
    print('9. auto-lock after idle:', pg.is_visible('#lock'))
    print('errors:', errs); b.close()
