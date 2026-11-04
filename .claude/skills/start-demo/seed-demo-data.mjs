// Demo data seeder for the new TOCS app (NestJS backend on :3000, Postgres in WSL docker container tocs-dev-postgres-1).
// Run: node .claude/skills/start-demo/seed-demo-data.mjs     (backend must be running; demo-admin must exist)
// Grades and extra login users go in via SQL; everything else goes through the real API so validation applies.
// Refuses to run if school years already exist (use `docker compose -p tocs-dev down -v` to reset the DB).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const BACKEND_DIR = process.env.BACKEND_DIR ?? 'C:/Users/leyu0002/Documents/GitHub/TO-Chinese-School-sp1/backend';
const API = process.env.API ?? 'http://localhost:3000/api/v1';
const PASSWORD = 'Demo-Passw0rd-2026';
const argon2 = createRequire(`${BACKEND_DIR}/package.json`)('argon2');

function sql(text) {
  const r = spawnSync(
    'wsl',
    ['-d', 'Ubuntu-22.04', '--', 'docker', 'exec', '-i', 'tocs-dev-postgres-1', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'tocs_dev', '-At'],
    { input: text, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

// ---- tiny API client with a manual cookie jar (cookies are Secure, so we cannot rely on fetch defaults) ----
const jar = new Map();
const keep = (res) => {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
};
async function call(method, path, body) {
  const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (jar.has('tocs_csrf')) headers['x-csrf-token'] = jar.get('tocs_csrf');
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  keep(res);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json;
}
await call('GET', '/auth/csrf');
await call('POST', '/auth/login', { username: 'demo-admin', password: PASSWORD });

if ((await call('GET', '/school-years')).length > 0) throw new Error('school years already exist; refusing to seed twice');

// ---- grades (SQL; the API only reads them). Pre-K -> K -> Grade 1..6, chained by next_grade ----
const grades = [
  ['學前班', 'Pre-K', 'PK', 'P'], ['幼稚園', 'Kindergarten', 'K', 'K'],
  ['一年級', 'Grade 1', 'G1', 'A'], ['二年級', 'Grade 2', 'G2', 'B'], ['三年級', 'Grade 3', 'G3', 'C'],
  ['四年級', 'Grade 4', 'G4', 'D'], ['五年級', 'Grade 5', 'G5', 'E'], ['六年級', 'Grade 6', 'G6', 'F'],
];
if (sql('select count(*) from grades') === '0') {
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  sql(
    grades.map(([c, e, s, j]) => `insert into grades (chinese_name, english_name, short_name, jersey_number_prefix, created_at, updated_at) values (${q(c)},${q(e)},${q(s)},${q(j)},now(),now());`).join('\n') +
      `\nupdate grades g set next_grade = n.id from grades n where n.id = g.id + 1;`,
  );
}
const gradeId = Object.fromEntries((await call('GET', '/grades')).map((g) => [g.shortName, g.id]));

// ---- school years: current 2026-2027 and the upcoming 2027-2028 ----
const fees = { registrationFee: 2500, earlyRegistrationTuition: 48000, tuition: 52000, electiveClassFee: 8000, tuitionDiscountForThreeOrMoreChild: 5000, tuitionDiscountForPreK: 3000, tuitionDiscountForInstructor: 10000, pvaMembershipDue: 2000, cccaMembershipDue: 2000, parentAndStudentClassFee: 12000, earlyRegistrationParentAndStudentClassFee: 11000 };
const yearInput = (y) => ({
  name: `${y}-${y + 1}`, description: `${y}-${y + 1} school year (demo)`, ageCutoffMonth: 9,
  startDate: `${y}-09-12`, endDate: `${y + 1}-06-05`,
  earlyRegistrationStartDate: `${y}-05-01`, earlyRegistrationEndDate: `${y}-06-15`,
  registrationStartDate: `${y}-06-16`, registration75PercentDate: `${y}-08-01`, registrationEndDate: `${y}-09-20`,
  refund90PercentDate: `${y}-09-26`, refund50PercentDate: `${y}-11-14`, refundEndDate: `${y + 1}-01-16`,
  ...fees,
});
const y1 = await call('POST', '/school-years', yearInput(2026));
const y2 = await call('POST', '/school-years', { ...yearInput(2027), tuition: 54000, earlyRegistrationTuition: 50000 });
const year1 = y1.id ?? y1.schoolYear?.id;
const year2 = y2.id ?? y2.schoolYear?.id;
// book charges per grade (rows are created with the year)
for (const yid of [year1, year2]) {
  const rows = await call('GET', `/school-years/${yid}/book-charges`);
  await call('PUT', `/school-years/${yid}/book-charges`, rows.map((r, i) => ({ id: r.id, bookChargeInCents: 1500 + (i % 4) * 500 })));
}

// ---- school classes ----
const classes = [
  ['Pre-K A', '學前班甲', 'T', 'PK', 15, 'Room 101'], ['Kindergarten A', '幼稚園甲', 'S', 'K', 18, 'Room 102'],
  ['Grade 1 A', '一年級甲', 'S', 'G1', 22, 'Room 103'], ['Grade 1 B', '一年級乙', 'T', 'G1', 22, 'Room 104'],
  ['Grade 2 A', '二年級甲', 'S', 'G2', 22, 'Room 105'], ['Grade 3 A', '三年級甲', 'S', 'G3', 22, 'Room 106'],
  ['Grade 4 A', '四年級甲', 'T', 'G4', 22, 'Room 107'], ['Grade 5 A', '五年級甲', 'M', 'G5', 24, 'Room 108'],
  ['Grade 6 A', '六年級甲', 'S', 'G6', 24, 'Room 109'],
  ['English Instruction Chinese', '英語教學中文班', 'SE', null, 20, 'Room 110'],
  ['Everyday Chinese (Adult)', '成人生活華語', 'EC', null, 20, 'Room 111'],
  ['Chinese Painting', '國畫', 'ELECTIVE', null, 16, 'Art Room'], ['Calligraphy', '書法', 'ELECTIVE', null, 16, 'Art Room'],
  ['Chinese Dance', '民族舞', 'ELECTIVE', null, 20, 'Gym'], ['Abacus', '珠算', 'ELECTIVE', null, 12, 'Room 112'],
];
for (const [en, zh, type, g, maxSize, location] of classes) {
  const c = await call('POST', '/school-classes', { englishName: en, chineseName: zh, schoolClassType: type, gradeId: g ? gradeId[g] : null, maxSize, location });
  const id = c.id ?? c.schoolClass?.id;
  // every class active this year; Abacus stays inactive so the toggle can be demonstrated
  await call('PUT', `/school-classes/${id}/active`, { schoolYearId: year1, active: en !== 'Abacus' });
}

// ---- families (staff creates the family + parent one, then parent two and children) ----
const families = [
  { last: 'Chen', addr: ['1021 Maple Ave', 'Cupertino', '95014', '408-555-0101'], p1: ['Wei', '陳偉', 'M'], p2: ['Mei', '林美', 'F'], kids: [['Emily', '陳怡', 'F', 2017, 3], ['Kevin', '陳凱', 'M', 2020, 11]] },
  { last: 'Lin', addr: ['88 Oak Street', 'Sunnyvale', '94086', '408-555-0102'], p1: ['Jun', '林軍', 'M'], p2: ['Hui', '黃慧', 'F'], kids: [['Grace', '林恩', 'F', 2015, 7]] },
  { last: 'Wang', addr: ['402 Willow Ln', 'San Jose', '95129', '408-555-0103'], p1: ['Tao', '王濤', 'M'], p2: ['Li', '李麗', 'F'], kids: [['Ethan', '王宇', 'M', 2013, 1], ['Olivia', '王欣', 'F', 2016, 9], ['Lucas', '王浩', 'M', 2019, 5]] },
  { last: 'Zhang', addr: ['17 Cedar Ct', 'Mountain View', '94040', '650-555-0104'], p1: ['Ming', '張明', 'M'], p2: null, kids: [['Sophia', '張琳', 'F', 2018, 12]] },
  { last: 'Liu', addr: ['950 Pine Rd', 'Santa Clara', '95050', '408-555-0105'], p1: ['Yan', '劉艷', 'F'], p2: ['Hao', '劉皓', 'M'], kids: [['Daniel', '劉丹', 'M', 2014, 4], ['Chloe', '劉晴', 'F', 2021, 2]] },
  { last: 'Huang', addr: ['233 Birch Blvd', 'Milpitas', '95035', '408-555-0106'], p1: ['Qiang', '黃強', 'M'], p2: ['Xia', '夏霞', 'F'], kids: [['Ryan', '黃睿', 'M', 2012, 8], ['Anna', '黃安', 'F', 2017, 10]] },
];
const person = ([first, zh, gender], last, lang = 'Mandarin') => ({ englishFirstName: first, englishLastName: last, chineseName: zh, gender, nativeLanguage: lang });
for (const f of families) {
  const [street, city, zipcode, phone] = f.addr;
  const created = await call('POST', '/families', {
    address: { street, city, state: 'CA', zipcode, homePhone: phone, cellPhone: phone.replace(/\d{4}$/, '9' + phone.slice(-3)), email: `${f.last.toLowerCase()}.family@example.com` },
    parentOne: person(f.p1, f.last),
  });
  if (f.p2) await call('POST', `/families/${created.id}/parents`, person(f.p2, f.last));
  for (const [first, zh, gender, birthYear, birthMonth] of f.kids) {
    await call('POST', `/families/${created.id}/children`, { ...person([first, zh, gender], f.last, 'English'), birthYear, birthMonth });
  }
}

// ---- extra login users (SQL, same argon2id format as the app) ----
const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const addUser = (username, role, personId) =>
  `with u as (insert into users (username, password_hash_v2, person_id, created_at, updated_at) values ('${username}', '${hash}', ${personId}, now(), now()) returning id)
   insert into roles_users (role_id, user_id, created_at, updated_at) select r.id, u.id, now(), now() from u, roles r where r.name = '${role}';`;
const pid = (first, last) => sql(`select id from people where english_first_name='${first}' and english_last_name='${last}' limit 1`);
sql(
  [
    // staff accounts need a person row; reuse parent persons would be confusing, so create dedicated ones
    `insert into people (english_first_name, english_last_name, chinese_name, gender, created_at, updated_at) values ('Rita','Registrar','註冊組長','F',now(),now()), ('Paul','Principal','校長','M',now(),now());`,
    addUser('registrar', 'Registration Officer', `(select id from people where english_last_name='Registrar')`),
    addUser('principal', 'Principal', `(select id from people where english_last_name='Principal')`),
    addUser('parent-chen', 'Student Parent', pid('Wei', 'Chen')),
  ].join('\n'),
);

console.log('seeded: 8 grades, 2 school years, %d classes, %d families, users: registrar / principal / parent-chen (password %s)', classes.length, families.length, PASSWORD);
