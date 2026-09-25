#!/usr/bin/env python3
# Regenerates examples/klabak/public/og-image.png (1200x630 @2x).
#
# Takes a screenshot of the real cabinet while a demo round is winning, then
# composes the social card around it. Needs the dev server on :3200
# (`npm run start:klabak`) and playwright + chromium.
#
#   python3 tools/make-og-card.py
#
# The card is rendered at 2x for crisp text and then resampled to exactly
# 1200x630, which is the size the og:image meta tags declare. Needs Pillow.

import asyncio, base64, pathlib
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1150, "height": 900}, device_scale_factor=2)
        pg = await ctx.new_page()
        await pg.goto("http://127.0.0.1:3200/", wait_until="domcontentloaded")
        await pg.wait_for_timeout(2500)
        shot = None
        for attempt in range(30):
            await pg.click(".kl-pull")
            for _ in range(40):
                if await pg.locator(".kl-banner").count():
                    txt = await pg.inner_text(".kl-banner")
                    if "×" in txt:
                        await pg.wait_for_timeout(800)
                        el = pg.locator(".kl-stage")
                        box = await el.bounding_box()
                        print(f"menang: {txt.replace(chr(10),' | ')}  stage {box['width']:.0f}x{box['height']:.0f}")
                        await el.screenshot(path="/tmp/stage.png")
                        shot = txt
                    break
                await pg.wait_for_timeout(140)
            if shot:
                break
            await pg.wait_for_timeout(900)
        if not shot:
            await pg.locator(".kl-stage").screenshot(path="/tmp/stage.png")
            print("tanpa kemenangan; pakai tangkapan kabinet biasa")
        await ctx.close()

        img = base64.b64encode(pathlib.Path("/tmp/stage.png").read_bytes()).decode()
        card = f"""<!doctype html><html><head><meta charset="utf-8"><style>
        * {{ margin:0; padding:0; box-sizing:border-box; }}
        html,body {{ width:1200px; height:630px; overflow:hidden; }}
        body {{
          font-family: 'Inter','Segoe UI',system-ui,sans-serif;
          background: radial-gradient(1100px 700px at 76% 10%, #2c2b66 0%, #191a3d 44%, #0d0e22 100%);
          color:#f4f2ff; display:flex; align-items:center; gap:34px; padding:0 52px;
        }}
        .left {{ width:338px; flex:none; }}
        .mark {{ display:flex; align-items:center; gap:12px; margin-bottom:20px; }}
        .word {{ font-size:46px; font-weight:800; letter-spacing:-1px; line-height:1; }}
        .tag {{ font-size:11.5px; letter-spacing:2.2px; color:#a9a5d8; margin-top:8px; font-weight:700; }}
        .pitch {{ font-size:16px; line-height:1.5; color:#cfcaf6; margin-bottom:24px; }}
        .fact {{ display:flex; align-items:baseline; gap:10px; font-size:14.5px; color:#e8e5ff; margin-bottom:10px; }}
        .fact b {{ font-size:19px; font-weight:800; color:#ffd479; font-variant-numeric:tabular-nums; }}
        .badge {{ display:inline-block; margin-top:20px; padding:8px 14px; border-radius:999px;
                  background:rgba(255,212,121,.14); border:1px solid rgba(255,212,121,.5);
                  color:#ffd479; font-size:12px; font-weight:800; letter-spacing:1.4px; }}
        .shot {{ flex:1; height:558px; display:flex; align-items:center; justify-content:center; }}
        .shot img {{ max-width:100%; max-height:558px; border-radius:18px;
                     border:1px solid rgba(160,150,255,.32); box-shadow:0 26px 70px rgba(0,0,0,.6); }}
        </style></head><body>
          <div class="left">
            <div class="mark">
              <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true">
                <circle cx="16" cy="16" r="14.5" fill="none" stroke="#ffd479" stroke-width="1.6"/>
                <path d="M11 7v10a5 5 0 0 0 10 0V7" fill="none" stroke="#ffd479" stroke-width="2.4" stroke-linecap="round"/>
                <path d="M11 12h10" stroke="#ffd479" stroke-width="1.6"/>
              </svg>
              <div><div class="word">Klabak</div><div class="tag">GACHAPON CLAW MACHINE &middot; SETTLES ON-CHAIN</div></div>
            </div>
            <p class="pitch">Three capsule cabinets, one claw. Pick a cabinet, drop the claw, and the grip decides &mdash; a slip, or a charm that pays up to &times;96. Keep the charms you pull: twelve to collect.</p>
            <div class="fact"><b>96.00%</b> declared RTP on all three cabinets</div>
            <div class="fact"><b>1,000,000</b> ppm weights fixed in the contract</div>
            <div class="fact"><b>3</b> volatilities, identical 96% return</div>
            <div class="badge">CHAIN JAM &middot; VOL. 1</div>
          </div>
          <div class="shot"><img src="data:image/png;base64,{img}"></div>
        </body></html>"""
        pathlib.Path("/tmp/klabak-card.html").write_text(card)
        ctx2 = await b.new_context(viewport={"width": 1200, "height": 630}, device_scale_factor=2)
        pg2 = await ctx2.new_page()
        await pg2.goto("file:///tmp/klabak-card.html", wait_until="load")
        await pg2.wait_for_timeout(600)
        await pg2.screenshot(path="/tmp/klabak-card-2x.png")
        from PIL import Image
        Image.open("/tmp/klabak-card-2x.png").convert("RGB").resize((1200, 630), Image.LANCZOS).save(
            "examples/klabak/public/og-image.png", "PNG", optimize=True)
        print("kartu ditulis: examples/klabak/public/og-image.png (1200x630)")
        await b.close()

asyncio.run(main())
