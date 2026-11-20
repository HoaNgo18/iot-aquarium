async page => {
  // Isolated API fixture: all account/tank/reminder writes stay in this browser.
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [], unexpected = [], writes = [];
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
  const alerts = tank => tank.open_alerts ? [{ id:88, device_id:tank.device_id, alert_type:'temperature', severity:'warning',
    message:'Nhiệt độ vượt khoảng đã đặt.', started_at:stamp(), ended_at:null, acknowledged_at:null }] : [];
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
      if(suffix==='/telemetry/series')return reply(Array.from({length:30},(_,i)=>({...row,id:i,measured_at:new Date(Date.now()-(29-i)*60000).toISOString()})));
      if(suffix==='/thresholds')return reply({...values,turbidity_warning_pct:45,turbidity_critical_pct:70});
      if(suffix==='/clarity/config')return reply(values);
      if(suffix==='/clarity/baselines'||suffix==='/settings/history')return reply([]);
      if(suffix==='/settings')return reply({device_id:device[1],revision:0,values,defaults:values});
      if(!suffix)return reply({id:device[1],connectivity:tank.connectivity,sensor_status:'normal',last_seen_at:stamp()});
    }
    unexpected.push(`${method} ${path}`); return reply({detail:'Unexpected test route'},404);
  });
  const goto = async hash => { await page.goto(`http://127.0.0.1:5173/${hash}`); };
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({colorScheme:'dark'});
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://127.0.0.1:5173/?shell-qa=1');
  await goto('#/');
  await page.getByRole('heading',{name:'Chào mừng trở lại'}).waitFor();
  await page.getByLabel('Tên đăng nhập',{exact:true}).fill('x');
  await page.getByLabel('Mật khẩu',{exact:true}).fill('short');
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  check(writes.length===0,'Invalid login must not send');
  await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();
  await page.getByLabel('Tên hiển thị',{exact:true}).fill('Hòa');
  await page.getByLabel('Tên đăng nhập',{exact:true}).fill('hoa.test');
  await page.getByLabel('Mật khẩu',{exact:true}).fill('testing-123');
  await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('different');
  await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();
  check(writes.length===0,'Mismatched password must not send');
  await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('testing-123');
  await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();
  await page.getByRole('heading',{name:'Kết nối bể cá đầu tiên'}).waitFor();
  check(await page.getByText('Số đo minh họa. Thêm bể để xem dữ liệu của bạn.').isVisible(),'Empty scene must disclose demo');
  await page.screenshot({path:'output/playwright/shell-overview-empty-dark.png',fullPage:true});
  await page.getByRole('link',{name:'Thêm bể đầu tiên',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Thêm bể mới'});
  await dialog.waitFor();
  await dialog.getByLabel('Tên bể',{exact:true}).fill('Bể phòng khách <img src=x>');
  await dialog.getByLabel('Mã thiết bị',{exact:true}).fill('tank-fixture-001');
  await dialog.getByLabel('Mã ghép nối',{exact:true}).fill('BBBB-BBBB');
  await dialog.getByLabel('Thể tích (lít, tuỳ chọn)').fill('60');
  await dialog.getByLabel('Loài cá (tuỳ chọn)').fill('Cá cảnh');
  await dialog.getByRole('button',{name:'Thêm bể',exact:true}).click();
  await dialog.getByRole('alert').waitFor();
  await dialog.getByLabel('Mã ghép nối',{exact:true}).fill('AAAA-AAAA');
  await dialog.getByRole('button',{name:'Thêm bể',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Bể phòng khách <img src=x>'}).waitFor();
  check(await page.locator('.shell-tank-card img').count()===0,'Tank name must be plain text');
  const edit=page.getByRole('button',{name:'Sửa bể Bể phòng khách <img src=x>'});
  await edit.click();
  const editDialog=page.getByRole('dialog',{name:'Sửa thông tin bể'});
  check(await editDialog.getByLabel('Mã thiết bị',{exact:true}).count()===0,'Edit must not offer device id');
  await editDialog.getByLabel('Tên bể',{exact:true}).fill('Bể phòng khách');
  await editDialog.getByRole('button',{name:'Lưu thay đổi'}).click();
  await editDialog.waitFor({state:'hidden'});
  await page.getByRole('link',{name:'Xem',exact:true}).click();
  await page.locator('#history-chart').waitFor();
  check(await page.locator('.is-embedded .brand').isVisible()===false,'Embedded dashboard brand must hide');
  await page.screenshot({path:'output/playwright/shell-tank-detail-dark.png',fullPage:true});
  await page.locator('.shell-nav a[href="#/reminders"]').click();
  await page.getByRole('button',{name:'Thêm nhắc việc',exact:true}).click();
  const reminderDialog=page.getByRole('dialog',{name:'Thêm nhắc việc'});
  await reminderDialog.getByLabel('Việc cần làm',{exact:true}).fill('Kiểm tra lọc');
  await reminderDialog.getByLabel('Ngày đến hạn',{exact:true}).fill(today);
  await reminderDialog.getByRole('combobox',{name:'Lặp lại',exact:true}).selectOption('daily');
  await reminderDialog.getByRole('combobox',{name:'Bể (tuỳ chọn)',exact:true}).selectOption(String(tanks[0].id));
  await reminderDialog.getByRole('button',{name:'Lưu nhắc việc'}).click();
  await reminderDialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Đánh dấu xong: Kiểm tra lọc'}).click();
  await page.getByRole('status').filter({hasText:'Đã xong · lần tới'}).waitFor();
  check(reminders[0].due_date===tomorrow,'Repeat must show next due date');
  // A one-time reminder exercises complete/reopen and delete confirmation.
  reminders.push({id:++id,title:'Thay nước',note:null,tank_id:null,tank_name:null,repeat:'none',due_date:yesterday,done_at:null,last_done_at:null});
  tanks[0].open_alerts=1;
  await goto('#/reminders');
  await page.getByRole('button',{name:'Đánh dấu xong: Thay nước'}).click();
  await page.getByRole('button',{name:'Mở lại: Thay nước'}).click();
  await page.getByRole('button',{name:'Xoá nhắc việc Thay nước'}).click();
  await page.getByRole('dialog',{name:'Xoá nhắc việc?'}).getByRole('button',{name:'Hủy',exact:true}).click();
  check(reminders.length===2,'Cancel must not delete reminder');
  await page.locator('.shell-nav a[href="#/notifications"]').click();
  await page.getByRole('heading',{name:'Cảnh báo đang mở'}).waitFor();
  await page.getByRole('heading',{name:'Nhắc việc đến hạn'}).waitFor();
  check(await page.locator('.shell-count').first().innerText()==='2','Notification badge must aggregate due and alerts');
  failAlerts=true; failReminders=true;
  await page.getByRole('button',{name:'Làm mới',exact:true}).click();
  await page.getByRole('alert').waitFor();
  await page.waitForFunction(() => !document.querySelector('.shell-loading'));
  failAlerts=false; failReminders=false;
  await page.getByRole('button',{name:'Thử lại',exact:true}).click();
  await page.getByRole('alert').waitFor({state:'hidden'});
  await page.locator('.shell-nav a[href="#/settings"]').click();
  await page.getByLabel('Sáng',{exact:true}).check();
  check(await page.locator('html').getAttribute('data-theme')==='light','Light theme not applied');
  await page.getByLabel('Tên hiển thị',{exact:true}).fill('Hòa mới');
  await page.getByRole('button',{name:'Lưu hồ sơ'}).click();
  await page.getByText('Đã lưu tên hiển thị.',{exact:true}).waitFor();
  await page.getByLabel('Mật khẩu hiện tại',{exact:true}).fill('wrong-password');
  await page.getByLabel('Mật khẩu mới',{exact:true}).fill('new-testing-123');
  await page.getByLabel('Nhập lại mật khẩu mới',{exact:true}).fill('new-testing-123');
  await page.getByRole('button',{name:'Đổi mật khẩu',exact:true}).click();
  await page.getByText('Mật khẩu hiện tại không đúng',{exact:true}).waitFor();
  await page.getByLabel('Mật khẩu hiện tại',{exact:true}).fill('testing-123');
  await page.getByRole('button',{name:'Đổi mật khẩu',exact:true}).click();
  await page.getByText('Đã đổi mật khẩu. Các phiên trên thiết bị khác đã đăng xuất.',{exact:true}).waitFor();
  await page.getByLabel('Theo hệ thống',{exact:true}).check();
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  check(await page.locator('html').getAttribute('data-theme')==='dark','System dark theme not applied');
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  check(await page.locator('html').getAttribute('data-theme')==='light','System theme change ignored');
  await page.locator('.shell-nav a[href="#/"]').click();
  await page.screenshot({path:'output/playwright/shell-overview-light.png',fullPage:true});
  // Mobile menu: focus trap from native dialog, Escape, outside click and navigation.
  await page.setViewportSize({width:360,height:800});
  await page.getByRole('button',{name:'Mở điều hướng'}).click();
  await page.getByRole('dialog',{name:'Điều hướng AquaSense'}).waitFor();
  await page.keyboard.press('Escape');
  check(await page.getByRole('dialog',{name:'Điều hướng AquaSense'}).isVisible()===false,'Escape must close menu');
  await page.getByRole('button',{name:'Mở điều hướng'}).click();
  await page.mouse.click(340,400);
  check(await page.getByRole('dialog',{name:'Điều hướng AquaSense'}).isVisible()===false,'Backdrop must close menu');
  const noOverflow=async()=>check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
  await noOverflow();
  await page.screenshot({path:'output/playwright/shell-overview-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Mở điều hướng'}).click();
  await page.getByRole('dialog',{name:'Điều hướng AquaSense'}).getByRole('link',{name:'Bể của tôi',exact:true}).click();
  await page.getByRole('heading',{name:'Bể của tôi',exact:true}).waitFor();
  await noOverflow();
  await page.screenshot({path:'output/playwright/shell-tanks-mobile.png',fullPage:true});
  await page.getByRole('link',{name:'Xem',exact:true}).click();
  await page.locator('#history-chart').waitFor();
  await noOverflow();
  await page.screenshot({path:'output/playwright/shell-detail-mobile.png',fullPage:true});
  // Route guards and expired sessions must not expose the embedded dashboard.
  await goto('#/tank/not-owned');
  await page.getByRole('heading',{name:'Không tìm thấy bể'}).waitFor();
  check(await page.locator('#history-chart').count()===0,'Unknown tank rendered dashboard');
  expired=true;
  await goto('#/tanks');
  await page.getByRole('heading',{name:'Chào mừng trở lại'}).waitFor();
  check(await page.locator('.shell-sidebar').count()===0,'Expired session retained application shell');
  // Re-login, endpoint failure/retry, tank removal, persisted sidebar state.
  expired=false;
  await page.getByLabel('Tên đăng nhập',{exact:true}).fill('hoa.test');
  await page.getByLabel('Mật khẩu',{exact:true}).fill('testing-123');
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.getByRole('heading',{name:'Bể của tôi',exact:true}).waitFor();
  failTanks=true;
  await goto('#/tanks');
  await page.getByRole('alert').filter({hasText:'Chưa tải được bể'}).waitFor();
  failTanks=false;
  await page.getByRole('button',{name:'Thử lại',exact:true}).click();
  await page.getByRole('heading',{name:'Bể phòng khách',exact:true}).waitFor();
  await page.getByRole('button',{name:'Xoá bể Bể phòng khách'}).click();
  const deleteDialog=page.getByRole('dialog',{name:'Xoá bể khỏi tài khoản?'});
  check((await deleteDialog.innerText()).includes('Dữ liệu đo vẫn được giữ'),'Missing unlink explanation');
  await deleteDialog.getByRole('button',{name:'Xoá',exact:true}).click();
  await deleteDialog.waitFor({state:'hidden'});
  check(tanks.length===0,'Tank not deleted in fixture');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Thu gọn thanh bên'}).click();
  await goto('#/');
  check(await page.locator('.shell-sidebar.is-collapsed').count()===1,'Sidebar preference not persisted');
  await page.reload();
  await page.locator('.shell-sidebar.is-collapsed').waitFor();
  await page.locator('.shell-nav a[href="#/settings"]').click();
  await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();
  await page.getByRole('heading',{name:'Chào mừng trở lại'}).waitFor();
  check(await page.locator('.shell-sidebar').count()===0,'Logout retained application shell');
  check(errors.length===0,`Runtime errors: ${errors.join('; ')}`);
  check(unexpected.length===0,`Unexpected endpoints: ${unexpected.join('; ')}`);
  return {passed:true,writes:writes.length,realBackendWrites:0,runtimeErrors:errors,checks:['auth/validation','tank CRUD/pairing','literal server text','embedded dashboard','reminders/complete/reopen','notification count','profile/password','theme/system','360px/no overflow','mobile menu/Escape/backdrop','401/ownership','API retry','persisted sidebar']};
}
