/**
 * KolayXport team ERP — Apps Script for the Google Sheet
 * https://docs.google.com/spreadsheets/d/1G0JnXXvjZViBD-wG3uH5GPam5IiiMaioOupks80v7oU
 *
 * Source of truth: docs/gtm/erp-apps-script/Code.gs in the repo. Paste into Extensions › Apps Script.
 * What it does:
 *  - "KolayXport" menu: Bugünüm side panel per person, mark message sent, add partner, add task, daily digest on/off.
 *  - onEdit: date stamps and status sync (Wave-1 messages → Partner pipeline; Contacted/Signed dates; task done date).
 *  - Optional daily e-mail digest (off by default; e-mails come from the "Ekip" tab).
 * Layout assumptions (header row 4, data from row 5) match docs/gtm/KolayXport-ERP.xlsx (2026-10-21).
 */

const HDR = 4, FIRST = 5;
const SH = { tasks: 'Tasks', pipe: 'Partner pipeline', wave: 'Wave-1 messages', team: 'Ekip', dash: 'Dashboard' };
// Tasks columns
const T = { id: 1, task: 2, owner: 3, due: 4, status: 5, prio: 6, link: 7, dep: 8, notes: 9, overdue: 10 };
// Partner pipeline columns
const P = { id: 1, name: 2, type: 3, channel: 4, link: 5, aud: 6, score: 7, owner: 8, status: 9, contacted: 10,
            fu1: 11, fu2: 12, fu3: 13, next: 14, signed: 15, ref: 16, promo: 17, firstPost: 18, postLink: 19,
            disclosure: 20, signups: 21, activated: 22, paying: 23, bPending: 24, bPaid: 25, notes: 26 };
// Wave-1 messages columns
const W = { id: 1, owner: 2, target: 3, channel: 4, hook: 5, before: 6, msg: 7, status: 8, sentOn: 9, reply: 10 };
const PEOPLE = ['Merisa', 'Ekin', 'Atilla'];
const TZ = 'Europe/Istanbul';

/* ------------------------------------------------------------------ menu */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🚀 KolayXport')
    .addItem('📋 Bugünüm (yan panel)', 'showToday')
    .addSeparator()
    .addItem('✉️ Seçili mesajı "gönderildi" yap', 'markSelectedMessageSent')
    .addItem('💬 Seçili mesaja "cevap geldi" yaz', 'markSelectedMessageReplied')
    .addItem('✅ Seçili görevi tamamla', 'markSelectedTaskDone')
    .addSeparator()
    .addItem('➕ Yeni ortak adayı', 'showNewPartner')
    .addItem('➕ Yeni görev', 'showNewTask')
    .addSeparator()
    .addItem('📧 Günlük e-posta özetini aç', 'enableDigest')
    .addItem('🔕 Günlük e-posta özetini kapat', 'disableDigest')
    .addItem('📧 Özeti şimdi bana gönder (deneme)', 'sendDigestToMe')
    .addToUi();
  ensureTeamSheet_();
}

/* ------------------------------------------------------------------ helpers */
function ss_() { return SpreadsheetApp.getActive(); }
function sh_(name) { return ss_().getSheetByName(name); }
function today_() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function fmt_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : (d || ''); }
function rows_(sheet, ncol) {
  const last = sheet.getLastRow();
  if (last < FIRST) return [];
  return sheet.getRange(FIRST, 1, last - FIRST + 1, ncol).getValues()
    .map((v, i) => ({ row: FIRST + i, v: v }));
}
function isDone_(s) { return s === 'Done' || s === 'Cancelled'; }

function ensureTeamSheet_() {
  if (sh_(SH.team)) return;
  const s = ss_().insertSheet(SH.team);
  s.getRange('A1').setValue('Ekip / Team').setFontWeight('bold').setFontSize(14);
  s.getRange('A2').setValue('Günlük e-posta özeti bu e-postalara gider. Boş bırakılan kişiye e-posta gitmez.').setFontColor('#808080');
  s.getRange(4, 1, 1, 3).setValues([['Kişi', 'E-posta', 'Özet istiyor mu? (Evet/Hayır)']]).setFontWeight('bold');
  s.getRange(5, 1, PEOPLE.length, 3).setValues(PEOPLE.map(p => [p, '', 'Hayır']));
  s.setColumnWidth(1, 120); s.setColumnWidth(2, 260); s.setColumnWidth(3, 220);
}

