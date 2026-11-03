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

  user={id:1,username:'layout.qa',display_name:'Kiểm tra bố cục'};
  tanks=Array.from({length:4},(_,i)=>({id:i+1,name:i===1?'Bể phụ':`Bể cá ${i+1}`,device_id:`tank-layout-${i}`,volume_l:60,species:'Cá cảnh',created_at:stamp(),connectivity:'online',last_seen_at:stamp(),open_alerts:i===0?5:0,latest:reading(`tank-layout-${i}`)}));
  reminders=Array.from({length:6},(_,i)=>({id:i+1,title:`Chăm sóc bể ${i+1}`,note:null,tank_id:1,tank_name:'Bể cá 1',repeat:'weekly',due_date:i<2?yesterday:i<4?today:tomorrow,done_at:null,last_done_at:null}));

  const results=[];
  await page.clock.install();
  await page.evaluate(()=>localStorage.clear());
  await page.goto('http://127.0.0.1:5173/?overview-qa='+Date.now()+'#/');
  await page.locator('.overview-metrics svg').first().waitFor();
  for(const theme of ['light','dark']) {
    await page.emulateMedia({colorScheme:theme});
    for(const [width,height] of [[1366,768],[1920,1080],[360,800]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const sizes=await page.evaluate(()=>({scrollHeight:document.documentElement.scrollHeight,innerHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
      check(width<1000||sizes.scrollHeight<=height+2,JSON.stringify(sizes));check(sizes.scrollWidth<=width,'Horizontal overflow');
      if(width>=1024){const box=await page.locator('.overview-metrics').boundingBox();check(box.y+box.height<=height+2,'Metrics clipped by viewport')}
      results.push({page:'overview',theme,...sizes});
      await page.screenshot({path:`output/playwright/overview02-${theme}-${width}.png`});
    }
  }
  await page.setViewportSize({width:1366,height:768});
  await page.getByRole('textbox',{name:'Tìm bể',exact:true}).fill('be phu');
  check(await page.locator('.overview-tank-row').count()===1,'Accent search failed');
  await page.locator('.overview-tank-row').click();
  await page.getByRole('textbox',{name:'Tìm bể',exact:true}).press('Escape');
  await page.waitForFunction(()=>localStorage.getItem('aquasense-overview-tank')==='tank-layout-1');
  await page.locator('.overview-metrics svg').first().waitFor();
  const baseline=seriesRequests.length;
  await page.clock.fastForward(10000);
  check(seriesRequests.length===baseline,'Session polling reloaded series');
  await Promise.all([page.waitForResponse(r=>r.url().includes('/telemetry/series')),page.clock.fastForward(50000)]);
  check(seriesRequests.length===baseline+1,'60 second refresh missing');
  await page.getByRole('button',{name:'Đánh dấu xong: Chăm sóc bể 1'}).click();
  await page.getByRole('status').filter({hasText:'Đã xong · lần tới'}).waitFor();
  check(reminders[0].due_date===tomorrow,'Completion did not advance repeat');
  seriesFail=true;
  await page.locator('.overview-tank-row').filter({hasText:'tank-layout-2'}).click();
  await page.getByText('Chưa tải được biểu đồ 24 giờ.',{exact:true}).first().waitFor();
  check(await page.locator('.overview-scene').isVisible(),'Series failure removed scene');
  seriesFail=false;
  tanks=tanks.slice(0,2);
  await page.reload();
  await page.locator('.overview-tanks').waitFor();
  check(await page.locator('.overview-tank-row').first().getAttribute('aria-pressed')==='true','Removed saved tank did not fall back');
  await page.locator('.overview-tank-row').nth(1).click();
  await page.reload();await page.locator('.overview-tanks').waitFor();
  check(await page.locator('.overview-tank-row').nth(1).getAttribute('aria-pressed')==='true','Selection not persisted');
  await page.locator('.overview-alert-button').first().click();
  await page.waitForFunction(()=>localStorage.getItem('aquasense-overview-tank')==='tank-layout-0');
  check(await page.getByRole('link',{name:'Xem chi tiết →',exact:true}).count()===1,'Detail link duplicated');
  await page.evaluate(()=>location.hash='#/settings');
  await page.getByRole('radio',{name:'Tắt',exact:true}).check();
  check(await page.evaluate(()=>document.documentElement.dataset.motion)==='off','Motion off failed');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('radio',{name:'Bật',exact:true}).check();
  check(await page.evaluate(()=>document.documentElement.dataset.motion)==='on','Explicit motion override failed');
  await page.getByRole('radio',{name:'Theo hệ thống',exact:true}).last().check();
  check(await page.evaluate(()=>document.documentElement.dataset.motion)==='off','System motion failed');
  await page.evaluate(()=>location.hash='#/');
  tanks=[{...tanks[0],open_alerts:0}];reminders=[];
  await page.setViewportSize({width:1366,height:768});await page.reload();
  await page.getByText('Mọi thứ ổn. Không có cảnh báo hay việc đến hạn.',{exact:true}).waitFor();
  check(await page.locator('.overview-attention').evaluate(e=>e.clientHeight)<130,'Empty attention card stretched');
  check(await page.locator('.overview-tanks').evaluate(e=>e.clientHeight)<220,'Single tank card stretched');
  await page.screenshot({path:'output/playwright/polish03-one-tank.png'});
  tanks=[];await page.reload();await page.getByRole('heading',{name:'Kết nối bể cá đầu tiên'}).waitFor();
  check(await page.getByRole('link',{name:'Thêm bể đầu tiên'}).isVisible(),'Onboarding action missing');
  user=null;
  await page.reload();await page.getByRole('heading',{name:'Chào mừng trở lại'}).waitFor();
  for(const theme of ['light','dark']) {
    await page.emulateMedia({colorScheme:theme});
    for(const [width,height] of [[1366,768],[1920,1080],[360,800]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      for(const mode of ['Đăng nhập','Tạo tài khoản']) {
        await page.getByRole('tab',{name:mode,exact:true}).click();
        const sizes=await page.evaluate(()=>({scrollHeight:document.documentElement.scrollHeight,innerHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
        check(width<1000||sizes.scrollHeight<=height+2,JSON.stringify(sizes));check(sizes.scrollWidth<=width,'Auth horizontal overflow');
        results.push({page:mode,theme,...sizes});
        await page.screenshot({path:`output/playwright/auth02-${theme}-${width}-${mode==='Đăng nhập'?'login':'register'}.png`});
      }
    }
  }
  check(errors.length===0,errors.join('; '));
  return {results,seriesRequests:seriesRequests.length,realBackendWrites:0,runtimeErrors:errors};
}
