"""TEST ONLY: browser-to-fixture transport, not an Express/Mongo/cookie enforcement test."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import urllib.request,urllib.error,http.cookiejar,json,re
ROOT=Path(__file__).resolve().parents[2];base='http://127.0.0.1:5081'
class Bridge:
 def __init__(self):
  self.jar=http.cookiejar.CookieJar();self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
 def fetch(self,source,request):
  headers=request.get('headers',{});headers['Origin']=base
  req=urllib.request.Request(base+request['url'],data=request.get('body','').encode() if request.get('body') else None,headers=headers,method=request.get('method','GET'))
  try:
   with self.opener.open(req,timeout=4) as response:return {'status':response.status,'body':response.read().decode()}
  except urllib.error.HTTPError as response:return {'status':response.code,'body':response.read().decode()}
 def otp(self,contact):
  return json.loads(self.opener.open(base+'/__test/otp?contact='+contact,timeout=4).read())['code']

def load(context,bridge,stem,errors=None,width=None):
 page=context.new_page()
 if width:page.set_viewport_size({'width':width,'height':900})
 if errors is not None:page.on('pageerror',lambda error:errors.append(str(error)))
 page.expose_binding('fixtureTransport',bridge.fetch)
 html=(ROOT/'client'/(stem+'.html')).read_text();html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S)
 page.set_content(html)
 page.add_script_tag(content="""
 window.fetch=async(url,options={})=>{const r=await fixtureTransport({url,method:options.method||'GET',body:options.body,headers:options.headers||{}});return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json'}});};
 if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16));
 """)
 for name in ['api','common','auth','staff' if stem=='staff-backend' else 'client','socket','runtime']:
  page.add_script_tag(content=(ROOT/'client/js'/(name+'.js')).read_text())
  if name=='socket':page.evaluate('CrewRealtime.start = () => {}')  # fixture uses explicit refetch; no periodic background polling
 page.wait_for_timeout(400)
 return page

