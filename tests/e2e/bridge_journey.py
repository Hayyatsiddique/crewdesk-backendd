from bridge import *
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
results=[];errors=[]
def done(name):results.append({'check':name,'passed':True});print('PASS',name,flush=True)
def go(page,hash):
 page.evaluate('(h)=>{location.hash=h}',hash);page.wait_for_timeout(400)
def check_no_error(page):
 visible=page.locator('.error:visible').all_text_contents()
 if visible:raise Exception('Visible errors: '+str(visible))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']);context=browser.new_context(viewport={'width':1440,'height':1000});context.set_default_timeout(4000)
 staffbridge=Bridge();cb=Bridge();staff=load(context,staffbridge,'staff-backend',errors)
 staff.locator('#staffEmail').fill('staff@example.test');staff.locator('#staffRequestOtp button[type=submit]').click();staff.wait_for_selector('#otpCode',timeout=3000);staff.locator('#otpCode').fill(staffbridge.otp('staff@example.test'));staff.locator('#staffVerifyForm button[type=submit]').click();staff.wait_for_timeout(300);done('Staff email-code sign-in and dashboard')
 client=load(context,cb,'client-desktop',errors);client.locator('#authContact').fill('alice@example.test');client.locator('#clientAuthForm button[type=submit]').click();client.wait_for_selector('#otpCode',timeout=3000)
 assert client.locator('#demoOtp').count()==0
 client.locator('#otpCode').fill(cb.otp('alice@example.test'));client.locator('#verifyForm button[type=submit]').click();client.wait_for_timeout(300);done('Client email OTP login without visible code')
 go(client,'sites');client.locator('[data-client="new-site"]').click();client.locator('#siteName').fill('QA Site');client.locator('#siteAddress').fill('22 Test Lane');client.locator('#siteContact').fill('Alice');client.locator('#sitePhone').fill('+14165550144');client.locator('#siteForm button[type=submit]').click();client.wait_for_timeout(500);check_no_error(client);assert not client.locator('#dialog').evaluate('(d)=>d.open');done('Create worksite through original modal')
 go(client,'request/crew');
 client.locator('#crewRole').fill('Warehouse associate');client.locator('#crewCount').fill('10');client.locator('#crewForm button[type=submit]').click();client.wait_for_timeout(350);check_no_error(client)
 
 date=(datetime.now(ZoneInfo('America/Toronto')).date()+timedelta(days=1)).isoformat()
 client.locator('#startDate').fill(date);client.locator('[data-client="shift"][data-value="nights"]').click();client.locator('#crewForm button[type=submit]').click();client.wait_for_timeout(300);check_no_error(client)
 client.locator('#crewForm button[type=submit]').click();client.wait_for_timeout(500);check_no_error(client)
 rid=client.evaluate('location.hash.split("/")[1]');print('created',rid,client.locator('h1').all_text_contents());assert rid.startswith('CR-');done('Crew wizard creates overnight request')
 go(staff,'labour/'+rid);staff.locator('[data-staff="accept-labour"]').click();staff.wait_for_timeout(500);check_no_error(staff);done('Staff accepts client request')
 staff.locator('#fillCount').fill('10');staff.locator('#fillForm button[type=submit]').click();staff.wait_for_timeout(500);check_no_error(staff);done('Staff confirms selected-date headcount')
 client.evaluate('queueSync()');client.wait_for_timeout(400);assert '10' in client.locator('#main').inner_text();done('Client refetch observes staff confirmation')
 client.locator('#clientMessage').fill('Gate 2 please.');client.locator('#clientMessageForm button[type=submit]').click();client.wait_for_timeout(400);check_no_error(client);done('Client dispatch message persists')
 staff.evaluate('queueSync()');staff.wait_for_timeout(400);assert 'Gate 2 please.' in staff.locator('#main').inner_text();staff.locator('#staffMessage').fill('Confirmed Gate 2.');staff.locator('#staffMessageForm button[type=submit]:not([value="info"])').click();staff.wait_for_timeout(400);check_no_error(staff);done('Staff dispatch reply persists')
 client.evaluate('queueSync()');client.wait_for_timeout(300);client.locator('[data-client="change"]').click();client.locator('#changeCount').fill('12');client.locator('#changeReason').fill('Need extra hands');client.locator('#clientChangeForm button[type=submit]').click();client.wait_for_timeout(400);check_no_error(client);done('Client requests change without immediate mutation')
 staff.evaluate('queueSync()');staff.wait_for_timeout(400);staff.locator('[data-staff="resolve-change"][data-approve="true"]').click();staff.wait_for_timeout(400);check_no_error(staff);done('Staff approves change')
 go(client,'open-role');client.locator('#jobTitle').fill('QA Warehouse lead');client.locator('#jobDescription').fill('Lead the warehouse operations team safely.');client.locator('#jobStart').fill(date);client.locator('#jobEnd').fill((datetime.now(ZoneInfo('America/Toronto')).date()+timedelta(days=50)).isoformat());client.locator('#jobLocation').fill('Toronto');client.locator('#jobForm button[type=submit]').click();client.wait_for_timeout(400);check_no_error(client)
 jid=client.evaluate('location.hash.split("/")[1]');assert jid.startswith('JR-');done('Client opens hiring role')
 go(staff,'job/'+jid);staff.locator('[data-staff="add-profile"]').click();staff.locator('#profileName').fill('Sam Example');staff.locator('#profileSummary').fill('Screened and available.');staff.locator('#profileResume').fill('Five years warehouse experience.');staff.locator('#profileForm button[type=submit]').click();staff.wait_for_timeout(400);check_no_error(staff)
 client.evaluate('queueSync()');client.wait_for_timeout(400);assert 'Sam Example' not in client.locator('#main').inner_text();done('Draft candidate hidden from client')
 staff.locator('#jobStatus').select_option('shortlist');staff.locator('#jobStatusForm button[type=submit]').click();staff.wait_for_timeout(400);check_no_error(staff);client.evaluate('queueSync()');client.wait_for_timeout(400);assert 'Sam Example' in client.locator('#main').inner_text();done('Published shortlist visible to client')
 mobile=load(context,cb,'client-mobile',errors,390);go(mobile,'job/'+jid);assert 'Sam Example' in mobile.locator('#main').inner_text();done('Mobile and desktop use same authorized records')
 mobile.close();staff.close();client.close()
 for width in [320,360,375,390,414,430,480]:
  layout=load(context,cb,'client-mobile',errors,width)
  assert layout.locator('.app').bounding_box()['width']<=width
  assert layout.evaluate('document.documentElement.scrollWidth')<=width
  done('Mobile home width '+str(width));layout.close()
 (ROOT/'docs'/'browser-results.json').write_text(json.dumps(results,indent=2));
 print('PAGE ERRORS',errors);assert not errors;done('No uncaught frontend errors')
 browser.close()
(ROOT/'docs'/'browser-results.json').write_text(json.dumps(results,indent=2))
