"""The CSP build must run the whole flow without a single policy violation, and must not allow network access."""
import os, re
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'index.secure.html')
PASS = 'correct horse battery'
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1280, 'height': 720}).new_page(); problems = []
    pg.on('pageerror', lambda e: problems.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: problems.append(m.text) if m.type in ('error', 'warning') else None)
    pg.goto(URL); pg.wait_for_timeout(1500)
    pg.fill('#pw', PASS); pg.fill('#pw2', PASS); pg.click('#unlockb'); pg.wait_for_selector('#lock', state='hidden', timeout=20000); pg.wait_for_timeout(1200)
    pg.click('#newb'); pg.fill('#body', 'CSP test note\nbody'); pg.click('#poolb'); pg.wait_for_timeout(800)
    pg.click('#lockb'); pg.wait_for_timeout(1600); pg.fill('#pw', PASS); pg.click('#unlockb'); pg.wait_for_selector('#lock', state='hidden', timeout=20000); pg.wait_for_timeout(2500)
    before_probe = list(problems)
    csp = pg.evaluate("document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
    blocked = pg.evaluate("fetch('https://example.com').then(() => 'ALLOWED', () => 'blocked')")
    print('policy:', csp[:140], '...')
    print('network request from the page:', blocked)
    print('unsafe-inline / unsafe-eval present:', "'unsafe-inline'" in csp or "'unsafe-eval'" in csp)
    print('CSP violations or errors during create, pool, lock, shatter, unlock:', before_probe or 'none')
    assert blocked == 'blocked' and not before_probe
    b.close()
