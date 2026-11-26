const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const root = path.resolve(__dirname, '..');
const renderSource = fs.readFileSync(path.join(root, 'assets', 'js', 'app-render.js'), 'utf8');
const accessSource = fs.readFileSync(path.join(root, 'assets', 'js', 'admin-access.js'), 'utf8');
function rpcBlock(name) {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'sql', 'supabase_arena_setup.sql'), 'utf8');
  const at = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(at >= 0, `thiếu RPC ${name}`);
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION public.', at + 10);
  return sql.slice(at, next < 0 ? undefined : next);
}

test('attrArg escape an toàn dữ liệu HTML/JS đặc biệt', () => {
  const window = {};
  runInNewContext(renderSource, { window });
  const { attrArg } = window.AppRender;
  const output = attrArg(`<script>alert('x')<\\/script> ' " \\ &`);
  assert.match(output, /^&#39;/);
  assert.equal(output.includes('<script'), false);
  assert.equal(output.includes('</script>'), false);
  assert.match(output, /&lt;|&gt;|&amp;|&quot;|&#39;/);
  assert.match(output, /\\\\/);
  assert.equal(attrArg(12), '12');
});

test('removeAdminIp dùng itemIndex/deviceCode và bảo vệ Master cùng IP', () => {
  assert.match(accessSource, /const targetIdx = itemIndex === -1 \? list\.findIndex\(matchesIdentifier\) : itemIndex/);
  assert.match(accessSource, /!matchesIdentifier\(list\[targetIdx\]\)/);
  assert.match(accessSource, /if \(isEntryMaster\(item\)\)/);
  assert.match(accessSource, /currentList\?\.\[targetIdx\] !== item/);
  const entries = [{ ip: '14.164.221.205', deviceCode: 'MASTER-1', isMaster: true }, { ip: '14.164.221.205', deviceCode: 'STUDENT-2' }];
  assert.equal(entries[1].ip, entries[0].ip); assert.notEqual(entries[1].deviceCode, entries[0].deviceCode);
});

test('khóa Master cập nhật đúng thiết bị khi nhiều Admin dùng chung IP', async () => {
  const window = {};
  runInNewContext(accessSource, { window });
  const ip = '192.0.2.10';
  const otherAdmin = { ip, deviceCode: 'QM-PEER01', token: 'PEER01' };
  const oldMaster = { ip, deviceCode: 'QM-MASTER1', isMaster: true };
  const writes = [];
  const toggle = { checked: false };
  const state = {
    deviceCode: 'QM-MASTER2',
    clientIp: ip,
    adminConfig: { masterIp: ip, masterDeviceCode: oldMaster.deviceCode, allowedIps: [otherAdmin, oldMaster] },
    aiIps: [],
    tokens: [],
    client: {
      from: () => ({
        upsert: async (row) => { writes.push(JSON.parse(row.score_summary)); return {}; }
      })
    }
  };
  const access = window.AdminAccess.configure({
    state,
    $: id => id === 'master-device-lock-toggle' ? toggle : null,
    SYSTEM: { admin: 'config' },
    notify() {}
  });

  await access.toggleMasterIpLock(true);
  assert.equal(state.adminConfig.allowedIps[0], otherAdmin);
  assert.equal(writes[0].allowedIps[1].deviceCode, state.deviceCode);
  assert.equal(writes[0].masterDeviceCode, state.deviceCode);
  assert.equal(toggle.checked, true);

  await access.toggleMasterIpLock(false);
  assert.equal(writes[1].masterDeviceCode, '');
  assert.equal(state.adminConfig.masterDeviceCode, '');
  assert.equal(toggle.checked, false);
});

test('các RPC Arena yêu cầu token phiên và dùng IS DISTINCT FROM', () => {
  for (const name of ['arena_submit_answer', 'arena_log_violation', 'arena_finish_attempt']) {
    const block = rpcBlock(name);
    assert.match(block, /SESSION_TOKEN_REQUIRED/);
    assert.match(block, /IS DISTINCT FROM/);
  }
});

