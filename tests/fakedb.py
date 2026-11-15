"""In-memory stand-in for the Claude artifact `db` capability, used by the sync tests."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get("WN_URL") or "file://" + os.path.join(HERE, "..", "dist", "index.html")

STORE = {}
FAIL = {"after": None}   # set to N: the (N+1)th write raises once, to test rollback

def dbop(op, path, data=None):
    if op == "get": return STORE.get(path)
    if op == "set":
        if FAIL["after"] is not None:
            FAIL["after"] -= 1
            if FAIL["after"] < 0:
                FAIL["after"] = None
                raise Exception("boom")
        STORE[path] = data; return None
    if op == "del": STORE.pop(path, None); return None
    if op == "list":
        pre = path + "/"
        return [{"id": k[len(pre):], "data": v} for k, v in sorted(STORE.items()) if k.startswith(pre) and "/" not in k[len(pre):]]

FAKE = """
(function(){
  function snap(id,d){ return {id:id, exists:!!d, data:function(){return d;}, metadata:{fromCache:false,hasPendingWrites:false}}; }
  function mkDoc(path){ var id=path.split('/').pop(); return { id:id, path:path,
    get: async function(){ return snap(id, await window.__dbop('get', path)); },
    set: async function(d){ await window.__dbop('set', path, JSON.parse(JSON.stringify(d))); },
    delete: async function(){ await window.__dbop('del', path); } }; }
  function mkCol(path){ return { path:path, doc:function(id){ return mkDoc(path+'/'+id); },
    get: async function(){ var l = await window.__dbop('list', path); return {docs:l.map(function(x){return snap(x.id,x.data);}), size:l.length, empty:!l.length}; },
    onSnapshot: function(next){ var last='', stop=false; (async function tick(){ if(stop) return; var l = await window.__dbop('list', path); var s=JSON.stringify(l);
      if(s!==last){ last=s; next({docs:l.map(function(x){return snap(x.id,x.data);}), size:l.length, empty:!l.length, docChanges:function(){return [];}, metadata:{fromCache:false}}); }
      setTimeout(tick, 300); })(); return function(){ stop=true; }; } }; }
  window.claude = { use: async function(n){ return n==='db' ? { collection: mkCol, doc: mkDoc } : n==='user' ? { id: async function(){ return 'u1'; }, isOwner: async function(){ return true; } } : null; } };
})();
"""
