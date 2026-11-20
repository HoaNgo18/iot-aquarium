async page => {
  // Isolated API fixture: all account/tank/reminder writes stay in this browser.
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [], unexpected = [], writes = [], seriesRequests=[];
  let seriesFail=false,failed=false;
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
    sensor_status:'normal', sensor_health:{temperature:!failed,ph:!failed,clarity:!failed} });
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
      if(suffix==='/telemetry/last-valid'){const known={...row,measured_at:new Date(Date.now()-120000).toISOString(),sensor_health:{temperature:true,ph:true,clarity:true}};return reply({temperature:known,ph:known,clarity:known});}
      if(suffix==='/telemetry/series'){seriesRequests.push(device[1]);if(seriesFail)return reply({detail:'Lỗi thử'},503);return reply(Array.from({length:30},(_,i)=>({...row,id:i,measured_at:new Date(Date.now()-(29-i)*60000).toISOString()})));}
      if(suffix==='/thresholds')return reply({...values,turbidity_warning_pct:45,turbidity_critical_pct:70});
      if(suffix==='/clarity/config')return reply(values);
      if(suffix==='/clarity/baselines'||suffix==='/settings/history')return reply([]);
      if(suffix==='/settings')return reply({device_id:device[1],revision:0,values,defaults:values});
      if(!suffix)return reply({id:device[1],connectivity:tank.connectivity,sensor_status:'normal',last_seen_at:stamp()});
    }
    unexpected.push(`${method} ${path}`); return reply({detail:'Unexpected test route'},404);
  });



  user={id:1,username:'sensor.qa',display_name:'Kiểm tra'};
  tanks=[{id:1,name:'Bể kiểm tra',device_id:'tank-sensors',connectivity:'online',open_alerts:0,latest:reading('tank-sensors')}];
  await page.goto('http://127.0.0.1:5173/?sensor-qa='+Date.now()+'#/tank/tank-sensors');
  await page.locator('#history-chart').waitFor();
  for(const card of ['temperature','ph','turbidity'])await page.locator(`#${card}-card .status-badge`).filter({hasText:'Đang hoạt động'}).waitFor();
  failed=true;await page.reload();await page.locator('#history-chart').waitFor();
  for(const card of ['temperature','ph','turbidity']){
    await page.locator(`#${card}-card .status-badge`).filter({hasText:'Mất kết nối'}).waitFor();
    check(await page.locator(`#${card}-card`).getAttribute('data-reading-state')==='stale','Invalid numeric reading was shown live');
    check(await page.locator(`#${card}-card [data-trend]`).innerText().then(t=>t.includes('Giá trị lúc')),'Last reading time missing');
  }
  check(await page.locator('#set-clean-reference').isDisabled(),'Baseline allowed invalid sensor');
  await page.screenshot({path:'output/playwright/sensor-disconnected.png'});
  failed=false;await page.reload();await page.locator('#history-chart').waitFor();
  for(const card of ['temperature','ph','turbidity'])await page.locator(`#${card}-card .status-badge`).filter({hasText:'Đang hoạt động'}).waitFor();
  check(!errors.length,errors.join('; '));return {passed:true,checks:['healthy','invalid health despite numeric values','stale timestamps','baseline disabled','reconnected'],runtimeErrors:errors,realBackendWrites:0};
}
