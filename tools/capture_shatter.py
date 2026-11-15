"""Dev helper: unlock and capture frames of the shatter animation as one montage image (tools/shatter.png)."""
import os
from playwright.sync_api import sync_playwright
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1100, 'height': 620}).new_page()
    pg.goto('file://' + os.path.join(HERE, '..', 'dist', 'index.html')); pg.wait_for_timeout(1800)
    pg.fill('#pw', 'correct horse battery'); pg.fill('#pw2', 'correct horse battery'); pg.click('#unlockb'); pg.wait_for_selector('#lock.cracking', timeout=20000)
    pg.wait_for_selector('.shards', state='attached', timeout=5000)
    frames = []
    # freeze every shard animation and step through it at fixed times, so frames are deterministic
    for i, t in enumerate([60, 220, 420, 650, 900, 1200]):
        pg.evaluate("(t) => document.querySelectorAll('.shards *').forEach(el => el.getAnimations().forEach(a => { a.pause(); a.currentTime = t; }))", t)
        path = os.path.join(HERE, f'_f{i}.png'); pg.screenshot(path=path); frames.append(Image.open(path).resize((550, 310))); os.remove(path)
    m = Image.new('RGB', (550 * 3, 310 * 2)); [m.paste(f, ((i % 3) * 550, (i // 3) * 310)) for i, f in enumerate(frames)]; m.save(os.path.join(HERE, 'shatter.png')); b.close()
