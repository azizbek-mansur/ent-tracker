(function () {
  var $ = function (id) { return document.getElementById(id); };
  var D = null, openId = null, selSess = null, shown = [];
  var WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); }
  function short(d) { return d.slice(8, 10) + '.' + d.slice(5, 7); }
  function fmt(d) { return WD[new Date(d + 'T00:00:00').getDay()] + ' ' + short(d); }
  function tot(r) { return (r.h || 0) + (r.m || 0) + (r.r || 0) + (r.a || 0) + (r.b || 0); }
  
  function isCreative(s) {
    var p1 = String(s.p1 || '').toLowerCase();
    var p2 = String(s.p2 || '').toLowerCase();
    return p1.indexOf('творч') > -1 || p2.indexOf('творч') > -1;
  }

  // ---------- подсчёт по ученику ----------
  function calc(s) {
    var td = today(), map = {};
    s.results.forEach(function (r) { map[r.session_id] = r; });
    var rows = D.sessions.map(function (x) {
      var r = map[x.id] || null;
      return { id: x.id, d: x.d, r: r, st: r ? 'done' : (x.d <= td ? 'miss' : 'soon') };
    });
    var done = rows.filter(function (x) { return x.st === 'done'; });
    var missed = rows.filter(function (x) { return x.st === 'miss'; }).length;
    var tots = done.map(function (x) { return tot(x.r); });
    var n = tots.length;
    return {
      rows: rows, done: n, missed: missed, held: n + missed,
      last: n ? tots[n - 1] : null,
      prev: n > 1 ? tots[n - 2] : null,
      best: n ? Math.max.apply(null, tots) : null,
      avg: n ? Math.round(tots.reduce(function (a, b) { return a + b; }, 0) / n) : null
    };
  }
  function status(s) {
    var c = calc(s);
    var creative = isCreative(s);
    var thr = creative ? Math.min(D.threshold, 25) : D.threshold;
    if (c.last === null) return { t: 'Нет результатов', c: 'mute', k: 1 };
    if (c.last >= s.target) return { t: 'Цель достигнута', c: 'ok', k: 3 };
    if (c.last >= thr) return { t: 'Выше порога', c: 'warn', k: 2 };
    return { t: 'Зона риска', c: 'bad', k: 0 };
  }

  async function api(method, url, body) {
    var r = await fetch(url, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || 'Ошибка сервера');
    return j;
  }
  async function reload() {
    try { D = await api('GET', '/api/data'); } catch (e) { D = null; }
    render();
    if (openId && D) {
      var s = D.students.filter(function (x) { return x.id === openId; })[0];
      if (s) mount($('dBody'), s, true); else if ($('dSt')) $('dSt').close();
    }
  }

  // ---------- свои окна вместо alert / confirm / prompt ----------
  function ask(o) {
    return new Promise(function (res) {
      var d = $('dMsg'), inp = $('mInput'), yes = $('mYes'), no = $('mNo'), er = $('mErr'), done = false;
      $('mTitle').textContent = o.title || '';
      $('mText').textContent = o.text || '';
      yes.textContent = o.ok || 'OK'; yes.className = o.danger ? 'danger' : 'pri';
      no.hidden = !!o.info; er.textContent = '';
      inp.hidden = !o.input;
      if (o.input) { inp.min = o.input.min; inp.max = o.input.max; inp.value = o.input.value; }
      var cancelVal = o.info ? true : (o.input ? null : false);
      function fin(v) {
        if (done) return; done = true;
        yes.onclick = null; no.onclick = null; inp.oninput = null;
        d.removeEventListener('cancel', onCancel);
        if (d.open) d.close();
        res(v);
      }
      function onCancel(e) { e.preventDefault(); fin(cancelVal); }
      yes.onclick = function () {
        if (!o.input) { fin(true); return; }
        var raw = inp.value.trim(), n = Number(raw);
        if (raw === '' || isNaN(n) || n < o.input.min || n > o.input.max) { er.textContent = 'Введите число от ' + o.input.min + ' до ' + o.input.max + '.'; inp.focus(); return; }
        fin(n);
      };
      no.onclick = function () { fin(cancelVal); };
      inp.oninput = function () { er.textContent = ''; };
      d.addEventListener('cancel', onCancel);
      d.showModal();
      if (o.input) { inp.focus(); inp.select(); } else yes.focus();
    });
  }
  function notice(text, title) { return ask({ title: title || 'Информация', text: text, info: true, ok: 'Понятно' }); }
  if ($('mInput')) $('mInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('mYes').click(); } });

  // ---------- график ----------
  function chart(c, target, maxVal) {
    maxVal = maxVal || 140;
    var list = c.rows.filter(function (x) { return x.st !== 'soon'; }).slice(-20);
    var W = 400, H = 180, L = 30, B = 30, T = 10, R = 10, g = '';
    function Y(v) { return H - B - v / maxVal * (H - B - T); }
    var gridVals = maxVal === 40 ? [0, 15, 30, 40] : [0, 50, 100, 140];
    gridVals.forEach(function (v) {
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--line)"/><text x="' + (L - 4) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="10" fill="var(--mute)">' + v + '</text>';
    });
    g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(target) + '" y2="' + Y(target) + '" stroke="var(--pri)" stroke-dasharray="4 3"/>';
    function tag(v, t, col, up) { return '<text x="' + (W - R - 2) + '" y="' + (Y(v) + (up ? -4 : 12)) + '" text-anchor="end" font-size="10" font-weight="700" fill="' + col + '" stroke="var(--gs)" stroke-width="3" paint-order="stroke">' + t + ' ' + v + '</text>'; }
    g += tag(target, 'цель', 'var(--pri)', true);
    if (!list.length) return '<svg class="ch" viewBox="0 0 400 180" role="img" aria-label="График баллов">' + g + '<text x="200" y="90" text-anchor="middle" fill="var(--mute)" font-size="13">Тестов пока не было</text></svg>';
    var step = list.length < 2 ? 0 : (W - L - R) / (list.length - 1), pts = [], marks = '';
    list.forEach(function (x, i) {
      var px = list.length < 2 ? (L + W - R) / 2 : L + i * step;
      if (i % (list.length > 10 ? 2 : 1) === 0) marks += '<text x="' + px + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" fill="var(--mute)">' + short(x.d) + '</text>';
      if (x.st === 'done') { var v = tot(x.r); pts.push({ x: px, y: Y(v), v: v }); }
      else marks += '<text x="' + px + '" y="' + (H - B - 4) + '" text-anchor="middle" font-size="14" fill="var(--bad)">×</text>';
    });
    g += marks;
    if (pts.length) {
      if (pts.length > 1) g += '<path d="M' + pts[0].x + ',' + (H - B) + ' L' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' L') + ' L' + pts[pts.length - 1].x + ',' + (H - B) + ' Z" fill="var(--hl)" fill-opacity=".2"/>';
      g += '<polyline fill="none" stroke="var(--pri)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' ') + '"/>';
      pts.forEach(function (p) { g += '<circle cx="' + p.x + '" cy="' + p.y + '" r="4.5" fill="var(--pri)" stroke="var(--gs)" stroke-width="2"/><text x="' + p.x + '" y="' + (p.y - 8) + '" text-anchor="middle" font-size="11" fill="var(--ink)">' + p.v + '</text>'; });
    }
    return '<svg class="ch" viewBox="0 0 400 180" role="img" aria-label="График баллов">' + g + '</svg>';
  }

  // ---------- карточка прогресса (ученик и учитель) ----------
  function mount(el, s, teacher) {
    var c = calc(s), st = status(s);
    var creative = isCreative(s);
    var maxVal = creative ? 40 : 140;
    var nameP1 = esc(s.p1 || 'Профиль 1');
    var nameP2 = esc(s.p2 || 'Профиль 2');
    
    $('dName').textContent = s.name;
    var d = c.prev === null ? '' : c.last - c.prev;
    var dTxt = d === '' ? '' : ' <span class="' + (d > 0 ? 'ok' : d < 0 ? 'bad' : 'mute') + '" style="font-size:14px">' + (d > 0 ? '+' : '') + d + '</span>';
    var pct = c.last === null ? 0 : Math.min(100, Math.round(c.last / Math.max(1, s.target) * 100));
    var left = c.last === null ? null : s.target - c.last;
    var att = c.held ? Math.round(c.done / c.held * 100) : null;
    var html =
      '<div class="legend">' + esc(s.cls) + ' класс · Логин: <b>' + esc(s.login) + '</b> · ' + esc([s.p1, s.p2].filter(Boolean).join(', ') || 'профильные предметы не указаны') + (creative ? ' 🎨 <b>(Творческое направление)</b>' : '') + ' · <b class="' + st.c + '">' + st.t + '</b></div>' +
      '<div class="big">' +
      '<div><b>' + (c.last === null ? '—' : c.last) + dTxt + '</b><span>последний балл из ' + maxVal + '</span></div>' +
      '<div><b>' + (c.best === null ? '—' : c.best) + '</b><span>лучший балл</span></div>' +
      '<div><b>' + (c.avg === null ? '—' : c.avg) + '</b><span>средний балл</span></div>' +
      '<div><b>' + c.done + ' из ' + c.held + '</b><span>написано тестов' + (att === null ? '' : ' (' + att + '%)') + '</span></div>' +
      '<div><b class="' + (c.missed ? 'skip' : '') + '">' + c.missed + '</b><span>пропущено</span></div></div>' +
      '<div class="legend">Цель: ' + s.target + ' баллов из ' + maxVal + ' · ' + (left === null ? 'результатов пока нет' : left > 0 ? 'осталось набрать ' + left : 'цель достигнута') + '</div>' +
      '<div class="meter" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div>' +
      chart(c, s.target, maxVal) +
      '<div class="legend">Красный × на графике — пропущенный тест.</div>' +
      '<h3>Все тесты</h3><div class="tw"><table class="hist"><thead><tr><th>День</th><th>Ист.</th><th>МГ</th><th>ГЧ</th>' + (creative ? '' : '<th>' + nameP1 + '</th><th>' + nameP2 + '</th>') + '<th>Итого</th></tr></thead><tbody>' +
      (c.rows.slice().reverse().map(function (x) {
        if (x.st === 'done') return '<tr><td>' + fmt(x.d) + '</td><td>' + x.r.h + '</td><td>' + x.r.m + '</td><td>' + x.r.r + '</td>' + (creative ? '' : '<td>' + x.r.a + '</td><td>' + x.r.b + '</td>') + '<td><b>' + tot(x.r) + '</b></td></tr>';
        return '<tr><td>' + fmt(x.d) + '</td><td colspan="' + (creative ? 4 : 6) + '" class="' + (x.st === 'miss' ? 'skip' : 'soon') + '">' + (x.st === 'miss' ? 'Пропуск' : 'Впереди') + '</td></tr>';
      }).join('') || '<tr><td colspan="' + (creative ? 5 : 7) + '" class="mute">Дни тестов ещё не добавлены</td></tr>') +
      '</tbody></table></div>' +
      '<span class="err" data-err role="alert"></span>';
    if (teacher) html +=
      '<h3>Данные ученика</h3><div class="fg">' +
      '<label>Фамилия и имя<input name="name" value="' + esc(s.name) + '"></label>' +
      '<label>Класс<input name="cls" value="' + esc(s.cls) + '"></label>' +
      '<label>Профиль 1 (название предмета)<input name="p1" value="' + esc(s.p1) + '"></label>' +
      '<label>Профиль 2 (название предмета)<input name="p2" value="' + esc(s.p2) + '"></label></div>' +
      '<div class="row" style="margin-top:16px"><button data-act="target">Изменить цель</button><button data-act="edit">Сохранить данные</button><button data-act="pass">Сбросить пароль</button><button class="danger" data-act="del">Удалить ученика</button></div><p class="legend" data-pass role="status" style="margin-top:16px"></p>';
    el.innerHTML = html;

    el.onclick = async function (e) {
      var b = e.target.closest('button[data-act]'); if (!b) return;
      var err = el.querySelector('[data-err]'); err.textContent = '';
      var f = function (n) { return el.querySelector('[name=' + n + ']').value; };
      try {
        if (b.dataset.act === 'target') {
          var v = await ask({ title: 'Целевой балл', text: 'Сколько баллов ученик хочет набрать (' + (creative ? '0–40' : '0–140') + ')?', input: { value: s.target, min: 0, max: creative ? 40 : 140 }, ok: 'Сохранить' }); if (v === null) return;
          await api('PATCH', '/api/students/' + s.id, { target: v });
        } else if (b.dataset.act === 'edit') {
          await api('PATCH', '/api/students/' + s.id, { name: f('name'), cls: f('cls'), p1: f('p1'), p2: f('p2') });
        } else if (b.dataset.act === 'pass') {
          var newPass = prompt('Введите новый пароль для ' + s.name + ' (минимум 6 символов):', 'student123');
          if (!newPass) return;
          if (newPass.length < 6) return alert('Пароль должен быть не менее 6 символов');
          await api('POST', '/api/students/' + s.id + '/password', { password: newPass });
          el.querySelector('[data-pass]').innerHTML = 'Логин: <b>' + esc(s.login) + '</b> · Новый пароль: <b>' + esc(newPass) + '</b>'; return;
        } else if (b.dataset.act === 'del') {
          if (!(await ask({ title: 'Удалить ученика?', text: '«' + s.name + '» будет удалён вместе со всеми результатами.', ok: 'Удалить', danger: true }))) return;
          await api('DELETE', '/api/students/' + s.id); openId = null; $('dSt').close();
        }
        await reload();
      } catch (x) { err.textContent = x.message; }
    };
  }

  // ---------- экраны ----------
  function render() {
    ['auth', 'stu', 'tea'].forEach(function (i) { if ($(i)) $(i).hidden = true; });
    if ($('who')) $('who').hidden = !D;
    if (!D) { if ($('auth')) $('auth').hidden = false; if ($('sub')) $('sub').textContent = 'Пробные тесты по вторникам и пятницам'; return; }
    if ($('whoName')) $('whoName').textContent = D.me.name;
    if (D.me.role === 'student') {
      if ($('stu')) $('stu').hidden = false; if ($('sub')) $('sub').textContent = 'Ваш прогресс';
      mount($('stuBody'), D.students[0], false);
    } else {
      if ($('tea')) $('tea').hidden = false; if ($('sub')) $('sub').textContent = 'Ученики 10–11 классов';
      renderTeacher(); renderSessions();
    }
  }

  function renderTeacher() {
    if ($('thv')) $('thv').textContent = D.threshold;
    var cls = {}; D.students.forEach(function (s) { cls[s.cls] = 1; });
    var fc = $('fc'), v = fc ? fc.value : '';
    if (fc) {
      fc.innerHTML = '<option value="">Все классы</option>' + Object.keys(cls).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      fc.value = cls[v] ? v : '';
    }
    var q = $('q') ? $('q').value.trim().toLowerCase() : '', f = fc ? fc.value : '', so = $('fs') ? $('fs').value : 'name';
    var list = D.students.filter(function (s) { return (!f || s.cls === f) && (!q || s.name.toLowerCase().indexOf(q) > -1); });
    var C = {}; D.students.forEach(function (s) { C[s.id] = calc(s); });
    list.sort(function (a, b) {
      if (so === 'name') return a.name.localeCompare(b.name, 'ru');
      if (so === 'top') return (C[b.id].last == null ? -1 : C[b.id].last) - (C[a.id].last == null ? -1 : C[a.id].last);
      if (so === 'miss') return C[b.id].missed - C[a.id].missed || a.name.localeCompare(b.name, 'ru');
      return status(a).k - status(b).k || a.name.localeCompare(b.name, 'ru');
    });
    shown = list.map(function (s) { return s.id; });
    var withT = D.students.filter(function (s) { return C[s.id].last !== null; });
    var avg = withT.length ? Math.round(withT.reduce(function (a, s) { return a + C[s.id].last; }, 0) / withT.length) : '—';
    var risk = D.students.filter(function (s) { return status(s).k === 0; }).length;
    var dn = 0, hd = 0; D.students.forEach(function (s) { dn += C[s.id].done; hd += C[s.id].held; });
    if ($('stats')) $('stats').innerHTML = [[D.students.length, 'учеников'], [avg, 'средний последний балл'], [risk, 'в зоне риска'], [hd ? Math.round(dn / hd * 100) + '%' : '—', 'посещаемость тестов']]
      .map(function (x) { return '<div class="stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join('');
    if ($('rows')) $('rows').innerHTML = list.map(function (s) {
      var st = status(s), c = C[s.id], d = c.prev === null ? null : c.last - c.prev;
      var creative = isCreative(s);
      var maxVal = creative ? 40 : 140;
      var dt = d === null ? '<span class="mute">—</span>' : '<span class="' + (d > 0 ? 'ok' : d < 0 ? 'bad' : 'mute') + '">' + (d > 0 ? '+' : '') + d + '</span>';
      return '<tr tabindex="0" data-id="' + s.id + '"><td>' + esc(s.name) + (creative ? ' 🎨' : '') + '</td><td>' + esc(s.cls) + '</td><td>' + esc(s.login || '—') + '</td><td>' + (c.last === null ? '—' : c.last) + '<span class="mute">/' + maxVal + '</span></td><td>' + dt + '</td><td>' + s.target + '</td><td class="' + (c.missed ? 'skip' : '') + '">' + c.missed + ' из ' + c.held + '</td><td><span class="pill ' + st.c + '">' + st.t + '</span></td></tr>';
    }).join('');
    if ($('empty')) {
      $('empty').hidden = list.length > 0;
      $('empty').textContent = D.students.length ? 'Никого не найдено. Измените поиск или класс.' : 'Пока нет учеников. Нажмите «Добавить учеников», чтобы создать им аккаунты.';
    }
  }

  // ---------- вкладка «Тесты и баллы» ----------
  function renderSessions() {
    var S = D.sessions, td = today();
    if (!S.some(function (x) { return x.id === selSess; })) {
      var past = S.filter(function (x) { return x.d <= td; });
      selSess = past.length ? past[past.length - 1].id : (S.length ? S[0].id : null);
    }
    if ($('sSel')) {
      $('sSel').innerHTML = S.map(function (x) { return '<option value="' + x.id + '">' + fmt(x.d) + '</option>'; }).reverse().join('') || '<option value="">Нет дней тестов</option>';
      if (selSess !== null) $('sSel').value = selSess;
    }
    var cls = {}; D.students.forEach(function (s) { cls[s.cls] = 1; });
    var cv = $('sCls') ? $('sCls').value : '';
    if ($('sCls')) {
      $('sCls').innerHTML = '<option value="">Все классы</option>' + Object.keys(cls).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      $('sCls').value = cls[cv] ? cv : '';
    }
    var y = new Date().getFullYear(), m = new Date().getMonth(), y0 = m >= 7 ? y : y - 1;
    if ($('gFrom') && !$('gFrom').value) $('gFrom').value = y0 + '-09-01';
    if ($('gTo') && !$('gTo').value) $('gTo').value = (y0 + 1) + '-05-31';
    renderGrid();
  }

  function renderGrid() {
    var f = $('sCls') ? $('sCls').value : '', list = D.students.filter(function (s) { return !f || s.cls === f; });
    
    // Сортировка учеников по алфавиту внутри выбранного класса
    list.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'ru');
    });

    if ($('gSave')) $('gSave').disabled = selSess === null;
    if ($('gMsg')) { $('gMsg').textContent = ''; $('gMsg').className = ''; }
    if ($('gRows')) $('gRows').innerHTML = selSess === null ? '' : list.map(function (s) {
      var r = s.results.filter(function (x) { return x.session_id === selSess; })[0];
      var creative = isCreative(s);
      var p1Title = esc(s.p1 || 'Профиль 1');
      var p2Title = esc(s.p2 || 'Профиль 2');

      function inp(k, mx, dis, title) {
        if (dis) return '<td><input type="text" value="—" disabled title="Творческое направление" style="background:#eee; text-align:center; color:#999;"></td>';
        return '<td><input type="number" min="0" max="' + mx + '" data-k="' + k + '" aria-label="' + title + ', ' + esc(s.name) + '" placeholder="' + title + '" value="' + (r ? r[k] : '') + '"></td>';
      }
      return '<tr data-sid="' + s.id + '"><td class="nm">' + esc(s.name) + (creative ? ' 🎨' : '') + ' <small class="mute" style="display:block; font-size:11px;">' + esc(s.cls) + ' | ' + (creative ? 'Творческий' : (p1Title + ', ' + p2Title)) + '</small></td>' + inp('h', 20, false, 'История') + inp('m', 10, false, 'Мат. грамотность') + inp('r', 10, false, 'Грамотность чтения') + inp('a', 50, creative, p1Title) + inp('b', 50, creative, p2Title) + '<td class="tt"><b>' + (r ? tot(r) : '') + '</b></td></tr>';
    }).join('');
    if ($('gEmpty')) {
      $('gEmpty').hidden = selSess !== null && list.length > 0;
      $('gEmpty').textContent = selSess === null ? 'Сначала создайте дни тестов выше.' : 'В этом классе пока нет учеников.';
    }
  }

  if ($('gRows')) {
    $('gRows').addEventListener('input', function (e) {
      var tr = e.target.closest('tr'); if (!tr) return;
      var ci = e.target;
      if (ci.dataset && ci.dataset.k) { var bad = ci.value !== '' && (Number(ci.value) > Number(ci.max) || Number(ci.value) < 0); ci.classList.toggle('over', bad); ci.setAttribute('aria-invalid', bad ? 'true' : 'false'); }
      var vals = Array.prototype.map.call(tr.querySelectorAll('input:not([disabled])'), function (i) { return i.value; });
      tr.querySelector('.tt').innerHTML = '<b>' + (vals.every(function (v) { return v === ''; }) ? '' : vals.reduce(function (a, v) { return a + (+v || 0); }, 0)) + '</b>';
    });
    $('gRows').addEventListener('keydown', function (e) {
      var i = e.target;
      if (!i.matches || !i.matches('input[data-k]')) return;
      var dir = 0;
      if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) dir = 1;
      else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) dir = -1;
      if (!dir) return;
      e.preventDefault();
      var tr = i.closest('tr'), nx = dir > 0 ? tr.nextElementSibling : tr.previousElementSibling;
      var t = nx && nx.querySelector('input[data-k="' + i.dataset.k + '"]:not([disabled])');
      if (t) { t.focus(); try { t.select(); } catch (x) {} }
      else if (dir > 0 && $('gSave')) $('gSave').focus();
    });
  }

  if ($('sSel')) $('sSel').onchange = function () { selSess = +this.value; renderGrid(); };
  if ($('sCls')) $('sCls').onchange = renderGrid;
  if ($('gSave')) $('gSave').onclick = async function () {
    var over = $('gRows').querySelector('input.over');
    if (over) { $('gMsg').className = 'err'; $('gMsg').textContent = 'Проверьте выделенные поля: балл выше максимума или меньше нуля.'; over.focus(); return; }
    var rows = Array.prototype.map.call($('gRows').querySelectorAll('tr'), function (tr) {
      var o = { studentId: +tr.dataset.sid }, blank = true;
      tr.querySelectorAll('input:not([disabled])').forEach(function (i) { o[i.dataset.k] = i.value === '' ? 0 : Number(i.value); if (i.value !== '') blank = false; });
      if (blank) return { studentId: o.studentId, blank: true };
      return o;
    });
    try {
      var r = await api('PUT', '/api/sessions/' + selSess + '/results', { rows: rows });
      await reload(); $('gMsg').className = 'ok'; $('gMsg').textContent = 'Сохранено: ' + r.saved;
    } catch (e) { $('gMsg').className = 'err'; $('gMsg').textContent = e.message; }
  };
  if ($('sDel')) $('sDel').onclick = async function () {
    if (selSess === null) return;
    if (!(await ask({ title: 'Удалить день?', text: 'Вместе с днём удалятся все баллы за него.', ok: 'Удалить', danger: true }))) return;
    try { await api('DELETE', '/api/sessions/' + selSess); selSess = null; await reload(); } catch (e) { notice(e.message); }
  };
  if ($('gMake')) $('gMake').onclick = async function () {
    try { var r = await api('POST', '/api/sessions', { from: $('gFrom').value, to: $('gTo').value }); $('gErr').textContent = ''; await reload(); await notice('Добавлено дней: ' + r.added, 'Готово'); }
    catch (e) { $('gErr').textContent = e.message; }
  };
  if ($('gAdd')) $('gAdd').onclick = async function () {
    try { await api('POST', '/api/sessions', { d: $('gOne').value }); $('gErr').textContent = ''; await reload(); }
    catch (e) { $('gErr').textContent = e.message; }
  };
  if ($('pS')) $('pS').onclick = function () { pane(false); };
  if ($('pT')) $('pT').onclick = function () { pane(true); };
  function pane(t) {
    if ($('paneS')) $('paneS').hidden = t; if ($('paneT')) $('paneT').hidden = !t;
    if ($('pS')) $('pS').classList.toggle('on', !t); if ($('pT')) $('pT').classList.toggle('on', t);
  }

  function openStudent(id) {
    var s = D.students.filter(function (x) { return x.id === id; })[0]; if (!s) return;
    openId = id; mount($('dBody'), s, true); if ($('dSt')) $('dSt').showModal();
  }
  if ($('rows')) {
    $('rows').addEventListener('click', function (e) { var r = e.target.closest('tr[data-id]'); if (r) openStudent(+r.dataset.id); });
    $('rows').addEventListener('keydown', function (e) { if (e.key === 'Enter') { var r = e.target.closest('tr[data-id]'); if (r) openStudent(+r.dataset.id); } });
  }
  if ($('dClose')) $('dClose').onclick = function () { if ($('dSt')) $('dSt').close(); };
  if ($('dSt')) $('dSt').addEventListener('close', function () { openId = null; });
  ['q', 'fc', 'fs'].forEach(function (i) { if ($(i)) $(i).addEventListener('input', renderTeacher); });

  if ($('thr')) $('thr').onclick = async function () {
    var v = await ask({ title: 'Порог ЕНТ', text: 'Ученики с баллом ниже порога попадают в зону риска (0–140).', input: { value: D.threshold, min: 0, max: 140 }, ok: 'Сохранить' }); if (v === null) return;
    try { await api('PUT', '/api/settings', { threshold: v }); await reload(); } catch (e) { notice(e.message); }
  };
  if ($('npw')) $('npw').onclick = function () { openRegisterModal(); };
  if ($('exp')) $('exp').onclick = function () {
    var rows = [['Ученик', 'Класс', 'Логин', 'Профиль 1', 'Профиль 2', 'Последний балл', 'Лучший', 'Средний', 'Написано', 'Пропущено', 'Цель', 'Статус']];
    D.students.forEach(function (s) { var c = calc(s); rows.push([s.name, s.cls, s.login, s.p1, s.p2, c.last === null ? '' : c.last, c.best === null ? '' : c.best, c.avg === null ? '' : c.avg, c.done, c.missed, s.target, status(s).t]); });
    var csv = '\ufeff' + rows.map(function (r) { return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'ent-tracker.csv'; document.body.appendChild(a); a.click(); a.remove();
  };

  // ---------- Реестр учётных записей ----------
  function openRegisterModal() {
    if (!D || !D.students.length) { notice('Список учеников пуст', 'Реестр'); return; }
    var d = $('dRegister');
    if (!d) return;
    var tbody = $('regTbl');
    tbody.innerHTML = D.students.map(function (s) {
      return '<tr><td>' + s.id + '</td><td><b>' + esc(s.name) + '</b></td><td>' + esc(s.cls || '—') + '</td><td style="font-family:monospace; color:var(--pri);">' + esc(s.login || '—') + '</td><td style="text-align:center;"><button onclick="window.resetPassById(' + s.id + ', \'' + esc(s.name) + '\')" style="padding:4px 8px; font-size:12px; background:var(--bad); color:#fff; border:none; border-radius:4px; cursor:pointer;">Сбросить пароль</button></td></tr>';
    }).join('');
    d.showModal();
  }

  window.resetPassById = async function (id, name) {
    var newPass = prompt('Введите новый пароль для ' + name + ' (минимум 6 символов):', 'student123');
    if (!newPass) return;
    if (newPass.length < 6) return alert('Пароль должен быть не менее 6 символов');
    try {
      await api('POST', '/api/students/' + id + '/password', { password: newPass });
      alert('Пароль для ' + name + ' изменён на: ' + newPass);
      reload();
    } catch (e) { alert(e.message); }
  };

  if ($('regClose')) $('regClose').onclick = function () { $('dRegister').close(); };
  if ($('regCsv')) $('regCsv').onclick = function () {
    var rows = [['ID', 'ФИО', 'Класс', 'Логин']];
    D.students.forEach(function (s) { rows.push([s.id, s.name, s.cls, s.login]); });
    var csv = '\ufeff' + rows.map(function (r) { return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'реестр_учетных_записей.csv'; document.body.appendChild(a); a.click(); a.remove();
  };
  if ($('regPrint')) $('regPrint').onclick = function () {
    var printWindow = window.open('', '_blank');
    var cardsHtml = '<html><head><title>Ведомость карточек авторизации</title><style>body { font-family: Arial, sans-serif; padding: 20px; } .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; } .card { border: 2px dashed #333; padding: 15px; border-radius: 8px; page-break-inside: avoid; } .title { font-weight: bold; font-size: 16px; margin-bottom: 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; } .field { margin: 4px 0; font-size: 14px; } .val { font-weight: bold; font-family: monospace; }</style></head><body><h2>Карточки авторизации обучающихся</h2><div class="grid">';
    D.students.forEach(function (s) {
      cardsHtml += '<div class="card"><div class="title">🎯 ЕНТ Трекер | Карточка авторизации</div><div class="field">Обучающийся: <span class="val">' + esc(s.name) + '</span> (' + esc(s.cls || '—') + ')</div><div class="field">Адрес системы: <span class="val">ent-tracker.onrender.com</span></div><div class="field">Логин: <span class="val">' + esc(s.login || '—') + '</span></div><div class="field">Пароль: <span class="val">Ваш пароль</span></div></div>';
    });
    cardsHtml += '</div></body></html>';
    printWindow.document.write(cardsHtml);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(function () { printWindow.print(); }, 500);
  };

  // ---------- добавление учеников ----------
  var created = [];
  if ($('aOpen')) $('aOpen').onclick = function () { $('aForm').hidden = false; $('aRes').hidden = true; $('aErr2').textContent = ''; $('dAdd').showModal(); };
  if ($('aClose')) $('aClose').onclick = function () { $('dAdd').close(); };
  if ($('aMore')) $('aMore').onclick = function () { $('aText').value = ''; $('aForm').hidden = false; $('aRes').hidden = true; };
  if ($('aGo')) $('aGo').onclick = async function () {
    var target = Number($('aTarget').value) || 100, bad = '';
    var rows = $('aText').value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l, i) {
      var c = l.split(/\t|;/).map(function (x) { return x.trim(); });
      if (!c[0] || !c[1]) bad = bad || 'Строка ' + (i + 1) + ': нужны фамилия с именем и класс';
      var isCreativeRow = String(c[2] || '').toLowerCase().indexOf('творч') > -1 || String(c[3] || '').toLowerCase().indexOf('творч') > -1;
      var rowTarget = isCreativeRow ? Math.min(target, 35) : target;
      return { name: c[0], cls: c[1], p1: c[2] || '', p2: c[3] || '', target: rowTarget };
    });
    if (bad) { $('aErr2').textContent = bad; return; }
    if (!rows.length) { $('aErr2').textContent = 'Вставьте список учеников'; return; }
    $('aGo').disabled = true; $('aErr2').textContent = 'Создаю аккаунты…';
    try {
      var r = await api('POST', '/api/students/bulk', { rows: rows });
      created = r.created; $('aErr2').textContent = '';
      $('aTbl').innerHTML = created.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.cls) + '</td><td>' + esc(x.login) + '</td><td><b>' + esc(x.password) + '</b></td></tr>'; }).join('');
      $('aForm').hidden = true; $('aRes').hidden = false; await reload();
    } catch (e) { $('aErr2').textContent = e.message; }
    $('aGo').disabled = false;
  };
  if ($('aCsv')) $('aCsv').onclick = function () {
    var rows = [['Ученик', 'Класс', 'Логин', 'Пароль']].concat(created.map(function (x) { return [x.name, x.cls, x.login, x.password]; }));
    var csv = '\ufeff' + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'ent-logins.csv'; document.body.appendChild(a); a.click(); a.remove();
  };

  // ---------- вход / регистрация ----------
  function tab(reg) {
    if ($('fLogin')) $('fLogin').hidden = reg; if ($('fReg')) $('fReg').hidden = !reg;
    if ($('tLogin')) $('tLogin').classList.toggle('on', !reg); if ($('tReg')) $('tReg').classList.toggle('on', reg); if ($('aErr')) $('aErr').textContent = '';
  }
  if ($('tLogin')) $('tLogin').onclick = function () { tab(false); };
  if ($('tReg')) $('tReg').onclick = function () { tab(true); };
  function formData(f) { var o = {}; new FormData(f).forEach(function (v, k) { o[k] = v; }); return o; }
  if ($('fLogin')) $('fLogin').onsubmit = async function (e) {
    e.preventDefault();
    try { await api('POST', '/api/login', formData(this)); this.reset(); await reload(); } catch (x) { if ($('aErr')) $('aErr').textContent = x.message; }
  };
  if ($('fReg')) $('fReg').onsubmit = async function (e) {
    e.preventDefault();
    try { await api('POST', '/api/register', formData(this)); this.reset(); await reload(); } catch (x) { if ($('aErr')) $('aErr').textContent = x.message; }
  };
  if ($('out')) $('out').onclick = async function () { await api('POST', '/api/logout'); D = null; selSess = null; render(); };

  reload();
})();
