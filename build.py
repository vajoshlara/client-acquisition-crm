"""Builds the Apps Script bundle.

dist/apps-script/ contains exactly what gets pushed to Google Apps Script:
  Code.gs          storage server (from server/)
  Index.html       the whole app, with CSS and JS inlined (from src/)
  appsscript.json  project manifest (from server/)
"""
import pathlib, shutil

root = pathlib.Path(__file__).resolve().parent
src = root / 'src'
out = root / 'dist' / 'apps-script'
order = ['core.js', 'model.js', 'sync.js', 'ui_base.js', 'views_main.js', 'views_more.js',
         'views_settings.js', 'drawer.js', 'actions.js', 'sample.js', 'main.js']

js = '\n'.join((src / f).read_text(encoding='utf-8') for f in order)
css = (src / 'styles.css').read_text(encoding='utf-8')
assert '</script>' not in js, 'a closing script tag inside the JS would break the page'
html = (src / 'shell.html').read_text(encoding='utf-8').replace('/*CSS*/', css).replace('/*JS*/', js)

out.mkdir(parents=True, exist_ok=True)
(out / 'Index.html').write_text(html, encoding='utf-8')
shutil.copy(root / 'server' / 'Code.gs', out / 'Code.gs')
shutil.copy(root / 'server' / 'appsscript.json', out / 'appsscript.json')
print(f'Built {out.relative_to(root)}: Index.html {len(html) // 1024} KB, Code.gs, appsscript.json')
