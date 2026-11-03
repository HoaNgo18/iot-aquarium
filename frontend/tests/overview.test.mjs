import test from 'node:test'
import assert from 'node:assert/strict'
import {sparkline,chooseOverviewTank,overviewSummary} from '../src/app/overview.ts'
const sample=(minute,value)=>({measured_at:new Date(Date.UTC(2026,10,4,0,minute)).toISOString(),temperature_c:value})
test('sparkline scales extrema and uses timestamps for x',()=>{
 const result=sparkline([sample(0,20),sample(5,30),sample(10,25)],'temperature_c')
 assert.equal(result.path,'M4.00,54.00 L120.00,6.00 L236.00,30.00');assert.equal(result.count,3)
})
test('sparkline breaks at null and gaps over ten minutes',()=>{
 const result=sparkline([sample(0,1),sample(1,null),sample(2,2),sample(12,3),sample(23,4)],'temperature_c')
 assert.equal((result.path.match(/M/g)||[]).length,3)
 assert.equal((result.path.match(/L/g)||[]).length,1)
})
test('sparkline handles empty, singleton, constant and invalid values',()=>{
 assert.deepEqual(sparkline([],'temperature_c'),{path:'',count:0})
 assert.deepEqual(sparkline([sample(0,NaN),sample(1,2)],'temperature_c'),{path:'',count:1})
 assert.equal(sparkline([sample(0,5),sample(10,5)],'temperature_c').path,'M4.00,30.00 L236.00,30.00')
 assert.equal(sparkline([{measured_at:'invalid',temperature_c:1},sample(0,2)],'temperature_c').count,1)
})
test('saved overview selection falls back only when missing',()=>{
 const tanks=[{device_id:'a'},{device_id:'b'}]
 assert.equal(chooseOverviewTank(tanks,'b'),'b');assert.equal(chooseOverviewTank(tanks,'removed'),'a');assert.equal(chooseOverviewTank([],null),'')
})
test('summary distinguishes zero counts and due work',()=>{
 assert.deepEqual(overviewSummary('Hòa',2,0,0),{greeting:'Chào Hòa',tanks:'2 bể',alerts:'Không có cảnh báo',due:'Không có việc hôm nay'})
 assert.equal(overviewSummary('Hòa',4,5,6).alerts,'5 cảnh báo');assert.equal(overviewSummary('Hòa',4,5,6).due,'6 việc quá hạn/hôm nay')
})

import {filterOverviewTanks} from '../src/app/overview.ts'
import {motionPreference,resolveMotion} from '../src/app/motion.ts'
test('tank search ignores accents, case and d stroke; sorts alerts then names without mutation',()=>{
 const tanks=[{name:'Bể phụ',device_id:'PHU',open_alerts:0},{name:'Đầm cá',device_id:'DAM',open_alerts:1},{name:'Bể chính',device_id:'MAIN',open_alerts:0}]
 assert.equal(filterOverviewTanks(tanks,'BE PHU')[0].device_id,'PHU');assert.equal(filterOverviewTanks(tanks,'dam')[0].device_id,'DAM')
 assert.deepEqual(filterOverviewTanks(tanks,'').map(t=>t.device_id),['DAM','MAIN','PHU']);assert.deepEqual(filterOverviewTanks(tanks,'xyz'),[]);assert.equal(tanks[0].device_id,'PHU')
})
test('motion honors explicit override and system reduction',()=>{
 assert.equal(motionPreference(null),'system');assert.equal(motionPreference('bad'),'system')
 assert.equal(resolveMotion('on',true),'on');assert.equal(resolveMotion('off',false),'off');assert.equal(resolveMotion('system',true),'off');assert.equal(resolveMotion('system',false),'on')
})
