/* Simulated Apps Script services (DriveApp, LockService, Utilities, ...) with fault injection.
 * Works in Node and in the browser. Used only for testing Code.gs and the app. */
(function (root) {
  'use strict';

  function sha256Bytes(str) {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var bytes = new TextEncoder().encode(str);
    var l = bytes.length, total = ((l + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(total); buf.set(bytes); buf[l] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, (l * 8) >>> 0); dv.setUint32(total - 8, Math.floor(l / 0x20000000));
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var W = new Array(64);
    for (var i = 0; i < total; i += 64) {
      for (var t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4);
      for (t = 16; t < 64; t++) {
        var x = W[t-15], y = W[t-2];
        var s0 = ((x>>>7)|(x<<25)) ^ ((x>>>18)|(x<<14)) ^ (x>>>3);
        var s1 = ((y>>>17)|(y<<15)) ^ ((y>>>19)|(y<<13)) ^ (y>>>10);
        W[t] = (W[t-16] + s0 + W[t-7] + s1) >>> 0;
      }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e>>>6)|(e<<26)) ^ ((e>>>11)|(e<<21)) ^ ((e>>>25)|(e<<7));
        var t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + W[t]) >>> 0;
        var S0 = ((a>>>2)|(a<<30)) ^ ((a>>>13)|(a<<19)) ^ ((a>>>22)|(a<<10));
        var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      H=[(H[0]+a)>>>0,(H[1]+b)>>>0,(H[2]+c)>>>0,(H[3]+d)>>>0,(H[4]+e)>>>0,(H[5]+f)>>>0,(H[6]+g)>>>0,(H[7]+h)>>>0];
    }
    var out = [];
    H.forEach(function (w) { for (var s = 24; s >= 0; s -= 8) { var v = (w >>> s) & 255; out.push(v > 127 ? v - 256 : v); } });
    return out; // signed bytes, like Apps Script
  }

  function createEnv(opts) {
    opts = opts || {};
    var faults = {};          // name -> count of upcoming failures (or Infinity)
    var files = opts.files || {};  // id -> file record
    var nextId = 1 + Object.keys(files).reduce(function (m, k) { return Math.max(m, Number(k.slice(1)) || 0); }, 0);
    var folders = {};
    var log = [];

    function fault(name) {
      if (faults[name] > 0) { faults[name]--; return true; }
      return false;
    }
    function FileObj(rec) {
      return {
        getId: function () { return rec.id; },
        getName: function () { return rec.name; },
        setName: function (n) { if (fault('rename')) throw new Error('Simulated Drive error on rename'); if (!fault('renameSilent')) rec.name = n; return this; },
        getDescription: function () { return rec.description; },
        setDescription: function (d) { if (fault('describe')) throw new Error('Simulated Drive error on describe'); rec.description = d; return this; },
        isTrashed: function () { return rec.trashed; },
        setTrashed: function (v) { if (v && fault('trash')) throw new Error('Simulated Drive error on trash'); rec.trashed = !!v; log.push((v ? 'trash ' : 'untrash ') + rec.name); return this; },
        getDateCreated: function () { return new Date(rec.created); },
        getSize: function () { return rec.content.length; },
        getUrl: function () { return 'https://drive.example/file/' + rec.id; },
        getBlob: function () {
          return { getDataAsString: function () {
            if (fault('read')) throw new Error('Simulated Drive read error');
            return rec.corruptOnRead ? rec.content.slice(0, -5) + 'XXXX}' : rec.content;
          } };
        }
      };
    }
    function iter(list) { var i = 0; return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } }; }
    function FolderObj(rec) {
      return {
        getId: function () { return rec.id; },
        getName: function () { return rec.name; },
        getUrl: function () { return 'https://drive.example/folder/' + rec.id; },
        isTrashed: function () { return !!rec.trashed; },
        getFiles: function () {
          if (fault('list')) throw new Error('Simulated Drive list error');
          return iter(Object.keys(files).filter(function (k) { return files[k].parent === rec.id; }).map(function (k) { return FileObj(files[k]); }));
        },
        createFile: function (name, content, mime) {
          if (fault('create')) throw new Error('Simulated Drive error: upload failed');
          if (fault('network')) throw new Error('NetworkError: simulated');
          var id = 'f' + (nextId++);
          files[id] = { id: id, name: name, content: fault('corruptWrite') ? content.slice(0, -10) : content, description: '', trashed: false, parent: rec.id, created: Date.now(), mime: mime };
          log.push('create ' + name);
          return FileObj(files[id]);
        }
      };
    }
    var folderId = opts.folderId || '1bVkFPtIHF8sWQuDu6hr1_IMptwTsXfv2';
    folders[folderId] = { id: folderId, name: '08_Claude CRM Project' };

    var props = opts.props || {};
    var cache = {};
    var activeUser = opts.activeUser === undefined ? 'vajoshlara@gmail.com' : opts.activeUser;
    var uuidN = 0;
    var locked = false;
    var tzOffsets = { 'Asia/Manila': 480, 'Etc/UTC': 0, 'UTC': 0 };
    function fmt(date, tz, pattern) {
      var off = tzOffsets[tz] !== undefined ? tzOffsets[tz] : 0;
      var d = new Date(date.getTime() + off * 60000);
      function p(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
      var sign = off >= 0 ? '+' : '-', ao = Math.abs(off);
      var xxx = off === 0 ? 'Z' : sign + p(Math.floor(ao / 60)) + ':' + p(ao % 60);
      return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|XXX/g, function (m, lit) {
        if (lit !== undefined) return lit;
        switch (m) {
          case 'yyyy': return p(d.getUTCFullYear(), 4); case 'MM': return p(d.getUTCMonth() + 1);
          case 'dd': return p(d.getUTCDate()); case 'HH': return p(d.getUTCHours());
          case 'mm': return p(d.getUTCMinutes()); case 'ss': return p(d.getUTCSeconds());
          case 'XXX': return xxx;
        }
      });
    }

    var env = {
      DriveApp: {
        getFolderById: function (id) { if (!folders[id]) throw new Error('No item with the given ID could be found.'); return FolderObj(folders[id]); },
        getFileById: function (id) { if (!files[id]) throw new Error('No item with the given ID could be found.'); return FileObj(files[id]); },
        getFoldersByName: function (n) { return iter(Object.keys(folders).filter(function (k) { return folders[k].name === n; }).map(function (k) { return FolderObj(folders[k]); })); }
      },
      LockService: { getScriptLock: function () { return {
        tryLock: function () { if (fault('lockBusy') || locked) return false; locked = true; return true; },
        releaseLock: function () { locked = false; }
      }; } },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
        computeDigest: function (alg, s) { return sha256Bytes(s); },
        getUuid: function () { uuidN++; var r = ''; for (var i = 0; i < 32; i++) r += Math.floor(Math.random() * 16).toString(16); return r.slice(0, 8) + '-' + r.slice(8, 12) + '-' + r.slice(12, 16) + '-' + r.slice(16, 20) + '-' + r.slice(20); },
        formatDate: fmt
      },
      PropertiesService: { getScriptProperties: function () { return {
        getProperty: function (k) { return props[k] || null; }, setProperty: function (k, v) { props[k] = String(v); },
        deleteProperty: function (k) { delete props[k]; }
      }; } },
      Session: {
        getActiveUser: function () { return { getEmail: function () { return activeUser; } }; },
        getEffectiveUser: function () { return { getEmail: function () { return 'vajoshlara@gmail.com'; } }; },
        getScriptTimeZone: function () { return 'Asia/Manila'; }
      },
      CacheService: { getScriptCache: function () { return {
        get: function (k) { var e = cache[k]; return e && e.exp > Date.now() ? e.v : null; },
        put: function (k, v, secs) { cache[k] = { v: String(v), exp: Date.now() + (secs || 600) * 1000 }; },
        remove: function (k) { delete cache[k]; }
      }; } },
      HtmlService: { XFrameOptionsMode: { DEFAULT: 'DEFAULT' } },
      // test controls
      _faults: faults,
      _files: files,
      _log: log,
      _setLocked: function (v) { locked = v; },
      _setActiveUser: function (v) { activeUser = v; },
      _props: props,
      _cache: cache,
      _committed: function () {
        return Object.keys(files).map(function (k) { return files[k]; })
          .filter(function (f) { return !f.trashed && /^crm_state_/.test(f.name); })
          .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      }
    };
    return env;
  }

  var api = { createEnv: createEnv, sha256Bytes: sha256Bytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MockGAS = api;
})(this);
