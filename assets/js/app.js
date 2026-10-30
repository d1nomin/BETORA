let currentUser = null, matches = [], coupon = [];
const pickName = p => p === '1' ? 'П1' : p === 'x' ? 'Х' : 'П2';
async function initApp() {
  currentUser = await requireUser(); if (!currentUser) return;
  updateUser(currentUser); await loadMatches(); await loadMyBets(); await loadTransactions();
}
function updateUser(user) {
  document.getElementById('nick').textContent = user.mc_nick;
  document.getElementById('balance').textContent = Number(user.balance).toLocaleString('ru-RU');
  document.getElementById('withdraw-balance').textContent = Number(user.balance).toLocaleString('ru-RU');
}
document.getElementById('balance-open').addEventListener('click', () => openModal('balance-modal'));
document.getElementById('withdraw-open').addEventListener('click', () => { document.getElementById('withdraw-amount').value=''; openModal('withdraw-modal'); });
document.getElementById('withdraw-all').addEventListener('click', () => document.getElementById('withdraw-amount').value = currentUser.balance);
document.getElementById('withdraw-submit').addEventListener('click', async () => {
  const amount = Number(document.getElementById('withdraw-amount').value);
  try { const data = await api('/withdraw',{method:'POST',body:{amount}}); updateUser(data.user); closeModal('withdraw-modal'); toast('Заявка на вывод отправлена. АРы будут выданы в игре в ближайшее время.','success'); await loadTransactions(); }
  catch(e){toast(e.message,'error');}
});
document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b===btn));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${btn.dataset.view}`));
}));
document.querySelectorAll('[data-esport]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-esport]').forEach(b => b.classList.toggle('active', b===btn)); renderMatches('esports-list', btn.dataset.esport);
}));
function oddsFor(match) { return match.sport === 'football' ? [['1','П1',match.odd1],['x','Х',match.oddx],['2','П2',match.odd2]] : [['1','П1',match.odd1],['2','П2',match.odd2]]; }
async function loadMatches() {
  try { matches = (await api('/matches')).matches; renderMatches('football-list','football'); renderMatches('esports-list','cs2'); }
  catch(e){toast(e.message,'error');}
}
function renderMatches(target, sport) {
  const root=document.getElementById(target); const list=matches.filter(m => m.sport===sport);
  if(!list.length){root.innerHTML='<div class="empty-state">Матчей пока нет.</div>';return;}
  root.innerHTML=list.map(m=>`<article class="match-card"><div class="match-meta"><span class="league">${esc(m.league)}</span><span>${fmtDate(m.start_time)}</span></div><div class="teams"><div class="team">${esc(m.team1)}</div><span class="versus">VS</span><div class="team">${esc(m.team2)}</div></div><div class="odds-row">${oddsFor(m).map(([pick,label,odd])=>`<button class="odd-button ${coupon.some(c=>c.match_id===m.id&&c.pick===pick)?'selected':''}" data-pick="${pick}" data-match="${m.id}" ${m.status!=='upcoming'||new Date(m.start_time)<=new Date()?'disabled':''}><span>${label}</span><strong>${Number(odd).toFixed(2)}</strong></button>`).join('')}</div>${m.status!=='upcoming'?`<p class="tiny muted">Матч закрыт</p>`:''}</article>`).join('');
  root.querySelectorAll('[data-pick]').forEach(b=>b.addEventListener('click',()=>addPick(Number(b.dataset.match),b.dataset.pick)));
}
function addPick(matchId,pick){
 const m=matches.find(x=>x.id===matchId); if(!m||m.status!=='upcoming'||new Date(m.start_time)<=new Date()){toast('На начавшийся матч ставить нельзя.','error');return;}
 coupon=coupon.filter(c=>c.match_id!==matchId); coupon.push({match_id:matchId,pick}); renderCoupon(); renderMatches('football-list','football'); renderMatches('esports-list',document.querySelector('[data-esport].active')?.dataset.esport||'cs2');
 if(innerWidth<=650){document.getElementById('coupon').classList.add('open');document.getElementById('coupon-backdrop').classList.add('open');}
}
function renderCoupon(){
 const root=document.getElementById('coupon-items');
 root.innerHTML=coupon.length?coupon.map((c,i)=>{const m=matches.find(x=>x.id===c.match_id);return `<div class="coupon-item"><div><strong>${esc(m.team1)} — ${esc(m.team2)}</strong><small>${pickName(c.pick)} · ${esc(m.league)}</small></div><button class="remove-pick" data-remove="${i}" aria-label="Убрать"><i class="fa-solid fa-xmark"></i></button></div>`}).join(''):'<div class="empty-state">Выберите коэффициент в линии</div>';
 root.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{coupon.splice(Number(b.dataset.remove),1);renderCoupon();}));
 updatePayout();
}
function updatePayout(){const amount=Math.max(0,Math.floor(Number(document.getElementById('stake-amount').value)||0));const payout=coupon.reduce((sum,c)=>{const m=matches.find(x=>x.id===c.match_id);return sum+Math.floor(amount*(Number(m?.['odd'+c.pick])||1))},0);document.getElementById('possible-payout').textContent=payout.toLocaleString('ru-RU');}
document.getElementById('stake-amount').addEventListener('input',updatePayout);
document.getElementById('coupon-close').addEventListener('click',()=>{document.getElementById('coupon').classList.remove('open');document.getElementById('coupon-backdrop').classList.remove('open');});
document.getElementById('coupon-backdrop').addEventListener('click',()=>{document.getElementById('coupon').classList.remove('open');document.getElementById('coupon-backdrop').classList.remove('open');});
document.getElementById('place-bet').addEventListener('click',async()=>{
 const amount=Number(document.getElementById('stake-amount').value); if(!coupon.length)return toast('Сначала выберите исход матча.','error');if(!Number.isSafeInteger(amount)||amount<=0)return toast('Введите целую сумму больше нуля.','error');
 try{const data=await api('/bets',{method:'POST',body:{amount,selections:coupon.map(c=>({match_id:c.match_id,pick:c.pick}))}});updateUser(data.user);coupon=[];renderCoupon();document.getElementById('stake-amount').value='';toast('Ставка принята!','success');await loadMyBets();}
 catch(e){toast(e.message,'error');}
});
async function loadMyBets(){try{const data=await api('/my-bets');const root=document.getElementById('my-bets');root.innerHTML=data.bets.length?`<table><thead><tr><th>Матч</th><th>Исход</th><th>Ставка</th><th>Коэффициент</th><th>Статус</th><th>Возможная выплата</th></tr></thead><tbody>${data.bets.map(b=>`<tr><td>${esc(b.team1)} — ${esc(b.team2)}</td><td>${pickName(b.pick)}</td><td>${b.amount} АР</td><td>${Number(b.odds).toFixed(2)}</td><td><span class="status ${b.status}">${statusLabel(b.status)}</span></td><td>${b.payout||Math.floor(b.amount*b.odds)} АР</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">Вы ещё не делали ставок.</div>';}catch(e){toast(e.message,'error');}}
async function loadTransactions(){try{const data=await api('/my-transactions');const root=document.getElementById('my-transactions');root.innerHTML=data.transactions.length?`<table><thead><tr><th>Дата</th><th>Операция</th><th>Сумма</th><th>Примечание</th></tr></thead><tbody>${data.transactions.map(t=>`<tr><td>${fmtDate(t.created_at)}</td><td>${esc(t.type)}</td><td>${t.amount>0?'+':''}${t.amount} АР</td><td>${esc(t.note)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">Операций пока нет.</div>';}catch(e){toast(e.message,'error');}}
document.getElementById('coupon').addEventListener('click',e=>{if(innerWidth<=650&&e.target.closest('.coupon-head')){document.getElementById('coupon').classList.add('open');document.getElementById('coupon-backdrop').classList.add('open');}});
initApp();