/* ------------------------------------------------------------------ onEdit automation */
function onEdit(e) {
  if (!e || !e.range) return;
  const s = e.range.getSheet(), name = s.getName(), r = e.range.getRow(), c = e.range.getColumn();
  if (r < FIRST || e.range.getNumRows() > 1) return;
  const val = e.range.getValue();
  if (name === SH.wave && c === W.status) onWaveStatus_(s, r, val);
  if (name === SH.pipe && c === P.status) onPipeStatus_(s, r, val);
  if (name === SH.tasks && c === T.status) onTaskStatus_(s, r, val);
  if (name === SH.tasks && c === T.task && val && !s.getRange(r, T.id).getValue()) {
    s.getRange(r, T.id).setValue(nextTaskId_(s));
    if (!s.getRange(r, T.status).getValue()) s.getRange(r, T.status).setValue('Not started');
  }
}

function onWaveStatus_(s, r, val) {
  const id = s.getRange(r, W.id).getValue();
  if (val === 'sent' && !s.getRange(r, W.sentOn).getValue()) s.getRange(r, W.sentOn).setValue(today_());
  const map = { sent: 'Contacted', replied: 'Replied', declined: 'Declined', 'opted out': 'Opted out' };
  if (map[val]) syncPipelineFromWave_(id, map[val]);
}

function syncPipelineFromWave_(waveId, newStatus) {
  const p = sh_(SH.pipe);
  for (const x of rows_(p, P.notes)) {
    const note = String(x.v[P.notes - 1] || '');
    if (note.indexOf('draft ' + waveId + ' ') !== -1) {
      p.getRange(x.row, P.status).setValue(newStatus);
      if (newStatus === 'Contacted' && !x.v[P.contacted - 1]) p.getRange(x.row, P.contacted).setValue(today_());
      return x.row;
    }
  }
  return null;
}

function onPipeStatus_(s, r, val) {
  if (val === 'Contacted' && !s.getRange(r, P.contacted).getValue()) s.getRange(r, P.contacted).setValue(today_());
  if ((val === 'Signed' || val === 'Active') && !s.getRange(r, P.signed).getValue()) s.getRange(r, P.signed).setValue(today_());
}

function onTaskStatus_(s, r, val) {
  if (val === 'Done') {
    const n = s.getRange(r, T.notes), cur = String(n.getValue() || '');
    if (cur.indexOf('✔ done ') === -1) n.setValue((cur ? cur + ' · ' : '') + '✔ done ' + fmt_(today_()));
  }
}

