 'use strict';
const $=id=>document.getElementById(id);
const states={todo:'할 일',doing:'진행 중',done:'완료'},priorities={low:'낮음',mid:'보통',high:'높음'};
const config=window.APP_CONFIG||{};
let tasks=[],editing=null,dragged=null,timer,session=null,busy=false;
function notify(text){$('notice').textContent=text;clearTimeout(timer);timer=setTimeout(()=>$('notice').textContent='',6500)}
// 인증 세션과 카드 모두 영구 브라우저 저장소에 저장하지 않습니다.
// 새로고침 시 다시 로그인해야 합니다.
async function request(path,{method='GET',body,token,prefer}={}){
 const response=await fetch(config.SUPABASE_URL+path,{method,headers:{apikey:config.SUPABASE_ANON_KEY,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=null}
 if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||'요청 실패 ('+response.status+')');
 return data;
}
async function token(){
 if(!session)throw Error('먼저 로그인하세요.');
 if(Date.now()/1000>session.expires_at-60){
  try{const next=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});setSession(next)}catch(e){clearSession();throw Error('로그인이 만료되었습니다. 다시 로그인하세요.')}
 }
 return session.access_token;
}
function setSession(value){session={...value,expires_at:value.expires_at||Date.now()/1000+value.expires_in}}
function clearSession(){session=null;tasks=[];editing=null;$('dialog').close();$('workspace').hidden=true;$('auth').hidden=false;$('board').replaceChildren();$('password').value=''}
async function db(path='',options={}){return request('/rest/v1/'+path,{...options,token:await token()})}
async function load(){tasks=await db('tasks?select=id,title,description,status,priority,due,updated_at&order=created_at.asc,id.asc');tasks=tasks.map(t=>({...t,due:t.due||''}));render()}
function lock(value){busy=value;document.querySelectorAll('#workspace button,#workspace select,#form button,#form input,#form textarea,#form select').forEach(n=>n.disabled=value);document.querySelectorAll('.card').forEach(n=>n.draggable=!value)}
async function mutate(action,message='Supabase에 저장했습니다.'){
 if(busy)return false;lock(true);
 try{await action();try{await load();notify(message)}catch(e){notify('저장 요청은 완료되었으나 목록을 불러오지 못했습니다. 새로고침으로 확인하세요.')}return true}
 catch(e){notify('변경하지 못했습니다: '+e.message);return false}finally{lock(false)}
}
async function updateTask(id,patch){await mutate(()=>patchTask(id,patch),'변경사항을 Supabase에 저장했습니다.')}
async function patchTask(id,patch){const rows=await db('tasks?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:patch,prefer:'return=representation'});if(!rows?.length)throw Error('카드가 삭제되었거나 접근 권한이 없습니다. 새로고침하세요.')}
function valid(t){return t&&typeof t.id==='string'&&t.id.length<=200&&typeof t.title==='string'&&t.title.trim().length>0&&t.title.length<=160&&typeof t.description==='string'&&t.description.length<=5000&&Object.hasOwn(states,t.status)&&Object.hasOwn(priorities,t.priority)&&typeof t.due==='string'&&(t.due===''||(/^\d{4}-\d{2}-\d{2}$/.test(t.due)&&!Number.isNaN(Date.parse(t.due))&&new Date(t.due).toISOString().slice(0,10)===t.due))}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
function render(){const board=$('board');board.replaceChildren();const q=$('search').value.trim().toLocaleLowerCase();for(const [status,name]of Object.entries(states)){const col=el('section','column '+status);col.setAttribute('aria-label',name);const list=tasks.filter(t=>t.status===status&&(!q||(t.title+' '+t.description).toLocaleLowerCase().includes(q)));const heading=el('h2','col-head');heading.append(el('span','dot'),document.createTextNode(name),el('span','count',String(list.length)));col.append(heading);const cards=el('div','cards');for(const t of list){const card=el('article','card');card.draggable=true;card.addEventListener('dragstart',e=>{dragged=t.id;e.dataTransfer.setData('text/plain',t.id);e.dataTransfer.effectAllowed='move'});card.addEventListener('dragend',()=>{dragged=null;document.querySelectorAll('.over').forEach(x=>x.classList.remove('over'))});const prioritySelect=el('select','quick-priority badge '+t.priority);prioritySelect.setAttribute('aria-label',t.title+' 우선순위');for(const [value,label]of Object.entries(priorities)){const option=el('option','','우선순위: '+label);option.value=value;prioritySelect.append(option)}prioritySelect.value=t.priority;prioritySelect.onchange=()=>updateTask(t.id,{priority:prioritySelect.value});card.append(prioritySelect,el('h3','',t.title));if(t.description)card.append(el('p','',t.description));const foot=el('div','foot');foot.append(el('span','',t.due?'마감 '+t.due:'마감일 없음'));const edit=el('button','edit','수정');edit.setAttribute('aria-label',t.title+' 수정');edit.onclick=()=>openTask(t.id);foot.append(edit);card.append(foot);const controls=el('div','card-controls');const complete=el('button','quick-done',t.status==='done'?'↶ 완료 취소':'✓ 완료 처리');complete.setAttribute('aria-label',t.title+(t.status==='done'?' 완료 취소':' 완료 처리'));complete.onclick=()=>{const nextStatus=t.status==='done'?'todo':'done';updateTask(t.id,{status:nextStatus})};controls.append(complete);card.append(controls);cards.append(card)}if(!list.length)cards.append(el('p','empty',q?'검색 결과가 없습니다.':'아직 카드가 없습니다.'));col.append(cards);const add=el('button','add-col','＋ 할 일 추가');add.onclick=()=>openTask(null,status);col.append(add);col.addEventListener('dragover',e=>{e.preventDefault();if(dragged)col.classList.add('over')});col.addEventListener('dragleave',e=>{if(!col.contains(e.relatedTarget))col.classList.remove('over')});col.addEventListener('drop',e=>{e.preventDefault();col.classList.remove('over');if(dragged)updateTask(dragged,{status});dragged=null});board.append(col)}const done=tasks.filter(t=>t.status==='done').length;$('summary').textContent=`전체 ${tasks.length}개 · 완료 ${done}개 · 완료율 ${tasks.length?Math.round(done/tasks.length*100):0}%`;$('bar').style.width=(tasks.length?done/tasks.length*100:0)+'%'}
function openTask(id=null,status='todo'){editing=id;const t=tasks.find(t=>t.id===id);$('form').reset();$('formTitle').textContent=t?'할 일 수정':'새 할 일';$('title').value=t?.title||'';$('description').value=t?.description||'';$('status').value=t?.status||status;$('priority').value=t?.priority||'mid';$('due').value=t?.due||'';$('delete').hidden=!t;$('dialog').showModal();$('title').focus()}

$('new').onclick=()=>openTask();$('cancel').onclick=()=>$('dialog').close();$('search').oninput=render;
$('dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault()});
$('title').oninput=()=>$('title').setCustomValidity('');
$('form').onsubmit=async e=>{e.preventDefault();if(busy)return;const title=$('title').value.trim();if(!title){$('title').setCustomValidity('제목을 입력하세요.');$('title').reportValidity();return}
const payload={title,description:$('description').value.trim(),status:$('status').value,priority:$('priority').value,due:$('due').value||null};
const ok=await mutate(()=>editing?patchTask(editing,payload):db('tasks',{method:'POST',body:{...payload,id:crypto.randomUUID(),user_id:session.user.id}}),'저장했습니다.');if(ok)$('dialog').close();};
$('delete').onclick=async()=>{if(!editing||busy||!confirm('이 할 일을 삭제할까요?'))return;const id=editing;const ok=await mutate(async()=>{const rows=await db('tasks?id=eq.'+encodeURIComponent(id),{method:'DELETE',prefer:'return=representation'});if(!rows?.length)throw Error('이미 삭제된 카드입니다. 새로고침하세요.')},'삭제했습니다.');if(ok)$('dialog').close()};
$('export').onclick=async()=>{if(busy)return;lock(true);try{await load();const clean=tasks.map(({id,title,description,status,priority,due})=>({id,title,description,status,priority,due}));const blob=new Blob([JSON.stringify({version:1,tasks:clean},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='kanban-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){notify('내보내기 실패: '+e.message)}finally{lock(false)}};
$('import').onclick=()=>$('file').click();
$('file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10000000)throw Error('파일은 10MB 이하여야 합니다.');const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.tasks)||!data.tasks.every(valid)||new Set(data.tasks.map(t=>t.id)).size!==data.tasks.length)throw Error('지원하지 않는 백업 형식입니다.');if(confirm('현재 계정의 카드를 백업 '+data.tasks.length+'개로 모두 교체할까요?')){const clean=data.tasks.map(({id,title,description,status,priority,due})=>({id,title,description,status,priority,due}));await mutate(()=>db('rpc/replace_my_tasks',{method:'POST',body:{p_tasks:clean}}),'백업을 Supabase에 가져왔습니다.')}}catch(e){notify('가져오기 실패: '+e.message)}finally{e.target.value=''}};
async function authenticate(signup=false){
 if(!$('auth-form').reportValidity())return;
 const buttons=$('auth-form').querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
 try{if(!config.SUPABASE_URL?.startsWith('https://')||config.SUPABASE_URL.includes('YOUR_PROJECT')||!config.SUPABASE_ANON_KEY)throw Error('config.js에 Supabase URL과 공개 키를 설정하세요.');
 const result=await request(signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password',{method:'POST',body:{email:$('email').value.trim(),password:$('password').value}});
 if(!result.access_token){notify('인증 메일을 확인한 다음 로그인하세요.');return}
 setSession(result);$('password').value='';$('account').textContent=session.user.email;$('auth').hidden=true;$('workspace').hidden=false;
 try{await load()}catch(e){notify('목록을 불러오지 못했습니다: '+e.message)}
 }catch(e){notify('인증 실패: '+e.message)}finally{buttons.forEach(b=>b.disabled=false)}
}
$('auth-form').onsubmit=e=>{e.preventDefault();authenticate()};$('signup').onclick=()=>authenticate(true);
$('logout').onclick=async()=>{if(busy)return;try{await request('/auth/v1/logout',{method:'POST',token:session.access_token})}catch{notify('서버 로그아웃 요청에 실패했습니다. 이 화면의 로그인 정보는 삭제했습니다.')}finally{clearSession()}};
$('refresh').onclick=async()=>{if(busy)return;lock(true);try{await load();notify('최신 데이터를 불러왔습니다.')}catch(e){notify(e.message)}finally{lock(false)}};
