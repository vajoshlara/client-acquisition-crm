import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'dist' / 'apps-script' / 'Index.html').read_text(encoding='utf-8')
code = (root / 'server' / 'Code.gs').read_text(encoding='utf-8')
mock = (root / 'test' / 'mock_gas.js').read_text(encoding='utf-8')
inject = """<script>
""" + mock + """
(function () {
  var stored = null, props = null;
  try { stored = JSON.parse(localStorage.getItem('__mockdrive') || 'null'); props = JSON.parse(localStorage.getItem('__mockprops') || 'null'); } catch (e) {}
  var env = MockGAS.createEnv({ files: stored || {}, props: props || {} });
  window.__env = env;
  window.__net = { offline: localStorage.getItem('__offline') === '1', latency: 60 };
  var names = Object.keys(env).filter(function (k) { return k.charAt(0) !== '_'; });
  var api = new Function(names.join(','), """ + repr(code) + """ + '\\n;return { api_bootstrap: api_bootstrap, api_save: api_save, api_head: api_head, api_listStates: api_listStates, api_getState: api_getState, api_unlock: api_unlock, api_setPasscode: api_setPasscode, api_signOutOthers: api_signOutOthers, api_authStatus: api_authStatus, api_requestSetupCode: api_requestSetupCode, allowPasscodeReset: allowPasscodeReset };')
    .apply(null, names.map(function (k) { return env[k]; }));
  window.__api = api;
  window.__calls = [];
  function persist() {
    var keep = {};
    Object.keys(env._files).forEach(function (k) { if (!env._files[k].trashed) keep[k] = env._files[k]; });
    try { localStorage.setItem('__mockdrive', JSON.stringify(keep)); } catch (e) { /* test harness only: skip when large */ }
    try { localStorage.setItem('__mockprops', JSON.stringify(env._props)); } catch (e) { /* ignore */ }
  }
  function runner() {
    var ok = function () {}, fail = function () {};
    var r = new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { ok = f; return r; };
      if (name === 'withFailureHandler') return function (f) { fail = f; return r; };
      return function (arg) {
        var lat = window.__net.latency;
        window.__calls.push(name);
        setTimeout(function () {
          if (window.__net.offline) { fail(new Error('NetworkError when attempting to fetch resource.')); return; }
          var res;
          try { res = api[name](JSON.parse(JSON.stringify(arg === undefined ? null : arg))); persist(); }
          catch (e) { fail(e); return; }
          setTimeout(function () { ok(JSON.parse(JSON.stringify(res))); }, lat);
        }, lat);
      };
    } });
    return r;
  }
  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: runner });
})();
</script>
"""
out = html.replace('<body>', '<body>\n' + inject, 1)
(root / 'test' / 'site').mkdir(exist_ok=True)
(root / 'test' / 'site' / 'index.html').write_text(out)
(root / 'test' / 'site' / 'local.html').write_text(html)  # plain file mode (no Apps Script)
print('harness built')