function nextTaskId_(s) {
  let max = 0;
  for (const x of rows_(s, 1)) {
    const m = String(x.v[0] || '').match(/^T(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'T' + (max + 1);
}

/* ------------------------------------------------------------------ menu actions on the selected row */
function markSelectedMessageSent() { setSelectedWave_('sent'); }
function markSelectedMessageReplied() { setSelectedWave_('replied'); }
function setSelectedWave_(status) {
  const s = ss_().getActiveSheet(), r = s.getActiveRange().getRow();
  if (s.getName() !== SH.wave || r < FIRST) { SpreadsheetApp.getUi().alert('Önce "Wave-1 messages" sekmesinde bir mesaj satırı seçin.'); return; }
  setWaveStatus(s.getRange(r, W.id).getValue(), status);
  ss_().toast(s.getRange(r, W.id).getValue() + ' → ' + status, 'KolayXport', 4);
}
function markSelectedTaskDone() {
  const s = ss_().getActiveSheet(), r = s.getActiveRange().getRow();
  if (s.getName() !== SH.tasks || r < FIRST) { SpreadsheetApp.getUi().alert('Önce "Tasks" sekmesinde bir görev satırı seçin.'); return; }
  setTaskStatus(s.getRange(r, T.id).getValue(), 'Done');
  ss_().toast(s.getRange(r, T.id).getValue() + ' tamamlandı', 'KolayXport', 4);
}

/* ------------------------------------------------------------------ API used by the side panel */
function setWaveStatus(waveId, status) {
  const s = sh_(SH.wave);
  for (const x of rows_(s, W.reply)) {
    if (x.v[W.id - 1] === waveId) {
      s.getRange(x.row, W.status).setValue(status);
      onWaveStatus_(s, x.row, status);
      return true;
    }
  }
  return false;
}
function setTaskStatus(taskId, status) {
  const s = sh_(SH.tasks);
  for (const x of rows_(s, T.overdue)) {
    if (x.v[T.id - 1] === taskId) {
      s.getRange(x.row, T.status).setValue(status);
      onTaskStatus_(s, x.row, status);
      return true;
    }
  }
  return false;
}
function logFollowUp(pipeRow) {
  const s = sh_(SH.pipe), n = s.getRange(pipeRow, P.notes), cur = String(n.getValue() || '');
  n.setValue('Takip mesajı ' + fmt_(today_()) + (cur ? ' · ' + cur : ''));
  return true;
}
function setPartnerStatus(pipeRow, status) {
  const s = sh_(SH.pipe);
  s.getRange(pipeRow, P.status).setValue(status);
  onPipeStatus_(s, pipeRow, status);
  return true;
}
function jumpTo(sheetName, row) {
  const s = sh_(sheetName); ss_().setActiveSheet(s); s.setActiveRange(s.getRange(row, 1));
  return true;
}
function savePerson(p) { PropertiesService.getUserProperties().setProperty('kxPerson', p); return p; }
function getPerson() { return PropertiesService.getUserProperties().getProperty('kxPerson') || ''; }

/** Everything the panel shows for one person. */
function getToday(person) {
  const t0 = today_(), weekEnd = new Date(t0.getTime() + 7 * 864e5);
  const out = { person: person, overdue: [], week: [], followups: [], unsent: [], replies: [] };
  for (const x of rows_(sh_(SH.tasks), T.overdue)) {
    const v = x.v; if (!v[T.task - 1] || v[T.owner - 1] !== person || isDone_(v[T.status - 1])) continue;
    const due = v[T.due - 1] instanceof Date ? v[T.due - 1] : null;
    const item = { id: v[T.id - 1], text: v[T.task - 1], due: fmt_(due), status: v[T.status - 1], row: x.row, link: v[T.link - 1] };
    if (due && due < t0) out.overdue.push(item); else if (!due || due <= weekEnd) out.week.push(item);
  }
  for (const x of rows_(sh_(SH.pipe), P.notes)) {
    const v = x.v; if (v[P.owner - 1] !== person) continue;
    const st = v[P.status - 1];
    if ((st === 'Contacted' || st === 'Terms sent') && v[P.contacted - 1] instanceof Date) {
      const days = Math.floor((t0 - v[P.contacted - 1]) / 864e5);
      const step = days >= 16 ? 'Kapanış (3. adım)' : days >= 9 ? 'Takip 2' : days >= 4 ? 'Takip 1' : '';
      if (step) out.followups.push({ row: x.row, name: v[P.name - 1], step: step, days: days, link: v[P.link - 1] });
    }
    if (st === 'Replied') out.replies.push({ row: x.row, name: v[P.name - 1], link: v[P.link - 1] });
  }
  for (const x of rows_(sh_(SH.wave), W.reply)) {
    const v = x.v; if (v[W.owner - 1] !== person) continue;
    if (!v[W.status - 1] || v[W.status - 1] === 'draft') out.unsent.push({ id: v[W.id - 1], target: v[W.target - 1], row: x.row, msg: v[W.msg - 1] });
  }
  return out;
}

/* ------------------------------------------------------------------ side panel + dialogs */
function showToday() {
  const html = HtmlService.createHtmlOutput(PANEL_HTML).setTitle('Bugünüm · KolayXport');
  SpreadsheetApp.getUi().showSidebar(html);
}

function showNewPartner() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(PARTNER_HTML).setWidth(420).setHeight(470), 'Yeni ortak adayı');
}
function addPartner(f) {
  const s = sh_(SH.pipe);
  let r = FIRST; const vals = s.getRange(FIRST, P.name, s.getMaxRows() - FIRST + 1, 1).getValues();
  while (r - FIRST < vals.length && vals[r - FIRST][0]) r++;
  let max = 0;
  s.getRange(FIRST, 1, Math.max(1, r - FIRST), 1).getValues().forEach(v => { const m = String(v[0]).match(/^P(\d+)/); if (m) max = Math.max(max, +m[1]); });
  s.getRange(r, P.id).setValue('P' + ('00' + (max + 1)).slice(-3));
  s.getRange(r, P.name).setValue(f.name); s.getRange(r, P.type).setValue(f.type); s.getRange(r, P.channel).setValue(f.channel);
  s.getRange(r, P.link).setValue(f.link); s.getRange(r, P.aud).setValue(f.aud ? Number(f.aud) : '');
  s.getRange(r, P.score).setValue(f.score ? Number(f.score) : ''); s.getRange(r, P.owner).setValue(f.owner);
  s.getRange(r, P.status).setValue('Shortlisted'); s.getRange(r, P.notes).setValue((f.notes || '') + ' · eklendi ' + fmt_(today_()));
  return r;
}

function showNewTask() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(TASK_HTML).setWidth(420).setHeight(400), 'Yeni görev');
}
function addTask(f) {
  const s = sh_(SH.tasks);
  let r = FIRST; const vals = s.getRange(FIRST, T.task, s.getMaxRows() - FIRST + 1, 1).getValues();
  while (r - FIRST < vals.length && vals[r - FIRST][0]) r++;
  const id = nextTaskId_(s);
  s.getRange(r, T.id).setValue(id); s.getRange(r, T.task).setValue(f.task); s.getRange(r, T.owner).setValue(f.owner);
  if (f.due) { const p = f.due.split('-'); s.getRange(r, T.due).setValue(new Date(+p[0], +p[1] - 1, +p[2])); }
  s.getRange(r, T.status).setValue('Not started'); s.getRange(r, T.prio).setValue(f.prio || 'P1');
  s.getRange(r, T.link).setValue(f.link || ''); s.getRange(r, T.notes).setValue(f.notes || '');
  return id;
}

