import sys
from playwright.sync_api import sync_playwright
import os
BASE = 'http://localhost:8765/index.html'
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots') + os.sep
os.makedirs(SHOTS, exist_ok=True)
views = ['dashboard', 'prospects', 'pipeline', 'followups', 'tasks', 'calendar', 'analytics', 'archive', 'settings']
which = sys.argv[1] if len(sys.argv) > 1 else 'desktop'
with sync_playwright() as p:
    b = p.chromium.launch()
    w, h = (1440, 900) if which == 'desktop' else (390, 844)
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1 if which == 'desktop' else 2)
    pg = ctx.new_page()
    pg.route('**/fonts.*/**', lambda r: r.abort())
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_timeout(800)
    pg.evaluate("CRM.Store.mutate('s', d => loadSampleData(d)); CRM.UI.go('dashboard')")
    pg.wait_for_timeout(1500)
    for v in views:
        pg.evaluate(f"CRM.UI.go('{v}')"); pg.wait_for_timeout(300)
        pg.screenshot(path=SHOTS + f'{which}_{v}.png', full_page=(which == 'desktop' and v not in ('pipeline',)))
    pg.evaluate("CRM.UI.go('prospects')")
    pid = pg.evaluate("Object.values(CRM.Store.data.prospects).find(p => p.company.startsWith('Harbor')).id")
    pg.evaluate(f"CRM.UI.openProspect('{pid}')"); pg.wait_for_timeout(300)
    pg.screenshot(path=SHOTS + f'{which}_drawer.png')
    pg.evaluate(f"CRM.UI.openProspect('{pid}', 'activity')"); pg.wait_for_timeout(300)
    pg.screenshot(path=SHOTS + f'{which}_drawer_activity.png')
    pg.evaluate("CRM.UI.drawer = {mode:'edit', id:'%s'}; CRM.UI.render()" % pid); pg.wait_for_timeout(300)
    pg.screenshot(path=SHOTS + f'{which}_form.png')
    pg.evaluate("CRM.UI.closeDrawer(); CRM.UI.settingsTab='automations'; CRM.UI.go('settings')"); pg.wait_for_timeout(300)
    pg.screenshot(path=SHOTS + f'{which}_automations.png', full_page=(which == 'desktop'))
    print('errors:', errs)
    b.close()
