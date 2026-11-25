// End-to-end API tests (the 14 required scenarios + security checks) against a throwaway database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unibite-test-'));
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.ADMIN_EMAIL = 'owner-of-platform@test.edu';
process.env.ADMIN_PASSWORD = 'RootPassword123';
process.env.UNIVERSITY_EMAIL_DOMAINS = 'uni.edu';
process.env.UNIVERSITY_ID_VERIFICATION = 'roster';
process.env.DISABLE_RATE_LIMIT = 'true';

const app = require('../src/app');
const { ensureAdmin } = require('../src/db/bootstrap');
const { one, run } = require('../src/db');
const totp = require('../src/services/totp');

let server;
let base;

/** Tiny cookie-jar client. */
function client() {
  let cookie = '';
  return async (method, url, body, { form, headers: extra = {} } = {}) => {
    const headers = { 'X-Requested-With': 'UniBite', ...extra };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}

/** Pull the latest emailed link for `to` out of the outbox. */
function lastLink(to, pathPart) {
  const row = one(`SELECT text_body FROM email_outbox WHERE to_email = ? AND text_body LIKE ? ORDER BY id DESC LIMIT 1`, to, `%${pathPart}%`);
  assert.ok(row, `expected an email to ${to} containing ${pathPart}`);
  const url = row.text_body.match(/https?:\/\/\S+/)[0];
  return new URL(url).searchParams.get('token');
}

const admin = client();
const student = client();
const student2 = client();
const owner = client();
const owner2 = client();
const anon = client();
let catId;
let restaurantId;      // created by admin (Test 5)
let otherRestaurantId; // created from an application (Test 4)
let productId;
let orderId;

const restaurantForm = (over = {}) => {
  const fd = new FormData();
  const d = {
    name: 'Test Kitchen', description: 'A test restaurant serving test food.', category_id: catId,
    campus_location: 'Building A', contact_phone: '+20 100 000 0000', email: 'kitchen@test.com',
    opening_time: '00:00', closing_time: '00:00', operating_days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', availability_status: 'open', ...over,
  };
  for (const [k, v] of Object.entries(d)) fd.append(k, String(v));
  return fd;
};

before(async () => {
  ensureAdmin();
  for (let i = 1; i <= 20; i++) run('INSERT INTO university_roster (university_id, email) VALUES (?, ?)', String(20240000 + i), i === 20 ? 'reserved@uni.edu' : null);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await admin('POST', '/api/auth/admin/login', { email: 'owner-of-platform@test.edu', password: 'RootPassword123' });
  assert.equal(r.status, 200);
  catId = (await admin('POST', '/api/admin/categories', { name: 'Grill', icon: 'utensils' })).data.category.id;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('TEST 1: Student registration, email verification and login', async () => {
  const reg = await student('POST', '/api/auth/register', {
    name: 'Stu Dent', email: 'stu@uni.edu', university_id: '20240001', password: 'Student123', confirm_password: 'Student123',
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(one(`SELECT status FROM users WHERE email = 'stu@uni.edu'`).status, 'pending');

  // Cannot log in before verifying
  const early = await student('POST', '/api/auth/login', { email: 'stu@uni.edu', password: 'Student123', portal: 'student' });
  assert.equal(early.status, 403);
  assert.equal(early.data.code, 'EMAIL_NOT_VERIFIED');

  const token = lastLink('stu@uni.edu', '/verify-email.html');
  const ver = await student('POST', '/api/auth/verify-email', { token });
  assert.equal(ver.status, 200);
  assert.equal((await student('POST', '/api/auth/verify-email', { token })).status, 400, 'verification link is single-use');

  const login = await student('POST', '/api/auth/login', { email: 'stu@uni.edu', password: 'Student123', portal: 'student' });
  assert.equal(login.status, 200);
  assert.equal(login.data.redirect, '/restaurants.html');
  assert.equal(login.data.user.password_hash, undefined);
  // Student can't use the restaurant portal
  assert.equal((await anon('POST', '/api/auth/login', { email: 'stu@uni.edu', password: 'Student123', portal: 'restaurant' })).data.code, 'WRONG_PORTAL');
  const me = await student('GET', '/api/auth/me');
  assert.equal(me.data.user.university_id, '20240001');
  assert.equal(me.data.user.verification_status, 'verified');
});

test('TEST 2: University email + ID validation and duplicate prevention', async () => {
  const base2 = { name: 'Other', password: 'Student123', confirm_password: 'Student123' };
  const gmail = await anon('POST', '/api/auth/register', { ...base2, email: 'x@gmail.com', university_id: '20240002' });
  assert.equal(gmail.status, 400); assert.ok(gmail.data.fields.email);
  const badFormat = await anon('POST', '/api/auth/register', { ...base2, email: 'a@uni.edu', university_id: 'ABC' });
  assert.ok(badFormat.data.fields.university_id);
  const notInRoster = await anon('POST', '/api/auth/register', { ...base2, email: 'b@uni.edu', university_id: '29999999' });
  assert.match(notInRoster.data.fields.university_id, /not found/);
  const wrongOwner = await anon('POST', '/api/auth/register', { ...base2, email: 'c@uni.edu', university_id: '20240020' });
  assert.match(wrongOwner.data.fields.university_id, /different/);
  const dupId = await anon('POST', '/api/auth/register', { ...base2, email: 'd@uni.edu', university_id: '20240001' });
  assert.match(dupId.data.fields.university_id, /already exists/);
  const dupEmail = await anon('POST', '/api/auth/register', { ...base2, email: 'stu@uni.edu', university_id: '20240003' });
  assert.match(dupEmail.data.fields.email, /already exists/);
  const mismatch = await anon('POST', '/api/auth/register', { ...base2, email: 'e@uni.edu', university_id: '20240004', confirm_password: 'Other1234' });
  assert.ok(mismatch.data.fields.confirm_password);
  // DB constraint also enforces uniqueness
  assert.throws(() => run(`INSERT INTO student_profiles (user_id, university_id) VALUES (1, '20240001')`));

  // second student for later tests
  await student2('POST', '/api/auth/register', { ...base2, name: 'Second', email: 'two@uni.edu', university_id: '20240005' });
  await student2('POST', '/api/auth/verify-email', { token: lastLink('two@uni.edu', '/verify-email.html') });
});

test('TEST 3: Restaurant registration request', async () => {
  const bad = await anon('POST', '/api/public/restaurant-requests', { restaurant_name: 'X' });
  assert.equal(bad.status, 400);
  const r = await anon('POST', '/api/public/restaurant-requests', {
    contact_name: 'Jamal Baker', email: 'jamal@juice.com', phone: '+20 111 111 1111', restaurant_name: 'Juice Bar',
    category_id: catId, description: 'Fresh juices and smoothies daily.', campus_location: 'Gym', additional_info: 'Two staff',
  });
  assert.equal(r.status, 201);
  assert.equal(one('SELECT status FROM restaurant_requests WHERE id = ?', r.data.id).status, 'pending');
  // Admin notified (in-app + email)
  const n = await admin('GET', '/api/admin/notifications');
  assert.ok(n.data.items.some((x) => x.type === 'restaurant_request'));
  assert.ok(one(`SELECT id FROM email_outbox WHERE to_email = 'owner-of-platform@test.edu' AND subject LIKE '%Juice Bar%'`));
  // Duplicate pending application blocked
  const dup = await anon('POST', '/api/public/restaurant-requests', {
    contact_name: 'Jo', email: 'other@juice.com', phone: '+20 111 111 1112', restaurant_name: 'juice bar',
    category_id: catId, description: 'Duplicate application here.', campus_location: 'Gym',
  });
  assert.equal(dup.status, 409);
});

test('TEST 4: Admin approval (creates restaurant + invites applicant) and rejection', async () => {
  const reqRow = one(`SELECT id FROM restaurant_requests WHERE email = 'jamal@juice.com'`);
  const fd = restaurantForm({ name: 'Juice Bar', email: 'jamal@juice.com' });
  fd.append('request_id', String(reqRow.id));
  const r = await admin('POST', '/api/admin/restaurants', undefined, { form: fd });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  otherRestaurantId = r.data.restaurant.id;
  assert.equal(r.data.invitation.email, 'jamal@juice.com');
  assert.equal(one('SELECT status FROM restaurant_requests WHERE id = ?', reqRow.id).status, 'approved');
  assert.ok(one(`SELECT id FROM email_outbox WHERE to_email = 'jamal@juice.com' AND subject LIKE '%approved%'`));

  // Duplicate restaurant record prevented
  const dup = await admin('POST', '/api/admin/restaurants', undefined, { form: restaurantForm({ name: 'JUICE BAR' }) });
  assert.equal(dup.status, 400);

  // Rejection
  const rej = await anon('POST', '/api/public/restaurant-requests', {
    contact_name: 'Nope', email: 'nope@x.com', phone: '+20 111 111 1113', restaurant_name: 'Nope Diner',
    category_id: catId, description: 'This one will be rejected.', campus_location: 'Gate 2',
  });
  assert.equal((await admin('POST', `/api/admin/requests/${rej.data.id}/reject`, { note: 'No space' })).status, 200);
  assert.equal(one('SELECT status FROM restaurant_requests WHERE id = ?', rej.data.id).status, 'rejected');
  assert.ok(one(`SELECT id FROM email_outbox WHERE to_email = 'nope@x.com' AND subject LIKE '%Update%'`));
  assert.equal((await admin('POST', `/api/admin/requests/${rej.data.id}/reject`, {})).status, 409);
  assert.equal(one(`SELECT COUNT(*) n FROM users WHERE email = 'nope@x.com'`).n, 0, 'no access granted');

  // Applicant activates through the emailed invitation
  const token = lastLink('jamal@juice.com', '/accept-invite.html');
  const acc = await owner2('POST', '/api/auth/invitations/accept', { token, name: 'Jamal Baker', password: 'Owner1234', confirm_password: 'Owner1234' });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
});

test('TEST 5: Administrator adds a restaurant and sends an invitation', async () => {
  const fd = restaurantForm({ publish: 'false' });
  const r = await admin('POST', '/api/admin/restaurants', undefined, { form: fd });
  assert.equal(r.status, 201);
  restaurantId = r.data.restaurant.id;
  assert.equal(r.data.restaurant.is_published, false);
  assert.ok(!(await anon('GET', '/api/public/restaurants')).data.items.some((x) => x.id === restaurantId), 'draft is hidden');

  assert.equal((await admin('POST', `/api/admin/restaurants/${restaurantId}/publish`)).status, 200);
  assert.ok((await anon('GET', '/api/public/restaurants')).data.items.some((x) => x.id === restaurantId), 'published is visible');
  assert.ok(one(`SELECT id FROM audit_logs WHERE action = 'restaurant.create' AND entity_id = ?`, restaurantId));

  // Invite, then resend (old link must stop working), then revoke/re-invite
  const inv = await admin('POST', `/api/admin/restaurants/${restaurantId}/invitations`, { email: 'chef@kitchen.com' });
  assert.equal(inv.status, 201);
  const firstToken = lastLink('chef@kitchen.com', '/accept-invite.html');
  const resend = await admin('POST', `/api/admin/invitations/${inv.data.invitation.id}/resend`);
  assert.equal(resend.status, 200);
  assert.equal((await anon('GET', `/api/auth/invitations/${firstToken}`)).data.valid, false, 'old link revoked on resend');
  assert.equal(one('SELECT token_hash FROM restaurant_invitations WHERE id = ?', resend.data.invitation.id).token_hash.length, 64, 'only hash stored');
  // Only the Super Admin can invite
  assert.equal((await student('POST', `/api/admin/restaurants/${restaurantId}/invitations`, { email: 'evil@x.com' })).status, 403);
  assert.equal((await owner2('POST', `/api/admin/restaurants/${restaurantId}/invitations`, { email: 'evil@x.com' })).status, 403);
  // Students' emails can't become owners
  assert.equal((await admin('POST', `/api/admin/restaurants/${restaurantId}/invitations`, { email: 'stu@uni.edu' })).status, 409);
});

test('TEST 6: Restaurant owner accepts invitation and activates account', async () => {
  const token = lastLink('chef@kitchen.com', '/accept-invite.html');
  const preview = await anon('GET', `/api/auth/invitations/${token}`);
  assert.equal(preview.data.valid, true);
  assert.equal(preview.data.restaurant_name, 'Test Kitchen');

  const weak = await owner('POST', '/api/auth/invitations/accept', { token, name: 'Chef', password: 'short', confirm_password: 'short' });
  assert.equal(weak.status, 400);
  // Client cannot choose the restaurant: restaurant_id in the body is ignored
  const acc = await owner('POST', '/api/auth/invitations/accept', { token, name: 'Chef Owner', password: 'Owner1234', confirm_password: 'Owner1234', restaurant_id: otherRestaurantId, role: 'admin' });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(acc.data.redirect, '/restaurant-dashboard.html');
  const u = one(`SELECT * FROM users WHERE email = 'chef@kitchen.com'`);
  assert.equal(u.role, 'restaurant');
  assert.equal(one(`SELECT restaurant_id FROM restaurant_users WHERE user_id = ? AND status = 'active'`, u.id).restaurant_id, restaurantId);
  assert.equal((await anon('POST', '/api/auth/invitations/accept', { token, name: 'X', password: 'Owner1234', confirm_password: 'Owner1234' })).status, 400, 'single-use');
});

test('TEST 7: Restaurant owner logs in and manages their menu and info', async () => {
  const login = await owner('POST', '/api/auth/login', { email: 'chef@kitchen.com', password: 'Owner1234', portal: 'restaurant' });
  assert.equal(login.status, 200);
  assert.equal(login.data.redirect, '/restaurant-dashboard.html');

  const fd = new FormData();
  fd.append('name', 'Burger'); fd.append('price', '50'); fd.append('menu_section', 'Mains'); fd.append('description', 'Juicy');
  const p = await owner('POST', '/api/restaurant/products', undefined, { form: fd });
  assert.equal(p.status, 201);
  productId = p.data.product.id;
  const upd = new FormData(); upd.append('price', '55');
  assert.equal((await owner('PUT', `/api/restaurant/products/${productId}`, undefined, { form: upd })).data.product.price, 55);
  assert.equal((await owner('PATCH', `/api/restaurant/products/${productId}/availability`, { is_available: false })).data.product.is_available, false);
  await owner('PATCH', `/api/restaurant/products/${productId}/availability`, { is_available: true });

  const prof = new FormData(); prof.append('description', 'Updated description for the kitchen.'); prof.append('name', 'Hacked Name');
  const pr = await owner('PUT', '/api/restaurant/profile', undefined, { form: prof });
  assert.equal(pr.status, 200);
  assert.equal(pr.data.restaurant.description, 'Updated description for the kitchen.');
  assert.equal(pr.data.restaurant.name, 'Test Kitchen', 'owner cannot rename (admin-controlled field)');
  const pub = await anon('GET', `/api/public/restaurants/${restaurantId}`);
  assert.equal(pub.data.menu[0].price, 55);
  assert.equal(pub.data.restaurant.description, 'Updated description for the kitchen.');
});

test('TEST 8: Restaurant owner receives and updates orders', async () => {
  const o = await student('POST', '/api/student/orders', { restaurant_id: restaurantId, items: [{ product_id: productId, quantity: 2 }] });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.equal(o.data.order.total, 110, 'price from DB, not client');
  orderId = o.data.order.id;

  const incoming = await owner('GET', '/api/restaurant/orders?scope=active');
  const mine = incoming.data.items.find((x) => x.id === orderId);
  assert.ok(mine);
  assert.equal(mine.student_email, undefined, 'owner does not see student email');
  assert.equal((await owner('GET', `/api/restaurant/orders/${orderId}`)).data.order.items.length, 1);
  assert.equal((await owner('PATCH', `/api/restaurant/orders/${orderId}/status`, { status: 'ready' })).status, 409, 'cannot skip steps');
  for (const s of ['accepted', 'preparing', 'ready', 'completed']) {
    assert.equal((await owner('PATCH', `/api/restaurant/orders/${orderId}/status`, { status: s })).status, 200);
  }
  assert.equal((await student('GET', `/api/student/orders/${orderId}`)).data.order.status, 'completed');
  assert.equal((await student('POST', `/api/student/orders/${orderId}/rating`, { score: 5, comment: 'Great' })).status, 201);
  const perf = await owner('GET', '/api/restaurant/performance');
  assert.equal(perf.data.rating.average, 5);
  assert.equal(perf.data.reviews[0].comment, 'Great');

  // Reject flow
  const o2 = await student2('POST', '/api/student/orders', { restaurant_id: restaurantId, items: [{ product_id: productId, quantity: 1 }] });
  assert.equal((await owner('PATCH', `/api/restaurant/orders/${o2.data.order.id}/status`, { status: 'rejected', note: 'Out of buns' })).status, 200);
});

let openOrderId;
test('TEST 9: Super Admin deactivates a restaurant', async () => {
  const open = await student('POST', '/api/student/orders', { restaurant_id: restaurantId, items: [{ product_id: productId, quantity: 1 }] });
  openOrderId = open.data.order.id;
  await owner('PATCH', `/api/restaurant/orders/${openOrderId}/status`, { status: 'accepted' });

  const d = await admin('POST', `/api/admin/restaurants/${restaurantId}/deactivate`, { reason: 'Closed for renovation' });
  assert.equal(d.status, 200);
  assert.equal(d.data.open_orders, 1);
  assert.ok(!(await anon('GET', '/api/public/restaurants')).data.items.some((x) => x.id === restaurantId));
  assert.equal((await anon('GET', `/api/public/restaurants/${restaurantId}`)).status, 404);
  assert.ok(!(await anon('GET', '/api/public/menu-items?q=Burger')).data.items.some((x) => x.restaurant.id === restaurantId));
  assert.equal((await student('POST', '/api/student/orders', { restaurant_id: restaurantId, items: [{ product_id: productId, quantity: 1 }] })).status, 404, 'no new orders');

  // Owner: menu/profile edits blocked, but existing orders can be completed
  const fd = new FormData(); fd.append('name', 'Fries'); fd.append('price', '10');
  assert.equal((await owner('POST', '/api/restaurant/products', undefined, { form: fd })).status, 403);
  assert.equal((await owner('PATCH', '/api/restaurant/availability', { availability_status: 'open' })).status, 403);
  const prof = new FormData(); prof.append('description', 'Should not be saved at all.');
  assert.equal((await owner('PUT', '/api/restaurant/profile', undefined, { form: prof })).status, 403);
  assert.equal((await owner('GET', '/api/restaurant/overview')).data.restaurant.is_active, false);
  for (const s of ['preparing', 'ready', 'completed']) {
    assert.equal((await owner('PATCH', `/api/restaurant/orders/${openOrderId}/status`, { status: s })).status, 200);
  }
  const log = one(`SELECT before_data, after_data FROM audit_logs WHERE action = 'restaurant.deactivate' AND entity_id = ?`, restaurantId);
  assert.deepEqual(JSON.parse(log.before_data), { is_active: true });
  assert.deepEqual(JSON.parse(log.after_data), { is_active: false });
});

test('TEST 10: Existing orders remain accessible after deactivation', async () => {
  const hist = await student('GET', '/api/student/orders');
  assert.equal(hist.data.items.find((o) => o.id === orderId).status, 'completed');
  assert.equal((await student('GET', `/api/student/orders/${openOrderId}`)).data.order.status, 'completed');
  assert.ok((await owner('GET', '/api/restaurant/orders?scope=history')).data.items.some((o) => o.id === orderId));
  const adminView = await admin('GET', `/api/admin/restaurants/${restaurantId}`);
  assert.equal(adminView.data.restaurant.is_active, false);
  assert.ok(adminView.data.recent_orders.length >= 3);
  assert.ok((await admin('GET', '/api/admin/restaurants?status=inactive')).data.items.some((x) => x.id === restaurantId));
});

test('TEST 11: Super Admin reactivates a restaurant (same record)', async () => {
  const before = one('SELECT COUNT(*) n FROM restaurants').n;
  assert.equal((await admin('POST', `/api/admin/restaurants/${restaurantId}/reactivate`)).status, 200);
  assert.equal(one('SELECT COUNT(*) n FROM restaurants').n, before, 'no new record');
  assert.ok((await anon('GET', '/api/public/restaurants')).data.items.some((x) => x.id === restaurantId));
  const fd = new FormData(); fd.append('name', 'Fries'); fd.append('price', '10');
  assert.equal((await owner('POST', '/api/restaurant/products', undefined, { form: fd })).status, 201, 'owner can edit again');
  const o = await student('POST', '/api/student/orders', { restaurant_id: restaurantId, items: [{ product_id: productId, quantity: 1 }] });
  assert.equal(o.status, 201);
});

test('TEST 12: Unauthorized users cannot access the Admin Dashboard', async () => {
  for (const c of [anon, student, owner]) {
    assert.ok([401, 403].includes((await c('GET', '/api/admin/overview')).status));
    assert.ok([401, 403].includes((await c('POST', '/api/admin/categories', { name: 'Hack' })).status));
    assert.ok([401, 403].includes((await c('GET', '/api/admin/students')).status));
  }
  const page = await anon('GET', '/admin/');
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/admin\/login/);
  assert.equal((await student('GET', '/admin/')).status, 403);
  assert.equal((await owner('GET', '/admin/')).status, 403);
  assert.equal((await admin('GET', '/admin/')).status, 200);
  assert.equal((await anon('GET', '/admin/login')).status, 200);
  // Admin credentials are rejected on the public portal, and non-admins on the admin login
  assert.equal((await anon('POST', '/api/auth/login', { email: 'owner-of-platform@test.edu', password: 'RootPassword123', portal: 'student' })).status, 401);
  assert.equal((await anon('POST', '/api/auth/admin/login', { email: 'stu@uni.edu', password: 'Student123' })).status, 401);
  // No public endpoint creates admins / changes roles
  assert.equal((await admin('POST', '/api/admin/users', { email: 'x@x.com', role: 'admin' })).status, 404);
  // CSRF header required
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('TEST 13: Restaurant owners cannot access another restaurant\'s data', async () => {
  // owner2 manages Juice Bar; try to touch Test Kitchen
  await owner2('POST', '/api/auth/login', { email: 'jamal@juice.com', password: 'Owner1234', portal: 'restaurant' });
  const f = new FormData(); f.append('price', '1');
  assert.equal((await owner2('PUT', `/api/restaurant/products/${productId}`, undefined, { form: f })).status, 404);
  assert.equal((await owner2('DELETE', `/api/restaurant/products/${productId}`)).status, 404);
  assert.equal((await owner2('GET', `/api/restaurant/orders/${orderId}`)).status, 404);
  assert.equal((await owner2('PATCH', `/api/restaurant/orders/${orderId}/status`, { status: 'completed' })).status, 404);
  assert.ok(!(await owner2('GET', '/api/restaurant/orders?scope=history')).data.items.some((o) => o.restaurant_id === restaurantId));
  assert.equal((await owner2('PUT', `/api/admin/restaurants/${restaurantId}`, undefined, { form: restaurantForm() })).status, 403);
  // Owners can't change their own role / restaurant
  assert.equal((await owner2('POST', `/api/admin/restaurant-accounts/1/reassign`, { restaurant_id: restaurantId })).status, 403);
  assert.equal(one(`SELECT role FROM users WHERE email = 'jamal@juice.com'`).role, 'restaurant');
  // Students can't use restaurant endpoints
  assert.equal((await student('GET', '/api/restaurant/orders')).status, 403);
});

test('TEST 14: Historical orders and ratings preserved; audit log is append-only', async () => {
  assert.ok(one('SELECT id FROM orders WHERE id = ?', orderId));
  assert.equal(one('SELECT COUNT(*) n FROM ratings WHERE restaurant_id = ?', restaurantId).n, 1);
  assert.equal(one('SELECT product_name FROM order_items WHERE order_id = ?', orderId).product_name, 'Burger');
  // Removing a product keeps order history
  await owner('DELETE', `/api/restaurant/products/${productId}`);
  assert.equal((await student('GET', `/api/student/orders/${orderId}`)).data.order.items[0].product_name, 'Burger');
  // Records can't be hard-deleted while history exists
  assert.throws(() => run('DELETE FROM restaurants WHERE id = ?', restaurantId));
  assert.throws(() => run('DELETE FROM audit_logs'));
  assert.throws(() => run(`UPDATE audit_logs SET action = 'x'`));
});

test('Account management: students, restaurant accounts, reassignment, reset', async () => {
  const sid = one(`SELECT id FROM users WHERE email = 'two@uni.edu'`).id;
  const list = await admin('GET', '/api/admin/students?q=two');
  assert.equal(list.data.items[0].university_id, '20240005');
  assert.equal(list.data.items[0].password_hash, undefined);
  assert.equal((await admin('POST', `/api/admin/students/${sid}/deactivate`)).status, 200);
  assert.equal((await student2('GET', '/api/student/orders')).status, 401, 'session revoked');
  assert.equal((await student2('POST', '/api/auth/login', { email: 'two@uni.edu', password: 'Student123', portal: 'student' })).data.code, 'ACCOUNT_DEACTIVATED');
  assert.ok(one('SELECT COUNT(*) n FROM orders WHERE student_id = ?', sid).n >= 1, 'history kept');
  assert.equal((await admin('POST', `/api/admin/students/${sid}/activate`)).status, 200);

  const acc = (await admin('GET', '/api/admin/restaurant-accounts?q=jamal')).data.items[0];
  assert.equal(acc.restaurant_id, otherRestaurantId);
  // Reassign blocked when target already has an owner
  assert.equal((await admin('POST', `/api/admin/restaurant-accounts/${acc.id}/reassign`, { restaurant_id: restaurantId })).status, 409);
  assert.equal((await admin('POST', `/api/admin/restaurant-accounts/${acc.id}/deactivate`)).status, 200);
  assert.equal((await owner2('GET', '/api/restaurant/overview')).status, 401);
  assert.equal((await admin('POST', `/api/admin/restaurant-accounts/${acc.id}/reactivate`)).status, 200);
  assert.equal((await admin('POST', `/api/admin/restaurant-accounts/${acc.id}/reset-access`)).status, 200);
  const t = lastLink('jamal@juice.com', '/reset-password.html');
  assert.equal((await anon('POST', '/api/auth/reset-password', { token: t, password: 'NewOwner123', confirm_password: 'NewOwner123' })).status, 200);
  assert.equal((await owner2('POST', '/api/auth/login', { email: 'jamal@juice.com', password: 'NewOwner123', portal: 'restaurant' })).status, 200);

  // Replace owner via invitation
  assert.equal((await admin('POST', `/api/admin/restaurants/${otherRestaurantId}/invitations`, { email: 'new@juice.com' })).status, 409);
  assert.equal((await admin('POST', `/api/admin/restaurants/${otherRestaurantId}/invitations`, { email: 'new@juice.com', replace_owner: true })).status, 201);
  const tok = lastLink('new@juice.com', '/accept-invite.html');
  assert.equal((await anon('POST', '/api/auth/invitations/accept', { token: tok, name: 'New Owner', password: 'Owner1234', confirm_password: 'Owner1234' })).status, 200);
  assert.equal((await owner2('GET', '/api/restaurant/overview')).status, 401, 'previous owner signed out');
  assert.equal((await owner2('POST', '/api/auth/login', { email: 'jamal@juice.com', password: 'NewOwner123', portal: 'restaurant' })).data.code, 'NO_RESTAURANT');
});

test('Super Admin 2FA and forgot-password flow', async () => {
  const setup = await admin('POST', '/api/admin/security/2fa/setup');
  assert.match(setup.data.qr, /^data:image\/png/);
  assert.equal((await admin('POST', '/api/admin/security/2fa/enable', { code: '000000' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/security/2fa/enable', { code: totp.generate(setup.data.secret) })).status, 200);
  const fresh = client();
  const step1 = await fresh('POST', '/api/auth/admin/login', { email: 'owner-of-platform@test.edu', password: 'RootPassword123' });
  assert.equal(step1.data.mfa_required, true);
  assert.equal((await fresh('GET', '/api/admin/overview')).status, 401, 'no session before 2FA');
  assert.equal((await fresh('POST', '/api/auth/admin/mfa', { mfa_token: step1.data.mfa_token, code: '123456' })).status, 400);
  assert.equal((await fresh('POST', '/api/auth/admin/mfa', { mfa_token: step1.data.mfa_token, code: totp.generate(setup.data.secret) })).status, 200);
  assert.equal((await fresh('GET', '/api/admin/overview')).status, 200);

  assert.equal((await anon('POST', '/api/auth/forgot-password', { email: 'nobody@uni.edu' })).status, 200, 'no enumeration');
  await anon('POST', '/api/auth/forgot-password', { email: 'stu@uni.edu' });
  const t = lastLink('stu@uni.edu', '/reset-password.html');
  assert.equal((await anon('POST', '/api/auth/reset-password', { token: t, password: 'Changed123', confirm_password: 'Changed123' })).status, 200);
  assert.equal((await student('GET', '/api/student/orders')).status, 401, 'old sessions revoked after reset');
});