/* ------------------------------------------------------------------ daily digest (off by default) */
function enableDigest() {
  disableDigest(true);
  ScriptApp.newTrigger('sendDailyDigest').timeBased().everyDays(1).atHour(8).inTimezone(TZ).create();
  SpreadsheetApp.getUi().alert('Günlük özet açıldı: her sabah 08:00 (İstanbul). Alıcılar: "Ekip" sekmesinde e-postası olan ve "Evet" yazan kişiler.');
}
function disableDigest(silent) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendDailyDigest').forEach(t => ScriptApp.deleteTrigger(t));
  if (silent !== true) SpreadsheetApp.getUi().alert('Günlük özet kapatıldı.');
}
function team_() {
  const s = sh_(SH.team); if (!s) return [];
  return rows_(s, 3).map(x => ({ person: x.v[0], email: String(x.v[1] || '').trim(), on: String(x.v[2] || '').toLowerCase().startsWith('e') }))
    .filter(x => x.person);
}
function digestText_(person) {
  const d = getToday(person), L = [];
  const url = ss_().getUrl();
  if (!d.overdue.length && !d.week.length && !d.followups.length && !d.unsent.length && !d.replies.length) return '';
  L.push('Günaydın ' + person + ', KolayXport günlük özetin (' + fmt_(today_()) + '):', '');
  if (d.overdue.length) { L.push('⏰ GECİKEN GÖREVLER'); d.overdue.forEach(x => L.push('  • ' + x.id + ' ' + x.text + ' (son tarih ' + x.due + ')')); L.push(''); }
  if (d.replies.length) { L.push('💬 CEVAP BEKLEYEN ORTAKLAR'); d.replies.forEach(x => L.push('  • ' + x.name)); L.push(''); }
  if (d.followups.length) { L.push('🔁 TAKİP ZAMANI'); d.followups.forEach(x => L.push('  • ' + x.name + ': ' + x.step + ' (' + x.days + ' gün önce yazıldı)')); L.push(''); }
  if (d.unsent.length) { L.push('✉️ GÖNDERİLMEMİŞ İLK MESAJLAR'); d.unsent.forEach(x => L.push('  • ' + x.id + ' ' + x.target)); L.push(''); }
  if (d.week.length) { L.push('📅 BU HAFTA'); d.week.forEach(x => L.push('  • ' + x.id + ' ' + x.text + (x.due ? ' (' + x.due + ')' : ''))); L.push(''); }
  L.push('Panel: ' + url, '(KolayXport menüsü › Bugünüm)');
  return L.join('\n');
}
function sendDailyDigest() {
  team_().filter(x => x.on && x.email).forEach(x => {
    const body = digestText_(x.person);
    if (body) MailApp.sendEmail(x.email, 'KolayXport · bugünün işleri (' + fmt_(today_()) + ')', body);
  });
}
function sendDigestToMe() {
  const person = getPerson();
  if (!person) { SpreadsheetApp.getUi().alert('Önce "Bugünüm" panelinden kim olduğunuzu seçin.'); return; }
  const body = digestText_(person) || 'Bugün için açık iş yok.';
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'KolayXport · deneme özeti (' + person + ')', body);
  SpreadsheetApp.getUi().alert('Deneme özeti size gönderildi.');
}

