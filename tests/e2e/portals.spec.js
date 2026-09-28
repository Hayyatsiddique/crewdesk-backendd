/** Browser contract tests against the explicitly test-only in-memory HTTP adapter.
 * Run tests/integration separately to exercise real Express, MongoDB and Socket.IO.
 */
import {test,expect} from '@playwright/test';
const tomorrow=()=>{const d=new Date();d.setUTCDate(d.getUTCDate()+2);return d.toISOString().slice(0,10);};
async function refresh(page){await page.evaluate(()=>queueSync());}
test('approved portals: crew, dispatch, hiring and mobile sharing',async({browser})=>{
  const sc=await browser.newContext(),cc=await browser.newContext();
  const staff=await sc.newPage(),client=await cc.newPage();
  const base='http://127.0.0.1:5081';
  const errors=[];for(const p of[staff,client])p.on('pageerror',e=>errors.push(e.message));
  try{
    await staff.goto(base+'/staff/home');
    await expect.poll(()=>staff.evaluate(()=>window.CrewReact?.version)).toMatch(/^19\./);
    await staff.locator('#staffEmail').fill('staff@example.test');await staff.locator('#staffRequestOtp button[type=submit]').click();await expect(staff.locator('#otpCode')).toBeVisible();
    const staffResponse=await sc.request.get(base+'/__test/otp?contact=staff@example.test');const {code:staffCode}=await staffResponse.json();
    await staff.locator('#otpCode').fill(staffCode);await staff.locator('#staffVerifyForm button[type=submit]').click();
    await expect(staff.locator('.sidebar')).toBeVisible();
    await client.goto(base+'/client/home');
    await expect.poll(()=>client.evaluate(()=>window.CrewReact?.version)).toMatch(/^19\./);
    await client.locator('#authContact').fill('alice@example.test');await client.locator('#clientAuthForm button[type=submit]').click();await expect(client.locator('#otpCode')).toBeVisible();
    const response=await cc.request.get(base+'/__test/otp?contact=alice@example.test');const {code}=await response.json();
    await client.locator('#otpCode').fill(code);await client.locator('#verifyForm button[type=submit]').click();await expect(client.locator('.sidebar')).toBeVisible();
    await client.goto(base+'/client/request/crew');await client.locator('#crewRole').fill('Warehouse associate');await client.locator('#crewCount').fill('10');await client.locator('#crewForm button[type=submit]').click();
    const start=tomorrow();await client.locator('#startDate').fill(start);await client.locator('[data-client="shift"][data-value="nights"]').click();await client.locator('#crewForm button[type=submit]').click();
    await expect(client.locator('#crewForm')).toHaveAttribute('data-step','review');await client.locator('#crewForm button[type=submit]').click();
    await expect(client).toHaveURL(/\/client\/labour\/CR-/);const rid=client.url().split('/client/labour/')[1];
    await staff.goto(base+'/staff/labour/'+rid);await staff.locator('[data-staff="accept-labour"]').click();await expect.poll(async()=>staff.evaluate(()=>db.labourRequests[0]?.phase)).toBe('staffing');await expect(staff.locator('#fillCount')).toBeEnabled();
    await staff.locator('#fillCount').fill('10');
    await staff.locator('[data-worker-name]').evaluateAll(nodes=>nodes.forEach((node,i)=>node.value=`Worker ${i+1}`));
    await staff.locator('[data-worker-phone]').evaluateAll(nodes=>nodes.forEach((node,i)=>node.value=`+14165550${String(i).padStart(3,'0')}`));
    await staff.locator('#fillForm button[type=submit]').click();
    await expect.poll(async()=>staff.evaluate(()=>db.labourRequests[0]?.fills?.[staffDates[location.pathname.split('/').at(-1)]])).toBe(10);
    await refresh(client);await expect.poll(async()=>client.evaluate(()=>Object.values(db.labourRequests[0]?.fills||{}).includes(10))).toBe(true);
    await client.locator('#clientMessage').fill('Gate 2 please.');await client.locator('#clientMessageForm button[type=submit]').click();await expect(client.locator('.messages')).toContainText('Gate 2 please.');
    await refresh(staff);await expect(staff.locator('.messages')).toContainText('Gate 2 please.');
    await client.goto(base+'/client/open-role');await client.locator('#jobTitle').fill('Warehouse lead');await client.locator('#jobDescription').fill('Lead the warehouse safely.');await client.locator('#jobStart').fill(start);await client.locator('#jobEnd').fill(start);await client.locator('#jobLocation').fill('Toronto');await client.locator('#jobForm button[type=submit]').click();
    await expect(client).toHaveURL(/\/client\/job\/JR-/);const jid=client.url().split('/client/job/')[1];
    await staff.goto(base+'/staff/job/'+jid);await staff.locator('[data-staff="add-profile"]').click();await staff.locator('#profileName').fill('Sam Example');await staff.locator('#profileSummary').fill('Screened and available.');await staff.locator('#profileResume').fill('Five years warehouse experience.');await staff.locator('#profileForm button[type=submit]').click();await expect(staff.locator('#dialog')).not.toBeVisible();
    await refresh(client);await expect(client.locator('#main')).not.toContainText('Sam Example');await staff.locator('#jobStatus').selectOption('shortlist');await staff.locator('#jobStatusForm button[type=submit]').click();await expect.poll(async()=>staff.evaluate(()=>db.jobPosts[0]?.status)).toBe('shortlist');
    await refresh(client);await expect(client.locator('#main')).toContainText('Sam Example');
    const mobile=await cc.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.setViewportSize({width:390,height:900});await mobile.goto(base+'/client-mobile/job/'+jid);await expect.poll(()=>mobile.evaluate(()=>window.CrewReact?.version)).toMatch(/^19\./);await expect(mobile.locator('#main')).toContainText('Sam Example');
    for(const width of[320,360,375,390,414,430,480]){await mobile.setViewportSize({width,height:900});await mobile.goto(base+'/client-mobile/home');await expect(mobile.locator('.nav-bottom')).toBeVisible();expect(await mobile.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);}
    expect(errors).toEqual([]);
  }finally{await sc.close();await cc.close();}
});
