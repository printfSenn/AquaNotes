"""Two devices sharing one (fake) cloud: join, merge, delete, tampered docs, delete cloud copy."""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
import json
from playwright.sync_api import sync_playwright
from fakedb import URL, STORE, dbop, FAKE
PASS = 'correct horse battery'
def device(browser):
    ctx = browser.new_context(viewport={'width':1280,'height':720}); ctx.expose_function('__dbop', dbop)
    pg = ctx.new_page(); pg.add_init_script(FAKE); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); return pg, errs
with sync_playwright() as p:
    b = p.chromium.launch()
    A, ea = device(b); A.goto(URL); A.wait_for_timeout(1500)
    print('A: lock mode:', A.inner_text('#lt'))
    A.fill('#pw', PASS); A.fill('#pw2', PASS); A.click('#unlockb'); A.wait_for_selector('#lock', state='hidden', timeout=20000); A.wait_for_timeout(2500)
    A.click('#newb'); A.fill('#body', 'ALPHA from device A\nhello'); A.fill('#tags', 'sync'); A.wait_for_timeout(2500)
    cloud = json.dumps(STORE)
    print('A: cloud docs:', sorted(k.split('/')[-1] for k in STORE), '| plaintext leaked to cloud:', any(w in cloud for w in ['ALPHA', 'hello', 'sync"', 'Welcome']))
    print('A: sync status:', A.evaluate("document.getElementById('syncst').textContent"))
    # device B: fresh browser, same account
    B, eb = device(b); B.goto(URL); B.wait_for_timeout(2000)
    print('B: lock mode:', B.inner_text('#lt'), '(should be synced vault)')
    B.fill('#pw', 'wrong wrong wrong'); B.click('#unlockb'); B.wait_for_timeout(2500); print('B: wrong pass ->', B.inner_text('#lm'))
    B.fill('#pw', PASS); B.click('#unlockb'); B.wait_for_selector('#lock', state='hidden', timeout=20000); B.wait_for_timeout(1500)
    print('B: notes after join:', B.eval_on_selector_all('.item .it', 'e => e.map(x => x.textContent)'))
    # B edits and adds, A should receive
    B.click('#newb'); B.fill('#body', 'BRAVO from device B\nworld'); B.wait_for_timeout(2500)
    A.wait_for_timeout(2500)
    print('A receives B note:', A.eval_on_selector_all('.item .it', 'e => e.map(x => x.textContent)'))
    # A deletes BRAVO -> B removes it
    A.locator('.item', has_text='BRAVO').click(); A.click('#delb'); A.click('#delb'); A.wait_for_timeout(2500); B.wait_for_timeout(2500)
    print('A after delete:', A.eval_on_selector_all('.item .it', 'e => e.map(x => x.textContent)'))
    print('B after A deleted BRAVO:', B.eval_on_selector_all('.item .it', 'e => e.map(x => x.textContent)'))
    # deadline syncs too
    A.locator('.item', has_text='ALPHA').click(); A.fill('#due', '2030-01-15'); A.evaluate("document.getElementById('due').dispatchEvent(new Event('change'))"); A.wait_for_timeout(2500); B.wait_for_timeout(2500)
    B.locator('.item', has_text='ALPHA').click(); print('B sees deadline from A:', B.input_value('#due'))
    # lock A: cloud sync stops, nothing readable; tampered doc ignored
    key = [k for k in STORE if k.endswith('/meta')][0]
    STORE[key.replace('meta', 'n_evil')] = {'u': 9999999999999, 'iv': 'AAAAAAAAAAAAAAAA', 'ct': 'AAAA'}
    B.wait_for_timeout(1500); print('B ignores corrupt/tampered cloud doc, notes still:', B.locator('.item').count())
    # delete cloud copy
    B.click('#setb'); B.click('#delcloud'); B.click('#delcloud'); B.wait_for_timeout(1500)
    print('cloud docs after delete:', len(STORE), '|', B.evaluate("document.getElementById('syncst').textContent"))
    print('errors A:', ea, '| B:', eb); b.close()