/* ------------------------------------------------------------------ HTML */
const PANEL_HTML = `
<style>
 body{font-family:Arial,sans-serif;font-size:13px;margin:10px;color:#222}
 h3{font-size:13px;margin:16px 0 6px;color:#1F3A5F} .card{border:1px solid #e3e3e3;border-radius:6px;padding:8px;margin-bottom:6px}
 .muted{color:#888;font-size:11px} button{font-size:12px;margin:4px 4px 0 0;padding:4px 8px;border-radius:4px;border:1px solid #1F3A5F;background:#fff;color:#1F3A5F;cursor:pointer}
 button.primary{background:#1F3A5F;color:#fff} select{font-size:13px;padding:4px;width:100%} .bad{color:#c0392b;font-weight:bold}
 .empty{color:#888;font-style:italic} textarea{width:100%;height:120px;font-size:11px}
</style>
<div><select id="who" onchange="pick(this.value)"><option value="">Ben kimim?</option><option>Merisa</option><option>Ekin</option><option>Atilla</option></select></div>
<div id="out"><p class="muted">Yükleniyor…</p></div>
<script>
 const R = google.script.run;
 function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
 function pick(p){ if(!p) return; R.withSuccessHandler(load).savePerson(p); }
 function load(p){ document.getElementById('who').value=p; document.getElementById('out').innerHTML='<p class="muted">Yükleniyor…</p>'; R.withSuccessHandler(render).getToday(p); }
 function sec(title, items, fn){ return '<h3>'+title+' ('+items.length+')</h3>' + (items.length? items.map(fn).join('') : '<p class="empty">Yok 🎉</p>'); }
 function render(d){
  let h='';
  h+=sec('⏰ Geciken görevler', d.overdue, x=>'<div class="card"><b>'+esc(x.id)+'</b> '+esc(x.text)+'<div class="bad">Son tarih '+esc(x.due)+'</div><button class="primary" onclick="task(\\''+x.id+'\\')">Tamamlandı</button><button onclick="jump(\\'Tasks\\','+x.row+')">Aç</button></div>');
  h+=sec('💬 Cevap gelen ortaklar', d.replies, x=>'<div class="card">'+esc(x.name)+'<br><button class="primary" onclick="pstat('+x.row+',\\'Terms sent\\')">Şartları gönderdim</button><button onclick="pstat('+x.row+',\\'Signed\\')">Kabul etti</button><button onclick="pstat('+x.row+',\\'Declined\\')">Reddetti</button><button onclick="jump(\\'Partner pipeline\\','+x.row+')">Aç</button></div>');
  h+=sec('🔁 Takip zamanı', d.followups, x=>'<div class="card">'+esc(x.name)+'<div class="muted">'+esc(x.step)+' · '+x.days+' gün önce yazıldı</div><button class="primary" onclick="fu('+x.row+')">Takip yazdım</button><button onclick="pstat('+x.row+',\\'Replied\\')">Cevap geldi</button><button onclick="jump(\\'Partner pipeline\\','+x.row+')">Aç</button></div>');
  h+=sec('✉️ Gönderilecek ilk mesajlar', d.unsent, x=>'<div class="card"><b>'+esc(x.id)+'</b> '+esc(x.target)+'<details><summary class="muted">Mesajı göster</summary><textarea readonly>'+esc(x.msg)+'</textarea></details><button class="primary" onclick="wave(\\''+x.id+'\\',\\'sent\\')">Gönderdim</button><button onclick="jump(\\'Wave-1 messages\\','+x.row+')">Aç</button></div>');
  h+=sec('📅 Bu hafta', d.week, x=>'<div class="card"><b>'+esc(x.id)+'</b> '+esc(x.text)+'<div class="muted">'+(x.due?('Son tarih '+esc(x.due)):'Tarih yok')+' · '+esc(x.status)+'</div><button class="primary" onclick="task(\\''+x.id+'\\')">Tamamlandı</button><button onclick="jump(\\'Tasks\\','+x.row+')">Aç</button></div>');
  h+='<p class="muted" style="margin-top:16px">Kural: kontrol etmeden "gönderildi/ödendi" yazma. Sayılar /admin/partners ve Stripe\\'tan.</p>';
  document.getElementById('out').innerHTML=h;
 }
 function again(){ load(document.getElementById('who').value); }
 function task(id){ R.withSuccessHandler(again).setTaskStatus(id,'Done'); }
 function wave(id,s){ R.withSuccessHandler(again).setWaveStatus(id,s); }
 function pstat(row,s){ R.withSuccessHandler(again).setPartnerStatus(row,s); }
 function fu(row){ R.withSuccessHandler(again).logFollowUp(row); }
 function jump(sh,row){ R.jumpTo(sh,row); }
 R.withSuccessHandler(p=>{ if(p) load(p); else document.getElementById('out').innerHTML='<p class="muted">Yukarıdan kendinizi seçin.</p>'; }).getPerson();
</script>`;

