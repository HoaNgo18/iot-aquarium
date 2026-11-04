async page => {
  // Isolated API fixture: all account/tank/reminder writes stay in this browser.
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [], unexpected = [], writes = [], seriesRequests=[];
  let seriesFail=false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
  let user = null, tanks = [], reminders = [], expired = false, id = 0;
  let failTanks = false, failReminders = false, failAlerts = false;
  const stamp = () => new Date().toISOString();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const values = { temperature_min_c:22, temperature_max_c:30, temperature_preset:'custom', ph_min:6.5, ph_max:8.5,
    clear_min_pct:90, cloudy_below_pct:70, clear_recovery_above_pct:93, cloudy_recovery_above_pct:75, auto_hysteresis:true,
    alert_after_seconds:1800, sensor_timeout_minutes:0, sensitivity:'standard', median_window:15, ema_seconds:20 };
  const reading = deviceId => ({ id:1, device_id:deviceId, sequence:1, measured_at:stamp(), received_at:stamp(),
    temperature_c:27.1, ph:6.96, ph_mv:1272, turbidity_mv:1600, turbidity_reference_mv:1604.56,
    turbidity_pct:null, clarity_mv:1600, clarity_pct:99.7, clarity_state:'clear', signal_strength_dbm:-54,
    sensor_status:'normal', sensor_health:{temperature:true,ph:true,clarity:true} });
  const alerts = tank => tank.open_alerts ? Array.from({length:5},(_,i)=>({ id:88+i, device_id:tank.device_id, alert_type:'temperature', severity:'warning',
    message:'Nhiệt độ vượt khoảng đã đặt.', started_at:stamp(), ended_at:null, acknowledged_at:null })) : [];
  await page.routeWebSocket('**/ws*', socket => { socket.onMessage(message => { if (message === 'ping') socket.send(JSON.stringify({ type:'pong' })); }); });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), method = request.method();
    const body = method === 'POST' || method === 'PATCH' || method === 'PUT' ? request.postDataJSON() ?? {} : {};
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (method !== 'GET') writes.push({ path, method, body });
    if (path === '/auth/login' || path === '/auth/register') {
      if (body.username === 'wrong.user') return reply({ detail:'Sai tên đăng nhập hoặc mật khẩu' }, 401);
      if (body.username === 'duplicate') return reply({ detail:'Tên đăng nhập đã được dùng' }, 409);
      user = { id:1, username:body.username, display_name:body.display_name || 'Hòa' }; expired = false;
      return reply(user, path.endsWith('register') ? 201 : 200);
    }
    if (path === '/auth/logout') { user = null; return route.fulfill({status:204}); }
    if (!user || expired) return reply({detail:'Bạn cần đăng nhập'},401);
    if (path === '/auth/me') {
      if (method === 'PATCH') user = {...user,...body};
      return reply(user);
    }
    if (path === '/auth/password') {
      if (body.current_password === 'wrong-password') return reply({detail:'Mật khẩu hiện tại không đúng'},400);
      return reply(user);
    }
    if (path === '/tanks') {
      if (failTanks) return reply({detail:'Chưa tải được bể. Thử lại.'},503);
      if (method === 'POST') {
        if (body.pairing_code === 'BBBB-BBBB') return reply({detail:'Mã thiết bị hoặc mã ghép nối không đúng'},400);
        const tank = {...body,id:++id,created_at:stamp(),connectivity:'online',last_seen_at:stamp(),open_alerts:0,latest:reading(body.device_id)};
        tanks.push(tank); return reply(tank,201);
      }
      return reply(tanks);
    }
    if (/^\/tanks\/\d+$/.test(path)) {
      const tankId=Number(path.split('/').at(-1)), tank=tanks.find(t=>t.id===tankId);
      if(method==='DELETE'){tanks=tanks.filter(t=>t.id!==tankId);reminders=reminders.filter(r=>r.tank_id!==tankId);return route.fulfill({status:204});}
      if(method==='PATCH')Object.assign(tank,body);
      return reply(tank);
    }
    if (path === '/reminders') {
      if (failReminders) return reply({detail:'Chưa tải được nhắc việc.'},503);
      if(method==='POST'){
        const item={...body,id:++id,tank_name:tanks.find(t=>t.id===body.tank_id)?.name??null,done_at:null,last_done_at:null};
        reminders.push(item);return reply(item,201);
      }
      return reply(reminders);
    }
    if (path.startsWith('/reminders/')) {
      const reminderId=Number(path.split('/')[2]),item=reminders.find(r=>r.id===reminderId);
      if(method==='DELETE'){reminders=reminders.filter(r=>r.id!==reminderId);return route.fulfill({status:204});}
      if(path.endsWith('/complete')){item.last_done_at=stamp();if(item.repeat==='none')item.done_at=stamp();else item.due_date=tomorrow;}
      else if(path.endsWith('/reopen'))item.done_at=null;
      else Object.assign(item,body);
      return reply(item);
    }
    const device = /^\/devices\/([^/]+)(.*)$/.exec(path);
    if(device){
      const tank=tanks.find(t=>t.device_id===decodeURIComponent(device[1])),suffix=device[2],row=reading(device[1]);
      if(!tank)return reply({detail:'Không tìm thấy bể'},404);
      if(suffix==='/alerts')return failAlerts?reply({detail:'Lỗi cảnh báo'},503):reply(alerts(tank));
      if(suffix==='/telemetry/latest')return reply(row);
      if(suffix==='/telemetry/last-valid')return reply({temperature:row,ph:row,clarity:row});
      if(suffix==='/telemetry/series'){seriesRequests.push(device[1]);if(seriesFail)return reply({detail:'Lỗi thử'},503);return reply(Array.from({length:30},(_,i)=>({...row,id:i,measured_at:new Date(Date.now()-(29-i)*60000).toISOString()})));}
      if(suffix==='/thresholds')return reply({...values,turbidity_warning_pct:45,turbidity_critical_pct:70});
      if(suffix==='/clarity/config')return reply(values);
      if(suffix==='/clarity/baselines'||suffix==='/settings/history')return reply([]);
      if(suffix==='/settings')return reply({device_id:device[1],revision:0,values,defaults:values});
      if(!suffix)return reply({id:device[1],connectivity:tank.connectivity,sensor_status:'normal',last_seen_at:stamp()});
    }
    unexpected.push(`${method} ${path}`); return reply({detail:'Unexpected test route'},404);
  });


  user={id:1,username:'scene.qa',display_name:'Kiểm tra'};
  tanks=[{id:1,name:'Bể phòng ngủ',device_id:'tank-one',volume_l:60,species:null,connectivity:'online',open_alerts:0,latest:reading('tank-one')},{id:2,name:'Bể phụ',device_id:'tank-two',volume_l:40,species:null,connectivity:'online',open_alerts:0,latest:reading('tank-two')}];
  await page.goto('http://127.0.0.1:5173/');await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.getByRole('heading',{name:'Hiểu bể cá. Chăm sóc tốt hơn.'}).waitFor();
  const results=[];
  await page.evaluate(()=>{localStorage.setItem('aquasense-motion','on')});await page.reload();
  for(const theme of ['light','dark']){
    await page.emulateMedia({colorScheme:theme});
    for(const [width,height] of [[1366,768],[1920,1080],[360,800]]){
      await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const sizes=await page.evaluate(()=>({scrollHeight:document.documentElement.scrollHeight,innerHeight,scrollWidth:document.documentElement.scrollWidth,innerWidth}));
      check(width<1024||sizes.scrollHeight<=height+2,JSON.stringify(sizes));check(sizes.scrollWidth<=width,'Horizontal overflow');
      check(await page.locator('.intro-overview select,.intro-overview a,.intro-overview-footer').count()===0,'Old controls remain');
      const moving=await page.locator('.intro-overview .aq-f1').evaluate(e=>({name:getComputedStyle(e).animationName,state:getComputedStyle(e).animationPlayState}));check(moving.name!=='none'&&moving.state==='running','Fish animation paused');
      results.push({theme,width,...sizes});await page.screenshot({path:`output/playwright/intro-overview-${theme}-${width}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>location.hash='#/tank/tank-one');
  await page.locator('#history-chart').waitFor();
  check(await page.locator('.shell-desktop-heading>span').count().then(n=>n===0),'Page title remains');
  check(await page.getByRole('link',{name:'Quay lại Bể của tôi'}).innerText()==='','Back link still has text');
  check(await page.locator('.shell-desktop-heading select').count()===1,'Tank picker missing');
  check(!await page.locator('.tank-detail-navigation').innerText().then(t=>t.includes('Chuyển bể')||t.includes('tank-one')),'Old header controls remain');
  await page.screenshot({path:'output/playwright/detail-header-clean.png'});
  await page.evaluate(()=>location.hash='#/');await page.locator('.aq-f1').waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{document.documentElement.dataset.motion='on'});
  const sample=()=>page.locator('.aq-f1').evaluate(e=>({transform:getComputedStyle(e).transform,duration:getComputedStyle(e).animationDuration,time:e.getAnimations()[0]?.currentTime}));
  const before=await sample();await new Promise(resolve=>setTimeout(resolve,1500));const after=await sample();
  check(before.transform!==after.transform,'Fish did not move with reduced motion and explicit On');
  check(parseFloat(after.duration)>1,'Global reduced-motion rule shortened the animation');
  await page.evaluate(()=>document.documentElement.dataset.motion='off');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.aq-f1')).animationPlayState==='paused');
  await page.evaluate(()=>document.documentElement.dataset.motion='on');
  check(!errors.length,errors.join('; '));return {results,movement:{before,after},runtimeErrors:errors,realBackendWrites:0};
}
