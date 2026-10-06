const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const TEACHER_CODE = process.env.TEACHER_CODE || '';
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('! JWT_SECRET не задан в .env: после перезапуска сервера все выйдут из аккаунта.');
}

const db = new Database(path.join(__dirname, 'ent.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
create table if not exists users(
  id integer primary key autoincrement,
  login text not null unique,
  name text not null,
  cls text not null default '',
  role text not null default 'student',
  p1 text not null default '',
  p2 text not null default '',
  target integer not null default 100,
  pass_hash text not null,
  created_at text not null default (datetime('now'))
);
create table if not exists sessions(
  id integer primary key autoincrement,
  d text not null unique
);
create table if not exists results(
  session_id integer not null references sessions(id) on delete cascade,
  user_id integer not null references users(id) on delete cascade,
  h integer not null, m integer not null, r integer not null, a integer not null, b integer not null,
  primary key(session_id, user_id)
);
create table if not exists settings(key text primary key, value text not null);
`);

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
// Сайт отдаётся безопасно: наружу уходят только файлы самого сайта,
// но НЕ server.js, ent.db и .env.
const PUB = path.join(__dirname, 'public');
if (fs.existsSync(path.join(PUB, 'index.html'))) {
  app.use(express.static(PUB)); // структура с папкой public
} else {
  // плоская структура (все файлы лежат в корне, как в GitHub-репозитории): отдаём только файлы сайта
  ['index.html', 'app.js', 'style.css', 'theme.js'].forEach(f =>
    app.get('/' + f, (req, res) => res.sendFile(path.join(__dirname, f))));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
}

// ---------- helpers ----------
const fails = new Map(); // ip -> {n, t}
function limited(req, res, next) {
  const now = Date.now(), k = req.ip;
  let f = fails.get(k);
  if (!f || now - f.t > 15 * 60 * 1000) f = { n: 0, t: now };
  if (f.n >= 15) return res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут.' });
  f.n++; fails.set(k, f);
  next();
}
function setCookie(res, id) {
  const token = jwt.sign({ id }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true, sameSite: 'lax', maxAge: 7 * 864e5,
    secure: process.env.NODE_ENV === 'production'
  });
}
function needAuth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies.token || '', SECRET);
    const u = db.prepare('select * from users where id=?').get(id);
    if (!u) throw 0;
    req.user = u; next();
  } catch (e) { res.status(401).json({ error: 'Нужно войти' }); }
}
function needTeacher(req, res, next) {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Только для учителей' });
  next();
}
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
const threshold = () => { const r = db.prepare("select value from settings where key='threshold'").get(); return r ? +r.value : 50; };
const TR = { а:'a',ә:'a',б:'b',в:'v',г:'g',ғ:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',і:'i',к:'k',қ:'k',л:'l',м:'m',н:'n',ң:'n',о:'o',ө:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ұ:'u',ү:'u',ф:'f',х:'h',һ:'h',ц:'c',ч:'ch',ш:'sh',щ:'sh',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
const translit = t => String(t).toLowerCase().split('').map(c => TR[c] !== undefined ? TR[c] : c).join('').replace(/[^a-z0-9]/g, '');
function makeLogin(name) {
  const w = String(name).trim().split(/\s+/);
  const base = (translit(w[0]) || 'user') + (w[1] ? '.' + translit(w[1]).slice(0, 1) : '');
  let login = base, n = 1;
  while (db.prepare('select 1 from users where login=?').get(login)) login = base + (++n);
  return login;
}
const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
const makePass = () => Array.from({ length: 8 }, () => ABC[crypto.randomInt(ABC.length)]).join('');

// ---------- auth ----------
// Регистрация открыта только для учителей (нужен код из .env). Учеников создаёт учитель.
app.post('/api/register', limited, (req, res) => {
  const b = req.body || {};
  const login = str(b.login, 30).toLowerCase();
  const name = str(b.name, 80), pass = String(b.password || '');
  if (!TEACHER_CODE || b.teacherCode !== TEACHER_CODE) return res.status(403).json({ error: 'Неверный код учителя' });
  if (!/^[a-z0-9._-]{3,30}$/.test(login)) return res.status(400).json({ error: 'Логин: 3–30 символов, латиница, цифры, точка, дефис' });
  if (!name) return res.status(400).json({ error: 'Укажите фамилию и имя' });
  if (pass.length < 6 || pass.length > 100) return res.status(400).json({ error: 'Пароль: минимум 6 символов' });
  if (db.prepare('select 1 from users where login=?').get(login)) return res.status(409).json({ error: 'Такой логин уже занят' });
  const info = db.prepare("insert into users(login,name,cls,role,pass_hash) values(?,?,'','teacher',?)")
    .run(login, name, bcrypt.hashSync(pass, 10));
  setCookie(res, info.lastInsertRowid);
  res.json({ ok: true });
});

app.post('/api/login', limited, (req, res) => {
  const login = str(req.body && req.body.login, 30).toLowerCase();
  const u = db.prepare('select * from users where login=?').get(login);
  if (!u || !bcrypt.compareSync(String((req.body && req.body.password) || ''), u.pass_hash))
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  fails.delete(req.ip);
  setCookie(res, u.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

// ---------- data ----------
app.get('/api/data', needAuth, (req, res) => {
  const me = req.user, teacher = me.role === 'teacher';
  const cols = 'id,login,name,cls,p1,p2,target';
  const students = teacher
    ? db.prepare(`select ${cols} from users where role='student' order by name`).all()
    : db.prepare(`select ${cols} from users where id=?`).all(me.id);
  const rs = teacher
    ? db.prepare('select session_id,user_id,h,m,r,a,b from results').all()
    : db.prepare('select session_id,user_id,h,m,r,a,b from results where user_id=?').all(me.id);
  const by = {};
  rs.forEach(x => (by[x.user_id] = by[x.user_id] || []).push(x));
  students.forEach(s => (s.results = by[s.id] || []));
  const sessions = db.prepare('select id,d from sessions order by d').all();
  res.json({ me: { id: me.id, name: me.name, role: me.role }, threshold: threshold(), sessions, students });
});

// --- дни тестов (вторник и пятница) ---
app.post('/api/sessions', needAuth, needTeacher, (req, res) => {
  const b = req.body || {}, ins = db.prepare('insert or ignore into sessions(d) values(?)');
  const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
  if (b.d) {
    if (!ok(b.d)) return res.status(400).json({ error: 'Неверная дата' });
    ins.run(b.d); return res.json({ ok: true, added: 1 });
  }
  if (!ok(b.from) || !ok(b.to)) return res.status(400).json({ error: 'Укажите даты «с» и «по»' });
  const a = Date.parse(b.from), z = Date.parse(b.to);
  if (z < a || (z - a) / 864e5 > 400) return res.status(400).json({ error: 'Период: не больше 400 дней' });
  let n = 0;
  db.transaction(() => {
    for (let t = a; t <= z; t += 864e5) {
      const day = new Date(t).getUTCDay();
      if (day === 2 || day === 5) n += ins.run(new Date(t).toISOString().slice(0, 10)).changes;
    }
  })();
  res.json({ ok: true, added: n });
});

app.delete('/api/sessions/:id', needAuth, needTeacher, (req, res) => {
  db.prepare('delete from sessions where id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- баллы вносит только учитель ---
app.put('/api/sessions/:id/results', needAuth, needTeacher, (req, res) => {
  const sid = Number(req.params.id);
  if (!db.prepare('select 1 from sessions where id=?').get(sid)) return res.status(404).json({ error: 'День теста не найден' });
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  const clean = [];
  for (const r of rows) {
    const uid = Number(r.studentId);
    if (!db.prepare("select 1 from users where id=? and role='student'").get(uid)) continue;
    if (r.blank) { clean.push({ uid, blank: true }); continue; }
    const h = int(r.h, 0, 20), m = int(r.m, 0, 10), rr = int(r.r, 0, 10), a = int(r.a, 0, 50), b = int(r.b, 0, 50);
    if ([h, m, rr, a, b].includes(null)) {
      const n = db.prepare('select name from users where id=?').get(uid).name;
      return res.status(400).json({ error: `${n}: проверьте баллы (история 0–20, грамотности 0–10, профильные 0–50)` });
    }
    clean.push({ uid, h, m, r: rr, a, b });
  }
  const up = db.prepare(`insert into results(session_id,user_id,h,m,r,a,b) values(?,?,?,?,?,?,?)
    on conflict(session_id,user_id) do update set h=excluded.h,m=excluded.m,r=excluded.r,a=excluded.a,b=excluded.b`);
  const del = db.prepare('delete from results where session_id=? and user_id=?');
  db.transaction(() => clean.forEach(c => c.blank ? del.run(sid, c.uid) : up.run(sid, c.uid, c.h, c.m, c.r, c.a, c.b)))();
  res.json({ ok: true, saved: clean.length });
});

// --- ученики: создаёт и настраивает только учитель ---
function createStudent(row, rounds) {
  const name = str(row.name, 80), cls = str(row.cls, 10);
  const target = int(row.target, 0, 140) ?? 100;
  const login = makeLogin(name), password = makePass();
  db.prepare("insert into users(login,name,cls,role,p1,p2,target,pass_hash) values(?,?,?,'student',?,?,?,?)")
    .run(login, name, cls, str(row.p1, 40), str(row.p2, 40), target, bcrypt.hashSync(password, rounds));
  return { name, cls, p1: str(row.p1, 40), p2: str(row.p2, 40), login, password };
}
app.post('/api/students/bulk', needAuth, needTeacher, (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Список пуст' });
  if (rows.length > 150) return res.status(400).json({ error: 'За один раз можно добавить до 150 учеников' });
  for (let i = 0; i < rows.length; i++)
    if (!str(rows[i].name, 80) || !str(rows[i].cls, 10)) return res.status(400).json({ error: `Строка ${i + 1}: нужны фамилия, имя и класс` });
  const out = [];
  db.transaction(() => rows.forEach(r => out.push(createStudent(r, 8))))();
  res.json({ ok: true, created: out });
});

app.patch('/api/students/:id', needAuth, needTeacher, (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  if (b.target !== undefined) {
    const target = int(b.target, 0, 140);
    if (target === null) return res.status(400).json({ error: 'Цель: число от 0 до 140' });
    db.prepare("update users set target=? where id=? and role='student'").run(target, id);
  }
  if (b.name !== undefined || b.cls !== undefined) {
    const name = str(b.name, 80), cls = str(b.cls, 10);
    if (!name || !cls) return res.status(400).json({ error: 'Фамилия и класс не могут быть пустыми' });
    db.prepare("update users set name=?, cls=?, p1=?, p2=? where id=? and role='student'").run(name, cls, str(b.p1, 40), str(b.p2, 40), id);
  }
  res.json({ ok: true });
});

// --- новые пароли (старые хранятся только в зашифрованном виде, посмотреть их нельзя) ---
function newPassword(id, rounds) {
  const u = db.prepare("select id,login,name,cls from users where id=? and role='student'").get(id);
  if (!u) return null;
  const password = makePass();
  db.prepare('update users set pass_hash=? where id=?').run(bcrypt.hashSync(password, rounds), id);
  return { name: u.name, cls: u.cls, login: u.login, password };
}
app.post('/api/students/newpass-bulk', needAuth, needTeacher, (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length) return res.status(400).json({ error: 'Список пуст' });
  if (ids.length > 150) return res.status(400).json({ error: 'За один раз можно до 150 учеников' });
  const out = [];
  db.transaction(() => ids.forEach(id => { const r = newPassword(id, 8); if (r) out.push(r); }))();
  res.json({ ok: true, created: out });
});
app.post('/api/students/:id/newpass', needAuth, needTeacher, (req, res) => {
  const r = newPassword(Number(req.params.id), 10);
  if (!r) return res.status(404).json({ error: 'Ученик не найден' });
  res.json({ ok: true, ...r });
});

app.delete('/api/students/:id', needAuth, needTeacher, (req, res) => {
  db.prepare("delete from users where id=? and role='student'").run(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/students/:id/password', needAuth, needTeacher, (req, res) => {
  const pass = String((req.body && req.body.password) || '');
  if (pass.length < 6) return res.status(400).json({ error: 'Пароль: минимум 6 символов' });
  db.prepare("update users set pass_hash=? where id=? and role='student'").run(bcrypt.hashSync(pass, 10), Number(req.params.id));
  res.json({ ok: true });
});

app.put('/api/settings', needAuth, needTeacher, (req, res) => {
  const t = int(req.body && req.body.threshold, 0, 140);
  if (t === null) return res.status(400).json({ error: 'Порог: число от 0 до 140' });
  db.prepare("insert into settings(key,value) values('threshold',?) on conflict(key) do update set value=excluded.value").run(String(t));
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`ЕНТ-трекер запущен на порту ${PORT}`));
