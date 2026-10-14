import json, re, sys, pathlib
web = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2]); data = pathlib.Path(sys.argv[3])
html = (web / "index.html").read_text()
js_src = re.search(r'<script src="([^"]+)"', html).group(1)
css_srcs = re.findall(r'<link rel="stylesheet" href="([^"]+)"', html)
js = (web / js_src.lstrip("/")).read_text()
css = "\n".join((web / c.lstrip("/")).read_text() for c in css_srcs)
def esc(s): return s.replace("</script", "<\\/script").replace("<!--", "<\\!--")
fr = (data / "catalog.fr-CA.json").read_text(); en = (data / "catalog.en-CA.json").read_text(); wx = (data / "weather.montreal.json").read_text()
shim = """
(function(){
  // The router reads the page path; this page lives at an address the app doesn't know, so start at "/".
  try { history.replaceState(null, "", "/"); } catch (e) {}
  var DATA = {fr: %s, en: %s, wx: %s};
  // Weather is refreshed to "now" on every load, so the rain note never goes stale.
  var h0 = new Date(DATA.wx.hours[0].t).getTime(), now = new Date(); now.setMinutes(0,0,0);
  var d = now.getTime() - h0;
  DATA.wx.hours = DATA.wx.hours.map(function(x){ return {t: new Date(new Date(x.t).getTime() + d).toISOString(), precipProb: x.precipProb, tempC: x.tempC}; });
  DATA.wx.generatedAt = new Date().toISOString();
  var real = window.fetch.bind(window);
  window.fetch = function(u, o){
    var s = String(u && u.url || u), m;
    var j = function(x){ return Promise.resolve(new Response(JSON.stringify(x), {status: 200, headers: {"content-type": "application/json"}})); };
    if ((m = s.match(/catalog\\.(fr|en)-CA\\.json/))) return j(DATA[m[1]]);
    if (/weather\\.[a-z]+\\.json/.test(s)) return j(DATA.wx);
    return real(u, o);
  };
})();
""" % (fr, en, wx)
page = f"""<title>Alentour</title>
<style>
:root {{ --bg: #EEF1F8; box-sizing: border-box; color-scheme: light; }}
body {{ background: var(--bg); }}
html, body {{ height: 100%; }}
body {{ overflow: hidden; }}
#root {{ display: flex; height: 100%; flex: 1; }}
{css}
</style>
<div id="root"></div>
<script>{esc(shim)}</script>
<script>{esc(js)}</script>
"""
out.mkdir(parents=True, exist_ok=True)
(out / "index.html").write_text(page)
print("hosted page:", round(len(page)/1e6, 2), "MB")
