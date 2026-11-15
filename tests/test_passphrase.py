"""Change passphrase: validation, single device, cloud rollback, and a second device re-joining."""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
import json
from playwright.sync_api import sync_playwright
from fakedb import URL, STORE, FAIL, dbop, FAKE
P1, P2 = 'correct horse battery', 'purple elephant dancing 42'
def device(b, sync=True):
    ctx = b.new_context(viewport={'width':1280,'height':720})
    if sync: ctx.expose_function('__dbop', dbop)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    if sync: pg.add_init_script(FAKE)
    return pg, errs
def create(pg, pw):
    pg.goto(URL); pg.wait_for_timeout(1800); pg.fill('#pw', pw); pg.fill('#pw2', pw); pg.click('#unlockb'); pg.wait_for_selector('#lock', state='hidden', timeout=20000); pg.wait_for_timeout(1500)
def unlock(pg, pw, expect_ok=True):
    pg.fill('#pw', pw); pg.click('#unlockb')
    if expect_ok: pg.wait_for_selector('#lock', state='hidden', timeout=20000); pg.wait_for_timeout(800)
    else: pg.wait_for_timeout(2500)
def change(pg, cur, nw, nw2=None, wait=4500):
    if not pg.is_visible('#chpanel'):
        pg.click('#setb') if not pg.is_visible('#setbox') else None
        pg.click('#chtog')
    pg.fill('#chcur', cur); pg.fill('#chnew', nw); pg.fill('#chnew2', nw if nw2 is None else nw2); pg.click('#chgo'); pg.wait_for_timeout(wait)
    return pg.inner_text('#chm')
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- single device, no sync ----------
    S, es = device(b, sync=False); create(S, P1)
    S.click('#newb'); S.fill('#body', 'SECRET777 body'); S.wait_for_timeout(1200)
    S.click('#setb')
    S.click('#chtog'); print('panel open:', S.is_visible('#chpanel'))
    print('1. wrong current ->', change(S, 'not the pass', P2, wait=3500))
    print('2. short new     ->', change(S, P1, 'abc', wait=300))
    print('3. same as old   ->', change(S, P1, P1, wait=300))
    print('4. mismatch      ->', change(S, P1, P2, 'other', wait=300))
    print('5. success: msg=', repr(change(S, P1, P2, wait=6000)), '| panel closed:', not S.is_visible('#chpanel'), '| toast:', S.inner_text('#toast'))
    raw = S.evaluate("localStorage.getItem('water-vault-v1')"); print('   no plaintext in vault:', 'SECRET777' not in raw)
    S.reload(); S.wait_for_timeout(900); unlock(S, P1, expect_ok=False); print('6. old passphrase after change ->', S.inner_text('#lm'))
    S.wait_for_timeout(200); unlock(S, P2); print('   new passphrase works, secret note present:', S.locator('.item', has_text='SECRET777').count() == 1)
    print('   errors:', es)
    # ---------- two devices with sync ----------
    A, ea = device(b); create(A, P1); A.click('#newb'); A.fill('#body', 'ALPHA note\nx'); A.wait_for_timeout(2500)
    old_salt = STORE[[k for k in STORE if k.endswith('/meta')][0]]['salt']
    B, eb = device(b); B.goto(URL); B.wait_for_timeout(2000); unlock(B, P1); B.wait_for_timeout(1500)
    print('7. B joined, notes:', B.eval_on_selector_all('.item .it', 'e => e.map(x => x.textContent)'))
    # rollback: fail the cloud update halfway
    FAIL['after'] = 2
    print('8. cloud fails halfway ->', change(A, P1, P2, wait=9000)); FAIL['after'] = None
    meta = STORE[[k for k in STORE if k.endswith('/meta')][0]]
    print('   cloud meta restored to old salt:', meta['salt'] == old_salt, '| A still unlocked & old vault usable:', A.evaluate("!document.getElementById('lock').offsetParent") )
    # real change
    print('9. change with sync ->', repr(change(A, P1, P2, wait=9000)), '|', A.inner_text('#toast'))
    meta = STORE[[k for k in STORE if k.endswith('/meta')][0]]
    cloud = json.dumps(STORE); print('   cloud meta changed:', meta['salt'] != old_salt, '| prev points to old salt:', meta.get('prev') == old_salt, '| no plaintext in cloud:', 'ALPHA' not in cloud)
    B.wait_for_timeout(2500)
    print('10. B toast:', B.inner_text('#toast'), '| sync status:', B.evaluate("document.getElementById('syncst').textContent"))
    B.click('#toast button'); B.wait_for_timeout(2000)
    print('    B shows lock (join mode):', B.is_visible('#lock'), B.inner_text('#lt'))
    unlock(B, P1, expect_ok=False); print('    old passphrase on B ->', B.inner_text('#lm'))
    B.wait_for_timeout(500); unlock(B, P2); B.wait_for_timeout(1500)
    print('    B with new passphrase, notes:', B.eval_on_selector_all('.item .it', 'e => e.map(x => x.textContent)'))
    B.click('#newb'); B.fill('#body', 'BRAVO after change\nz'); B.wait_for_timeout(2500); A.wait_for_timeout(2500)
    print('11. A gets B note after the change:', A.eval_on_selector_all('.item .it', 'e => e.map(x => x.textContent)'))
    print('errors A:', ea, '| B:', eb); b.close()
