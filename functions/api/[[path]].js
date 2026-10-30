// Единый маршрутизатор Pages Functions. Все ответы API возвращаются в JSON.
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8', ...headers}});
const fail = (message, status = 400) => json({error:message}, status);
const now = () => new Date().toISOString();
const cookieName = 'betora_session';
const cookie = (token, maxAge=604800) => `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const clearCookie = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
function cleanText(v, max=120) { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }
function validInt(v) { return Number.isSafeInteger(v) && v > 0; }
function tokenHex(bytes=32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return [...a].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:210000,hash:'SHA-256'},key,256);
  return b64(bits);
}
async function ensureAdmin(env) {
  if (!env.ADMIN_LOGIN || !env.ADMIN_PASSWORD) return;
  const login = cleanText(env.ADMIN_LOGIN,32);
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(login) || String(env.ADMIN_PASSWORD).length < 12) throw new Error('ADMIN_LOGIN должен быть 3–32 символа, ADMIN_PASSWORD — не менее 12 символов.');
  const exists = await env.DB.prepare('SELECT id FROM users WHERE login = ? COLLATE NOCASE').bind(login).first();
  if (!exists) {
    const salt=tokenHex(16), hash=await derive(String(env.ADMIN_PASSWORD),salt);
    await env.DB.prepare("INSERT INTO users(mc_nick,login,password_hash,salt,balance,role) VALUES(?,?,?,?,0,'admin')").bind('BETORA_Admin',login,hash,salt).run();
  } else {
    await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(exists.id).run();
  }
}
async function userFromRequest(request, env) {
  const raw=request.headers.get('Cookie')||'', match=raw.match(/(?:^|;\s*)betora_session=([a-f0-9]{64})(?:;|$)/);
  if(!match)return null;
  const session=await env.DB.prepare('SELECT user_id FROM sessions WHERE token=? AND expires_at>?').bind(match[1],now()).first();
  if(!session)return null;
  return await env.DB.prepare('SELECT id,mc_nick,login,balance,role,created_at FROM users WHERE id=?').bind(session.user_id).first();
}
function requireFields(obj, fields) { return fields.every(k => obj && Object.prototype.hasOwnProperty.call(obj,k)); }
async function bodyJson(request) { try { return await request.json(); } catch (_) { return null; } }
async function requireAdmin(request, env) { const user=await userFromRequest(request,env); return user?.role==='admin'?user:null; }
async function settleOne(env, bet, result) {
  if (bet.status !== 'pending') return;
  const won = bet.pick === result, payout = won ? Math.floor(bet.amount * bet.odds) : 0;
  const statements = [
    env.DB.prepare('UPDATE bets SET status=?,payout=? WHERE id=? AND status=?').bind(won?'won':'lost',payout,bet.id,'pending')
  ];
  if (won) {
    statements.push(env.DB.prepare('UPDATE users SET balance=balance+? WHERE id=?').bind(payout,bet.user_id));
    statements.push(env.DB.prepare("INSERT INTO transactions(user_id,type,amount,note) VALUES(?,?,?,?)").bind(bet.user_id,'Выигрыш',payout,`Выплата по ставке №${bet.id}`));
  }
  await env.DB.batch(statements);
}
export async function onRequest(context) {
  const {request,env}=context, url=new URL(request.url), path=url.pathname.replace(/^\/api\/?/,'').replace(/\/$/,'')||'', method=request.method;
  try {
    await ensureAdmin(env);
    if(path==='register'&&method==='POST'){
      const b=await bodyJson(request), nick=cleanText(b?.mc_nick,16), login=cleanText(b?.login,32), password=typeof b?.password==='string'?b.password:'';
      if(!/^[A-Za-z0-9_]{3,16}$/.test(nick))return fail('Ник Minecraft должен содержать 3–16 латинских букв, цифр или _.');
      if(!/^[A-Za-z0-9_.-]{3,32}$/.test(login))return fail('Логин должен содержать 3–32 символа: латиница, цифры, _, . или -.');
      if(password.length<6||password.length>200)return fail('Пароль должен содержать от 6 до 200 символов.');
      const existing=await env.DB.prepare('SELECT login FROM users WHERE login=? COLLATE NOCASE OR mc_nick=? COLLATE NOCASE').bind(login,nick).first();
      if(existing)return fail('Этот логин или Minecraft-ник уже занят.',409);
      const salt=tokenHex(16), hash=await derive(password,salt);
      const result=await env.DB.prepare("INSERT INTO users(mc_nick,login,password_hash,salt,balance,role) VALUES(?,?,?, ?,0,'user')").bind(nick,login,hash,salt).run();
      const userId=result.meta.last_row_id, token=tokenHex();
      await env.DB.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').bind(token,userId,new Date(Date.now()+7*86400000).toISOString()).run();
      return json({user:{id:userId,mc_nick:nick,login,balance:0,role:'user'}},201,{'set-cookie':cookie(token)});
    }
    if(path==='login'&&method==='POST'){
      const b=await bodyJson(request), login=cleanText(b?.login,32), password=typeof b?.password==='string'?b.password:'';
      if(!login||!password)return fail('Введите логин и пароль.');
      const cutoff=Math.floor(Date.now()/1000)-600;
      await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at<?').bind(cutoff).run();
      const attempts=await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE login=? COLLATE NOCASE AND attempted_at>=?').bind(login,cutoff).first();
      if(attempts.n>=5)return fail('Слишком много неудачных попыток. Попробуйте через 10 минут.',429);
      const u=await env.DB.prepare('SELECT * FROM users WHERE login=? COLLATE NOCASE').bind(login).first();
      const hash=u?await derive(password,u.salt):'';
      if(!u||hash!==u.password_hash){await env.DB.prepare('INSERT INTO login_attempts(login,attempted_at) VALUES(?,?)').bind(login,Math.floor(Date.now()/1000)).run();return fail('Неверный логин или пароль.',401);}
      await env.DB.prepare('DELETE FROM login_attempts WHERE login=? COLLATE NOCASE').bind(login).run();
      const token=tokenHex();await env.DB.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').bind(token,u.id,new Date(Date.now()+7*86400000).toISOString()).run();
      return json({user:{id:u.id,mc_nick:u.mc_nick,login:u.login,balance:u.balance,role:u.role}},200,{'set-cookie':cookie(token)});
    }
    if(path==='logout'&&method==='POST'){
      const raw=request.headers.get('Cookie')||'',m=raw.match(/(?:^|;\s*)betora_session=([a-f0-9]{64})/);if(m)await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(m[1]).run();return json({ok:true},200,{'set-cookie':clearCookie});
    }
    if(path==='me'&&method==='GET'){const user=await userFromRequest(request,env);return user?json({user}):fail('Необходим вход.',401);}
    if(path==='matches'&&method==='GET'){const result=await env.DB.prepare('SELECT * FROM matches ORDER BY start_time ASC').all();return json({matches:result.results});}
    const user=await userFromRequest(request,env);
    if(path==='bets'&&method==='POST'){
      if(!user)return fail('Необходим вход.',401);
      const b=await bodyJson(request);if(!validInt(b?.amount)||!Array.isArray(b?.selections)||b.selections.length<1||b.selections.length>10)return fail('Укажите сумму и от 1 до 10 исходов.');
      if(b.selections.some(s=>!Number.isSafeInteger(s.match_id)||!['1','x','2'].includes(s.pick))||new Set(b.selections.map(s=>s.match_id)).size!==b.selections.length)return fail('Некорректный купон.');
      const totalCost=b.amount*b.selections.length;if(!Number.isSafeInteger(totalCost)||totalCost>1000000000)return fail('Слишком большая сумма купона.');
      const balance=await env.DB.prepare('SELECT balance FROM users WHERE id=?').bind(user.id).first();if(balance.balance<totalCost)return fail('Недостаточно АР на балансе для всего купона.',409);
      const prepared=[], betRows=[];let totalOdds=1;
      for(const s of b.selections){const m=await env.DB.prepare('SELECT * FROM matches WHERE id=?').bind(s.match_id).first();if(!m||m.status!=='upcoming'||new Date(m.start_time).getTime()<=Date.now())return fail('Один из матчей уже начался или закрыт.',409);if(s.pick==='x'&&(m.sport!=='football'||!m.oddx))return fail('Для этого матча ничья недоступна.');const odds=Number(m['odd'+s.pick]);if(!Number.isFinite(odds)||odds<=1)return fail('Некорректный коэффициент.');totalOdds*=odds;betRows.push({match_id:m.id,pick:s.pick,odds});}
      const statements=[env.DB.prepare('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?').bind(totalCost,user.id,totalCost),env.DB.prepare("INSERT INTO transactions(user_id,type,amount,note) VALUES(?,?,?,?)").bind(user.id,'Ставка',-totalCost,`${betRows.length} одиночных ставок в купоне`)];
      for(const item of betRows)statements.push(env.DB.prepare("INSERT INTO bets(user_id,match_id,pick,amount,odds,status,payout) VALUES(?,?,?,?,?,'pending',0)").bind(user.id,item.match_id,item.pick,b.amount,item.odds));
      await env.DB.batch(statements);
      const updated=await env.DB.prepare('SELECT id,mc_nick,login,balance,role,created_at FROM users WHERE id=?').bind(user.id).first();
      return json({ok:true,total_odds:totalOdds,user:updated});
    }
    if(path==='my-bets'&&method==='GET'){
      if(!user)return fail('Необходим вход.',401);
      const data=await env.DB.prepare('SELECT b.*,m.team1,m.team2,m.league,m.sport,m.start_time FROM bets b JOIN matches m ON m.id=b.match_id WHERE b.user_id=? ORDER BY b.created_at DESC,b.id DESC').bind(user.id).all();return json({bets:data.results});
    }
    if(path==='my-transactions'&&method==='GET'){
      if(!user)return fail('Необходим вход.',401);const data=await env.DB.prepare('SELECT type,amount,note,created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 200').bind(user.id).all();return json({transactions:data.results});
    }
    if(path==='withdraw'&&method==='POST'){
      if(!user)return fail('Необходим вход.',401);const b=await bodyJson(request);if(!validInt(b?.amount))return fail('Сумма должна быть целым числом больше нуля.');const current=await env.DB.prepare('SELECT balance FROM users WHERE id=?').bind(user.id).first();if(current.balance<b.amount)return fail('Недостаточно АР на балансе.',409);
      await env.DB.batch([env.DB.prepare('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?').bind(b.amount,user.id,b.amount),env.DB.prepare("INSERT INTO withdrawals(user_id,amount,status) VALUES(?,?,'pending')").bind(user.id,b.amount),env.DB.prepare("INSERT INTO transactions(user_id,type,amount,note) VALUES(?,?,?,?)").bind(user.id,'Вывод',-b.amount,'Заявка на вывод отправлена')]);
      const updated=await env.DB.prepare('SELECT id,mc_nick,login,balance,role,created_at FROM users WHERE id=?').bind(user.id).first();return json({ok:true,user:updated});
    }
    if(path.startsWith('admin/')){
      if(!user||user.role!=='admin')return fail('Доступ только для администратора.',403);
      if(path==='admin/users'&&method==='GET'){const data=await env.DB.prepare("SELECT id,mc_nick,login,balance,role,created_at FROM users ORDER BY created_at DESC").all();return json({users:data.results});}
      if(path==='admin/balance'&&method==='POST'){
        const b=await bodyJson(request);if(!Number.isSafeInteger(b?.user_id)||!Number.isSafeInteger(b?.amount)||b.amount===0||Math.abs(b.amount)>1000000000)return fail('Некорректная сумма или пользователь.');
        const target=await env.DB.prepare('SELECT id,balance FROM users WHERE id=?').bind(b.user_id).first();if(!target)return fail('Пользователь не найден.',404);if(target.balance+b.amount<0)return fail('Баланс не может быть отрицательным.',409);
        const note=cleanText(b.note,120)||'Изменение администратором';
        await env.DB.batch([env.DB.prepare('UPDATE users SET balance=balance+? WHERE id=? AND balance+?>=0').bind(b.amount,b.user_id,b.amount),env.DB.prepare('INSERT INTO transactions(user_id,type,amount,note) VALUES(?,?,?,?)').bind(b.user_id,b.amount>0?'Начисление администратором':'Списание администратором',b.amount,note)]);return json({ok:true});
      }
      if(path==='admin/withdrawals'&&method==='GET'){
        const status=url.searchParams.get('status')==='done'?'done':'pending';const data=await env.DB.prepare('SELECT w.*,u.mc_nick,u.login FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status=? ORDER BY w.created_at DESC').bind(status).all();const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM withdrawals WHERE status='pending'").first();return json({withdrawals:data.results,pending_count:count.n});
      }
      if(path==='admin/withdrawals/complete'&&method==='POST'){
        const b=await bodyJson(request);if(!Number.isSafeInteger(b?.id))return fail('Некорректный номер заявки.');const w=await env.DB.prepare("SELECT * FROM withdrawals WHERE id=? AND status='pending'").bind(b.id).first();if(!w)return fail('Заявка не найдена или уже выполнена.',409);await env.DB.prepare("UPDATE withdrawals SET status='done',done_at=? WHERE id=? AND status='pending'").bind(now(),w.id).run();return json({ok:true});
      }
      if(path==='admin/bets'&&method==='GET'){const data=await env.DB.prepare('SELECT b.*,u.mc_nick,m.team1,m.team2,m.league FROM bets b JOIN users u ON u.id=b.user_id JOIN matches m ON m.id=b.match_id ORDER BY b.created_at DESC LIMIT 500').all();return json({bets:data.results});}
      if(path==='admin/bets/settle'&&method==='POST'){
        const b=await bodyJson(request);if(!Number.isSafeInteger(b?.bet_id)||!['won','lost'].includes(b?.result))return fail('Некорректный расчёт.');const bet=await env.DB.prepare('SELECT * FROM bets WHERE id=?').bind(b.bet_id).first();if(!bet||bet.status!=='pending')return fail('Ставка уже рассчитана или не найдена.',409);await settleOne(env,bet,b.result==='won'?bet.pick:'__no_match__');return json({ok:true});
      }
      if(path==='admin/matches'&&method==='POST'){
        const b=await bodyJson(request);const err=validateMatch(b);if(err)return fail(err);const r=await env.DB.prepare("INSERT INTO matches(sport,league,team1,team2,start_time,odd1,oddx,odd2,status) VALUES(?,?,?,?,?,?,?,?,?)").bind(b.sport,cleanText(b.league,80),cleanText(b.team1,80),cleanText(b.team2,80),new Date(b.start_time).toISOString(),Number(b.odd1),b.sport==='football'?Number(b.oddx):null,Number(b.odd2),b.status||'upcoming').run();return json({ok:true,id:r.meta.last_row_id},201);
      }
      if(path==='admin/matches'&&method==='PUT'){
        const b=await bodyJson(request);if(!Number.isSafeInteger(b?.id))return fail('Не указан матч.');const err=validateMatch(b);if(err)return fail(err);const result=await env.DB.prepare('UPDATE matches SET sport=?,league=?,team1=?,team2=?,start_time=?,odd1=?,oddx=?,odd2=?,status=? WHERE id=?').bind(b.sport,cleanText(b.league,80),cleanText(b.team1,80),cleanText(b.team2,80),new Date(b.start_time).toISOString(),Number(b.odd1),b.sport==='football'?Number(b.oddx):null,Number(b.odd2),b.status||'upcoming',b.id).run();return result.meta.changes?json({ok:true}):fail('Матч не найден.',404);
      }
      if(path==='admin/matches'&&method==='DELETE'){
        const id=Number(url.searchParams.get('id'));if(!Number.isSafeInteger(id)||id<1)return fail('Некорректный матч.');const bets=await env.DB.prepare('SELECT COUNT(*) AS n FROM bets WHERE match_id=?').bind(id).first();if(bets.n)return fail('Нельзя удалить матч, у которого есть ставки.',409);await env.DB.prepare('DELETE FROM matches WHERE id=?').bind(id).run();return json({ok:true});
      }
      if(path==='admin/matches/settle'&&method==='POST'){
        const b=await bodyJson(request);if(!Number.isSafeInteger(b?.match_id)||!['1','x','2'].includes(b?.result))return fail('Некорректный результат.');const m=await env.DB.prepare('SELECT * FROM matches WHERE id=?').bind(b.match_id).first();if(!m)return fail('Матч не найден.',404);if(b.result==='x'&&(m.sport!=='football'||!m.oddx))return fail('Ничья доступна только в футболе.');const bets=(await env.DB.prepare("SELECT * FROM bets WHERE match_id=? AND status='pending'").bind(m.id).all()).results;for(const bet of bets)await settleOne(env,bet,b.result);await env.DB.prepare("UPDATE matches SET status='finished',result=? WHERE id=?").bind(b.result,m.id).run();return json({ok:true,settled:bets.length});
      }
      if(path==='admin/transactions'&&method==='GET'){const data=await env.DB.prepare('SELECT t.*,u.mc_nick,u.login FROM transactions t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 500').all();return json({transactions:data.results});}
    }
    return fail('Эндпоинт не найден.',404);
  } catch (e) {
    return fail(e?.message?.includes('ADMIN_')?e.message:'Внутренняя ошибка сервера.',500);
  }
}
function validateMatch(b){
  if(!b||!['football','cs2','dota2'].includes(b.sport))return 'Укажите корректный вид спорта.';
  if(!cleanText(b.league,80)||!cleanText(b.team1,80)||!cleanText(b.team2,80))return 'Заполните лигу и обе команды.';
  if(!Number.isFinite(Date.parse(b.start_time)))return 'Некорректная дата матча.';
  if(!Number.isFinite(Number(b.odd1))||Number(b.odd1)<=1||!Number.isFinite(Number(b.odd2))||Number(b.odd2)<=1)return 'Коэффициенты должны быть больше 1.';
  if(b.sport==='football'&&(!Number.isFinite(Number(b.oddx))||Number(b.oddx)<=1))return 'Для футбола укажите коэффициент ничьей.';
  if(b.status&&!['upcoming','live','finished'].includes(b.status))return 'Некорректный статус матча.';
  return null;
}