const PARTNER_HTML = `
<style>body{font-family:Arial;font-size:13px} label{display:block;margin-top:8px} input,select,textarea{width:100%;font-size:13px;padding:4px} button{margin-top:12px;padding:6px 12px;background:#1F3A5F;color:#fff;border:0;border-radius:4px}</style>
<label>Ad / grup *<input id="name"></label>
<label>Link *<input id="link" placeholder="https://"></label>
<label>Tür<select id="type"><option>fb_admin</option><option>tg_admin</option><option>x_voice</option><option>youtube</option><option>musavir</option><option>other</option></select></label>
<label>Kanal<select id="channel"><option>Facebook</option><option>Telegram</option><option>WhatsApp</option><option>X</option><option>YouTube</option><option>Instagram</option><option>Other</option></select></label>
<label>Kitle (üye/takipçi)<input id="aud" type="number"></label>
<label>Puan 0–10<input id="score" type="number" min="0" max="10"></label>
<label>Sorumlu<select id="owner"><option>Merisa</option><option>Ekin</option></select></label>
<label>Not<textarea id="notes" rows="2"></textarea></label>
<button onclick="save()">Ekle</button>
<script>
function save(){ const f={}; ['name','link','type','channel','aud','score','owner','notes'].forEach(k=>f[k]=document.getElementById(k).value.trim());
 if(!f.name||!f.link){alert('Ad ve link gerekli');return;}
 google.script.run.withSuccessHandler(()=>google.script.host.close()).addPartner(f); }
</script>`;

const TASK_HTML = `
<style>body{font-family:Arial;font-size:13px} label{display:block;margin-top:8px} input,select,textarea{width:100%;font-size:13px;padding:4px} button{margin-top:12px;padding:6px 12px;background:#1F3A5F;color:#fff;border:0;border-radius:4px}</style>
<label>Görev *<input id="task"></label>
<label>Sorumlu<select id="owner"><option>Merisa</option><option>Ekin</option><option>Atilla</option></select></label>
<label>Son tarih<input id="due" type="date"></label>
<label>Öncelik<select id="prio"><option>P0</option><option selected>P1</option><option>P2</option></select></label>
<label>Link<input id="link"></label>
<label>Not<textarea id="notes" rows="2"></textarea></label>
<button onclick="save()">Ekle</button>
<script>
function save(){ const f={}; ['task','owner','due','prio','link','notes'].forEach(k=>f[k]=document.getElementById(k).value.trim());
 if(!f.task){alert('Görev gerekli');return;}
 google.script.run.withSuccessHandler(()=>google.script.host.close()).addTask(f); }
</script>`;
