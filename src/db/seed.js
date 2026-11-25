/**
 * DEMO DATA for local development. Run with `npm run seed` (`npm run seed -- --reset` to wipe first).
 * Refuses to run in production — provision the real Super Admin with `npm run admin:create`.
 */
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { DB_PATH, IS_PROD } = require('../config');

if (IS_PROD) {
  console.error('Refusing to load demo data in production. Use `npm run admin:create` to provision the Super Admin.');
  process.exit(1);
}
// `--reset` may arrive as an argument, or (when PowerShell swallows `--`) as npm's config env var
const RESET = process.argv.includes('--reset') || process.env.npm_config_reset === 'true';
if (RESET) {
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
}
const { one, all, run, tx } = require('./index');

if (one('SELECT id FROM users LIMIT 1')) {
  console.log('\n*** NOTHING CHANGED: the database already has data. ***\nRun `npm run seed:reset` to wipe it and load the demo accounts.\n');
  process.exit(0);
}

const hash = (p) => bcrypt.hashSync(p, 10);
const user = (name, email, password, role) => run(
  `INSERT INTO users (name, email, password_hash, role, status, email_verified_at) VALUES (?, ?, ?, ?, 'active', datetime('now'))`,
  name, email, hash(password), role
).lastInsertRowid;

tx(() => {
  const admin = user('Platform Owner', 'admin@unibite.edu', 'SuperAdmin2026', 'admin');

  // Official roster used to verify University IDs (demo range 20230001–20230050)
  for (let i = 1; i <= 50; i++) run('INSERT INTO university_roster (university_id) VALUES (?)', String(20230000 + i));

  const cats = {};
  for (const [name, icon, desc] of [
    ['Restaurant', 'utensils', 'Full meals and hot dishes'],
    ['Café', 'coffee', 'Coffee, tea, pastries and light bites'],
    ['Food Truck', 'truck', 'Street food on the move around campus'],
    ['Bakery', 'cake', 'Fresh bread, cakes and desserts'],
    ['Healthy', 'salad', 'Salads, bowls and smoothies'],
  ]) cats[name] = run('INSERT INTO categories (name, icon, description) VALUES (?, ?, ?)', name, icon, desc).lastInsertRowid;

  const restaurants = [
    { name: 'The Grill House', cat: 'Restaurant', loc: 'Student Union, Ground Floor', desc: 'Flame-grilled burgers, wraps and loaded fries made to order between lectures.', open: '10:00', close: '22:00', days: 'Mon,Tue,Wed,Thu,Fri,Sat',
      menu: [['Classic Beef Burger', 'Beef patty, cheddar, lettuce, tomato, house sauce', 85, 'Burgers'], ['Crispy Chicken Burger', 'Buttermilk chicken, slaw, pickles', 80, 'Burgers'], ['Halloumi Wrap', 'Grilled halloumi, peppers, hummus', 65, 'Wraps'], ['Loaded Fries', 'Cheese sauce, jalapeños, crispy onions', 45, 'Sides'], ['Lemon Mint Juice', 'Freshly blended', 30, 'Drinks']] },
    { name: 'Bean There Café', cat: 'Café', loc: 'Library Building, Level 1', desc: 'Specialty coffee and fresh pastries for long study sessions.', open: '00:00', close: '00:00', days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
      menu: [['Flat White', 'Double shot, silky milk', 40, 'Coffee'], ['Iced Caramel Latte', 'Espresso, milk, caramel, ice', 50, 'Coffee'], ['Butter Croissant', 'Baked every morning', 30, 'Bakery'], ['Chocolate Muffin', 'Rich double chocolate', 32, 'Bakery'], ['Matcha Latte', 'Ceremonial grade matcha', 55, 'Tea']] },
    { name: 'Taco Wheels', cat: 'Food Truck', loc: 'Engineering Plaza', desc: 'Mexican-inspired street tacos and burritos from our bright orange truck.', open: '11:00', close: '20:00', days: 'Mon,Tue,Wed,Thu,Fri',
      menu: [['Chicken Tacos (3)', 'Chipotle chicken, pico de gallo, lime crema', 70, 'Tacos'], ['Beef Burrito', 'Rice, beans, cheese, salsa roja', 90, 'Burritos'], ['Nachos', 'Tortilla chips, cheese, guacamole', 55, 'Sides']] },
    { name: 'Green Bowl', cat: 'Healthy', loc: 'Sports Complex Entrance', desc: 'Build-your-own salads, grain bowls and cold-pressed smoothies.', open: '08:00', close: '19:00', days: 'Mon,Tue,Wed,Thu,Fri,Sat',
      menu: [['Chicken Caesar Bowl', 'Romaine, grilled chicken, parmesan, croutons', 75, 'Bowls'], ['Falafel Quinoa Bowl', 'Quinoa, falafel, tahini, pickled onion', 70, 'Bowls'], ['Berry Blast Smoothie', 'Mixed berries, banana, yogurt', 45, 'Smoothies']] },
    { name: 'Crumbs Bakery', cat: 'Bakery', loc: 'Arts Faculty Courtyard', desc: 'Freshly baked bread, cinnamon rolls and celebration cakes.', open: '07:00', close: '18:00', days: 'Mon,Tue,Wed,Thu,Fri',
      menu: [['Cinnamon Roll', 'Cream cheese frosting', 35, 'Pastries'], ['Cheese Pie', 'Feta and herbs', 28, 'Savory'], ['Red Velvet Slice', 'Classic cream cheese icing', 45, 'Cakes']] },
    { name: 'Midnight Noodles', cat: 'Restaurant', loc: 'Residence Halls, Block C', desc: 'Late-night ramen and stir-fried noodles for exam season.', open: '00:00', close: '00:00', days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
      menu: [['Chicken Ramen', 'Rich broth, soft egg, spring onion', 85, 'Ramen'], ['Veggie Pad Thai', 'Rice noodles, tofu, peanuts', 75, 'Noodles'], ['Gyoza (6)', 'Pan-fried chicken dumplings', 50, 'Sides']] },
  ];

  const ids = [];
  for (const r of restaurants) {
    const when = `-${30 - ids.length * 4} days`;
    const rid = run(
      `INSERT INTO restaurants (name, description, category_id, campus_location, contact_phone, email, opening_time, closing_time,
                                operating_days, availability_status, created_by, created_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, datetime('now', ?), datetime('now', ?))`,
      r.name, r.desc, cats[r.cat], r.loc, '+20 100 555 0' + (100 + ids.length),
      r.name.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '') + '@unibite.edu', r.open, r.close, r.days, admin, when, when
    ).lastInsertRowid;
    ids.push(rid);
    for (const [n, d, p, s] of r.menu) {
      run('INSERT INTO products (restaurant_id, name, description, price, menu_section) VALUES (?, ?, ?, ?, ?)', rid, n, d, p, s);
    }
  }

  // Restaurant owner accounts (one primary owner per restaurant)
  const owner1 = user('Omar Farouk', 'owner@unibite.edu', 'Owner12345', 'restaurant');
  run(`INSERT INTO restaurant_users (user_id, restaurant_id, assigned_role) VALUES (?, ?, 'owner')`, owner1, ids[1]);
  const owner2 = user('Karim Nabil', 'grill@unibite.edu', 'Owner12345', 'restaurant');
  run(`INSERT INTO restaurant_users (user_id, restaurant_id, assigned_role) VALUES (?, ?, 'owner')`, owner2, ids[0]);

  // Students (verified emails, IDs from the roster)
  const s1 = user('Sara Mahmoud', 'student@unibite.edu', 'Student12345', 'student');
  const s2 = user('Youssef Ali', 'youssef@unibite.edu', 'Student12345', 'student');
  run(`INSERT INTO student_profiles (user_id, university_id, verification_status, verified_at) VALUES (?, '20230001', 'verified', datetime('now'))`, s1);
  run(`INSERT INTO student_profiles (user_id, university_id, verification_status, verified_at) VALUES (?, '20230002', 'verified', datetime('now'))`, s2);

  // Historical orders + ratings
  const comments = ['Quick and tasty!', 'Ready right on time.', 'Great value for students.', 'Will order again.', null];
  let n = 0;
  for (let day = 6; day >= 0; day--) {
    for (let k = 0; k < 3 + (day % 3); k++) {
      const rid = ids[(day + k) % ids.length];
      const student = k % 2 ? s2 : s1;
      const prods = all('SELECT * FROM products WHERE restaurant_id = ? LIMIT 2', rid);
      const total = prods.reduce((s, p) => s + p.price, 0);
      const when = `-${day} days`;
      const oid = run(
        `INSERT INTO orders (student_id, restaurant_id, status, total, pickup_code, created_at, updated_at)
         VALUES (?, ?, 'completed', ?, ?, datetime('now', ?, '-2 hours'), datetime('now', ?, '-1 hours'))`,
        student, rid, total, String(1000 + n), when, when
      ).lastInsertRowid;
      for (const p of prods) run('INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, 1)', oid, p.id, p.name, p.price);
      for (const st of ['pending', 'accepted', 'preparing', 'ready', 'completed']) {
        run(`INSERT INTO order_status_history (order_id, status, created_at) VALUES (?, ?, datetime('now', ?, '-2 hours'))`, oid, st, when);
      }
      if (n % 2 === 0) run('INSERT INTO ratings (order_id, student_id, restaurant_id, score, comment) VALUES (?, ?, ?, ?, ?)', oid, student, rid, 3 + (n % 3), comments[n % 5]);
      n++;
    }
  }

  run(
    `INSERT INTO restaurant_requests (restaurant_name, contact_name, email, phone, category_id, campus_location, description, additional_info)
     VALUES ('Shawarma Spot', 'Hany Salem', 'hany@shawarmaspot.com', '+20 111 222 3333', ?, 'Business School Lawn',
             'Fresh chicken and beef shawarma wraps with homemade garlic sauce.', 'We have operated food trucks at three universities.')`,
    cats['Food Truck']
  );
  run(`INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, 'restaurant_request', 'New restaurant application', 'Shawarma Spot (Hany Salem) applied to join UniBite.', '#requests?status=pending')`, admin);
  run(`INSERT INTO audit_logs (admin_id, action, entity_type, details) VALUES (?, 'system.seed', 'system', '{"note":"Demo data loaded"}')`, admin);
});

console.log(`Seeded DEMO data (development only).

  Super Admin       admin@unibite.edu    / SuperAdmin2026   -> sign in at /admin/login
  Restaurant owner  owner@unibite.edu    / Owner12345       (Bean There Café)
  Restaurant owner  grill@unibite.edu    / Owner12345       (The Grill House)
  Student           student@unibite.edu  / Student12345

  Student registration: email must end in @unibite.edu; University IDs 20230003–20230050 are free in the demo roster.
  Emails (verification, invitations) appear at /dev/mailbox.html while SMTP is not configured.
`);
