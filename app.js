(function(){
'use strict';

const TRIED_KEY='xd_tried_v1';
const CACHE_KEY='xd_codes_cache_v1';
const READ_KEY='xd_client_last_read_v1';
const TIMEOUT_MS=8000;
const PROGRESS_MS=1500;
const PLATFORMS={x:'X（推特）',weibo:'微博',xiaohongshu:'小红书',douyin:'抖音',wechat:'微信'};
const STATUS_TEXT={available:'可能可用',used_uncertain:'可能已被使用',tried:'我试过'};
const SORT_TEXT={latest:'最新在前',available:'可能可用在前',oldest:'最早在前'};
const ALLOWED_STATUS=new Set(['available','used_uncertain']);
const MOCK_TODAY_VISITORS=128;
const MOCK_TOTAL_VISITORS=4096;

const el={};
let tried=new Set();
let rawItems=[];
let payloadMeta={};
let currentSorted=[];
let heroItem=null;
let filters={status:'all',platform:'all',query:''};
let sortMode='latest';
let visibleCount=20;
let etag='';
let contentHash='';
let lastReadAt='';
let firstLoadDone=false;
let refreshing=false;
let timeoutId=null;
let progressId=null;
let toastId=null;
let searchTimer=null;
let statusChanged=new Set();
let previousOrder=new Map();
const copyState=new WeakMap();

document.addEventListener('DOMContentLoaded',init);

function init(){
  cacheDom();
  loadTried();
  loadCacheToMemory();
  bindEvents();
  renderAll();
  loadData(false);
  window.appReady=true;
  window.__xdApp={
    getState:function(){
      return {items:rawItems.length,tried:Array.from(tried),sort:sortMode,filters:Object.assign({},filters),hero:heroItem&&heroItem.code,etag:etag,lastReadAt:lastReadAt};
    },
    refresh:function(){return loadData(true);}
  };
}

function cacheDom(){
  const ids=['refreshBtn','refreshLabel','cacheBanner','cacheText','retryBtn','topTime','heroStatus','heroCode','heroDemoBadge','heroCopyBtn','heroTriedBtn','heroPlatform','heroAuthor','heroCollected','heroNote','searchInput','listMeta','skeleton','listRows','noResult','noResultText','totalStat','todayStat','recentStat','todayVisitorsStat','totalVisitorsStat','generatedStat','clientReadStat','clearTriedBtn','toast','toastText'];
  ids.forEach(id=>{el[id]=document.getElementById(id);});
}

function safeGet(key){try{return localStorage.getItem(key);}catch(e){return null;}}
function safeSet(key,value){try{localStorage.setItem(key,value);}catch(e){/* 存储不可用时仍可在本次会话内运行 */}}
function safeRemove(key){try{localStorage.removeItem(key);}catch(e){}}

function loadTried(){
  try{
    const parsed=JSON.parse(safeGet(TRIED_KEY)||'[]');
    tried=new Set(Array.isArray(parsed)?parsed.filter(x=>typeof x==='string'):[]);
  }catch(e){tried=new Set();}
}

function saveTried(){safeSet(TRIED_KEY,JSON.stringify(Array.from(tried)));}

function loadCacheToMemory(){
  try{
    const cached=JSON.parse(safeGet(CACHE_KEY)||'null');
    if(!cached||!Array.isArray(cached.items))return;
    rawItems=cached.items;
    payloadMeta=cached.meta||{};
    etag=cached.etag||'';
    contentHash=cached.contentHash||'';
    lastReadAt=cached.readAt||safeGet(READ_KEY)||'';
    firstLoadDone=rawItems.length>0;
    if(rawItems.length)showCacheBanner('正在显示 '+formatClock(lastReadAt)+' 的缓存 · 正在读取最新数据');
  }catch(e){/* 坏缓存直接忽略 */}
}

function saveCache(items,meta,readAt){
  const record={items:items,meta:meta,etag:etag,contentHash:contentHash,readAt:readAt};
  safeSet(CACHE_KEY,JSON.stringify(record));
  safeSet(READ_KEY,readAt);
}

function getDataSourceUrl(){
  const requested=new URLSearchParams(location.search).get('data');
  if(requested&&/^[A-Za-z0-9_\-\/\.]+\.json$/.test(requested)&&requested.indexOf('..')===-1)return requested;
  return 'data/codes.json';
}

function bindEvents(){
  el.refreshBtn.addEventListener('click',()=>loadData(true));
  el.retryBtn.addEventListener('click',()=>loadData(true));
  el.searchInput.addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{
      filters.query=el.searchInput.value.trim();
      visibleCount=20;
      renderAll();
    },200);
  });
  el.clearTriedBtn.addEventListener('click',()=>{
    tried.clear();saveTried();renderAll();showToast('已清除本机记录');
  });
  document.addEventListener('click',event=>{
    const sortBtn=event.target.closest('[data-sort]');
    if(sortBtn){setSort(sortBtn.dataset.sort);return;}
    const statusBtn=event.target.closest('[data-status]');
    if(statusBtn){setStatusFilter(statusBtn.dataset.status);return;}
    const platformBtn=event.target.closest('[data-platform]');
    if(platformBtn){setPlatformFilter(platformBtn.dataset.platform);return;}
    const clearSearchBtn=event.target.closest('[data-clear-search]');
    if(clearSearchBtn){el.searchInput.value='';filters.query='';visibleCount=20;renderAll();return;}
    const clearFiltersBtn=event.target.closest('[data-clear-filters]');
    if(clearFiltersBtn){filters.status='all';filters.platform='all';visibleCount=20;renderAll();return;}
    const copyCodeBtn=event.target.closest('[data-copy-code]');
    if(copyCodeBtn){copyText(copyCodeBtn.dataset.copyCode,copyCodeBtn);return;}
    const copyTermBtn=event.target.closest('[data-copy-term]');
    if(copyTermBtn){copyText(copyTermBtn.dataset.copyTerm,copyTermBtn);return;}
    const triedBtn=event.target.closest('[data-tried-code]');
    if(triedBtn){toggleTried(triedBtn.dataset.triedCode);return;}
    if(event.target.closest('#heroCopyBtn')){copyText(heroItem&&heroItem.code,el.heroCopyBtn);return;}
    if(event.target.closest('#heroTriedBtn')){toggleTried(heroItem&&heroItem.code);}
  });
  window.addEventListener('scroll',()=>{
    if(currentSorted.length<=visibleCount)return;
    if(window.innerHeight+window.scrollY<document.body.offsetHeight-400)return;
    visibleCount+=20;
    renderList(currentSorted);
  });
}

function setSort(value){
  if(!SORT_TEXT[value])return;
  sortMode=value;
  document.querySelectorAll('[data-sort]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.sort===value)));
  renderAll();
}
function setStatusFilter(value){
  filters.status=value;
  document.querySelectorAll('[data-status]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.status===value)));
  visibleCount=20;renderAll();
}
function setPlatformFilter(value){
  filters.platform=value;
  document.querySelectorAll('[data-platform]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.platform===value)));
  visibleCount=20;renderAll();
}

async function loadData(manual){
  if(refreshing)return;
  refreshing=true;
  el.refreshBtn.disabled=true;
  el.refreshBtn.classList.add('is-busy');
  el.refreshLabel.textContent='读取中';
  progressId=setTimeout(()=>{el.refreshLabel.textContent='仍在读取…';},PROGRESS_MS);
  const controller=new AbortController();
  timeoutId=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try{
    const headers=etag?{'If-None-Match':etag}:{};
    const response=await fetch(getDataSourceUrl(),{headers:headers,cache:'no-store',signal:controller.signal});
    if(response.status===304){
      markReadSuccess(null);
      showToast('数据未变化');
      return;
    }
    if(!response.ok)throw new Error('HTTP '+response.status);
    const text=await response.text();
    const nextHash=hashString(text);
    if(nextHash===contentHash&&rawItems.length){
      markReadSuccess(null);
      showToast('数据未变化');
      return;
    }
    const parsed=JSON.parse(text);
    const normalized=normalizePayload(parsed);
    const prevByCode=new Map(rawItems.map(item=>[item.code,item.status]));
    previousOrder=new Map(currentSorted.map((item,index)=>[item.code,index]));
    rawItems=normalized.items;
    payloadMeta=normalized.meta;
    etag=response.headers.get('ETag')||etag;
    contentHash=nextHash;
    detectStatusChanges(prevByCode);
    markReadSuccess(normalized);
    showToast(manual?'已读取最新数据':'数据已就绪');
  }catch(error){
    handleFailure(describeError(error));
  }finally{
    clearTimeout(timeoutId);clearTimeout(progressId);
    timeoutId=null;progressId=null;
    refreshing=false;
    el.refreshBtn.disabled=false;
    el.refreshBtn.classList.remove('is-busy');
    el.refreshLabel.textContent='刷新数据';
  }
}

function describeError(error){
  if(error&&error.name==='AbortError')return '读取超时（超过 8 秒）';
  return (error&&error.message)?error.message:'未知错误';
}

function markReadSuccess(normalized){
  lastReadAt=new Date().toISOString();
  firstLoadDone=true;
  if(normalized)saveCache(normalized.items,payloadMeta,lastReadAt);
  else saveCache(rawItems,payloadMeta,lastReadAt);
  hideCacheBanner();
  renderAll();
}

function handleFailure(reason){
  firstLoadDone=true;
  if(rawItems.length)showCacheBanner('正在显示 '+formatClock(lastReadAt)+' 的缓存 · 读取失败：'+reason);
  else showCacheBanner('首次读取失败：'+reason+'。当前没有可显示的数据。');
  renderAll();
}

function preserveScroll(change){
  const y=window.scrollY;
  change();
  requestAnimationFrame(()=>window.scrollTo(0,y));
}
function showCacheBanner(text){preserveScroll(()=>{el.cacheText.textContent=text;el.cacheBanner.hidden=false;});}
function hideCacheBanner(){preserveScroll(()=>{el.cacheBanner.hidden=true;});}

function normalizePayload(data){
  const isArray=Array.isArray(data);
  const source=isArray?data:(data&&data.items);
  if(!Array.isArray(source))throw new Error('JSON 缺少 items 数组');
  const meta=isArray?{}:(data||{});
  const valid=[];
  source.forEach((raw,index)=>{
    if(!raw||typeof raw!=='object')return console.warn('跳过非对象条目',index);
    const code=typeof raw.code==='string'?raw.code.trim().toUpperCase():'';
    if(!code)return console.warn('跳过缺少 code 的条目',index);
    if(!ALLOWED_STATUS.has(raw.status))return console.warn('跳过状态值无效的条目',code,raw.status);
    if(!PLATFORMS[raw.platform])return console.warn('跳过平台值无效的条目',code,raw.platform);
    const author=typeof raw.author==='string'?raw.author.trim():'';
    if(!author)return console.warn('跳过缺少作者的条目',code);
    const url=typeof raw.post_url==='string'&&/^https?:\/\//i.test(raw.post_url)?raw.post_url:null;
    valid.push({
      code:code,
      platform:raw.platform,
      platform_label:PLATFORMS[raw.platform],
      author:author,
      post_url:url,
      first_collected_at:validDate(raw.first_collected_at),
      source_posted_at:validDate(raw.source_posted_at),
      data_content_updated_at:validDate(raw.data_content_updated_at),
      last_successful_capture_at:validDate(raw.last_successful_capture_at),
      generated_at:validDate(raw.generated_at)||validDate(meta.generated_at),
      status:raw.status,
      status_reason:typeof raw.status_reason==='string'&&raw.status_reason?raw.status_reason:'社区反馈推断，不代表官方核验',
      is_demo:raw.is_demo===true||/^DEMO/i.test(code),
      order:index
    });
  });
  if(source.length&&valid.length===0)throw new Error('JSON 中没有有效条目');
  return {items:valid,meta:{generated_at:validDate(meta.generated_at),data_version:typeof meta.data_version==='string'?meta.data_version:null,note:typeof meta.note==='string'?meta.note:null}};
}

function validDate(value){
  if(typeof value!=='string'||!value.trim())return null;
  return isFinite(Date.parse(value))?value:null;
}

function detectStatusChanges(previous){
  statusChanged.clear();
  rawItems.forEach(item=>{
    if(previous.get(item.code)==='available'&&item.status==='used_uncertain')statusChanged.add(item.code);
  });
  if(statusChanged.size)setTimeout(()=>{statusChanged.clear();renderAll();},2000);
}

function renderAll(){
  renderHero();
  renderStats();
  const scoped=applySearchAndPlatform(rawItems);
  updateFilterCounts(scoped);
  const filtered=applyStatus(scoped);
  currentSorted=sortItems(filtered);
  renderList(currentSorted);
}

function displayStatus(item){return tried.has(item.code)?'tried':item.status;}

function applySearchAndPlatform(items){
  const query=filters.query.replace(/\s+/g,'').toLowerCase();
  return items.filter(item=>{
    if(filters.platform!=='all'&&item.platform!==filters.platform)return false;
    if(!query)return true;
    const code=item.code.replace(/\s+/g,'').toLowerCase();
    const author=item.author.toLowerCase();
    const platform=(item.platform_label+' '+item.platform).toLowerCase();
    return code.indexOf(query)>-1||author.indexOf(query)>-1||platform.indexOf(query)>-1;
  });
}

function applyStatus(items){
  if(filters.status==='all')return items;
  return items.filter(item=>filters.status==='tried'?tried.has(item.code):displayStatus(item)===filters.status);
}

function timeValue(item){
  if(!item.first_collected_at)return null;
  const value=Date.parse(item.first_collected_at);
  return isFinite(value)?value:null;
}

function compareByTime(a,b,direction){
  const ta=timeValue(a),tb=timeValue(b);
  if(ta===null&&tb===null)return a.order-b.order;
  if(ta===null)return 1;
  if(tb===null)return -1;
  if(ta!==tb)return direction==='asc'?ta-tb:tb-ta;
  return a.order-b.order;
}

function sortItems(items){
  const list=items.slice();
  list.sort((a,b)=>{
    if((statusChanged.has(a.code)||statusChanged.has(b.code))&&previousOrder.has(a.code)&&previousOrder.has(b.code)){
      const locked=previousOrder.get(a.code)-previousOrder.get(b.code);
      if(locked!==0)return locked;
    }
    if(sortMode==='oldest')return compareByTime(a,b,'asc');
    if(sortMode==='available'){
      const av=(item)=>item.status==='available'?0:1;
      if(av(a)!==av(b))return av(a)-av(b);
      return compareByTime(a,b,'desc');
    }
    return compareByTime(a,b,'desc');
  });
  return list;
}

function selectHero(items){
  if(!items.length)return null;
  const candidates=items.filter(item=>item.status==='available'&&!tried.has(item.code)).sort((a,b)=>compareByTime(a,b,'desc'));
  if(candidates.length)return candidates[0];
  return items.slice().sort((a,b)=>compareByTime(a,b,'desc'))[0]||null;
}

function renderHero(){
  heroItem=selectHero(rawItems);
  if(!heroItem){
    el.heroCode.textContent='暂无数据';
    el.heroCode.classList.remove('oversize');
    el.heroStatus.innerHTML='';
    el.heroDemoBadge.hidden=true;
    el.heroPlatform.textContent='--';
    el.heroAuthor.textContent='--';
    el.heroCollected.textContent='--';
    el.heroNote.textContent='当前 JSON 没有数据条目，不显示 DEMO 冒充真实数据。点「刷新数据」可重新读取已发布文件。';
    el.heroCopyBtn.disabled=true;
    el.heroTriedBtn.disabled=true;
    el.heroTriedBtn.setAttribute('aria-pressed','false');
    el.heroTriedBtn.textContent='我试过了';
    return;
  }
  const item=heroItem;
  const display=displayStatus(item);
  el.heroCode.textContent=item.code;
  el.heroCode.classList.toggle('oversize',item.code.length>8);
  el.heroDemoBadge.hidden=!item.is_demo;
  let chip=chipHtml(display,display==='tried'?'仅本机标记，不代表服务端状态':item.status_reason);
  if(display==='tried')chip+=' <span class="server-status-note">服务端：'+STATUS_TEXT[item.status]+'</span>';
  el.heroStatus.innerHTML=chip;
  el.heroPlatform.textContent=item.platform_label;
  el.heroAuthor.textContent=item.author;
  el.heroCollected.textContent=formatRelative(item.first_collected_at);
  el.heroNote.textContent=(item.is_demo?'DEMO 示例，不对应真实邀请码；':'')+'状态为社区反馈推断，不代表官方核验。';
  el.heroCopyBtn.disabled=false;
  el.heroTriedBtn.disabled=false;
  el.heroTriedBtn.setAttribute('aria-pressed',String(tried.has(item.code)));
  el.heroTriedBtn.textContent=tried.has(item.code)?'已试':'我试过了';
}

function renderStats(){
  const now=Date.now();
  const dayStart=beijingDayStart(now);
  const withTime=rawItems.filter(item=>item.first_collected_at&&isFinite(Date.parse(item.first_collected_at)));
  const today=withTime.filter(item=>{const t=Date.parse(item.first_collected_at);return t>=dayStart&&t<=now;}).length;
  const recent=withTime.filter(item=>{const t=Date.parse(item.first_collected_at);return t>=now-15*60*1000&&t<=now;}).length;
  el.totalStat.innerHTML=rawItems.length+'<small>个</small>';
  el.todayStat.innerHTML=today+'<small>个</small>';
  el.recentStat.innerHTML=recent+'<small>个</small>';
  el.todayVisitorsStat.innerHTML=MOCK_TODAY_VISITORS+'<small>人</small>';
  el.totalVisitorsStat.innerHTML=MOCK_TOTAL_VISITORS+'<small>人</small>';
  el.generatedStat.textContent=formatClock(payloadMeta.generated_at);
  el.clientReadStat.textContent=formatClock(lastReadAt);
  el.topTime.textContent=formatClock(payloadMeta.generated_at);
  el.clearTriedBtn.textContent='清除本机记录（'+tried.size+'）';
}

function beijingDayStart(nowMs){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hourCycle:'h23'}).formatToParts(new Date(nowMs));
  const get=type=>parts.find(part=>part.type===type).value;
  return Date.UTC(Number(get('year')),Number(get('month'))-1,Number(get('day')),0,0,0)-8*60*60*1000;
}

function formatClock(value){
  if(!value||!isFinite(Date.parse(value)))return '--:--';
  try{return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}catch(e){return '--:--';}
}

function formatRelative(value){
  if(!value||!isFinite(Date.parse(value)))return '时间未知';
  const diff=Date.now()-Date.parse(value);
  if(diff<0)return '时间待核';
  if(diff<60*1000)return '刚刚';
  if(diff<60*60*1000)return Math.floor(diff/60000)+' 分钟前';
  if(diff<24*60*60*1000)return Math.floor(diff/3600000)+' 小时前';
  try{return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}catch(e){return '时间未知';}
}

function updateFilterCounts(scoped){
  const counts={all:scoped.length,available:0,used_uncertain:0,tried:0};
  scoped.forEach(item=>{
    const status=displayStatus(item);
    if(status==='tried')counts.tried++;
    else counts[status]++;
  });
  document.querySelectorAll('[data-count]').forEach(node=>{node.textContent=String(counts[node.dataset.count]||0);});
}

function renderList(items){
  el.listMeta.textContent='共 '+items.length+' 条 · 当前排序：'+SORT_TEXT[sortMode];
  if(!firstLoadDone){
    el.skeleton.hidden=false;el.listRows.innerHTML='';el.noResult.hidden=true;return;
  }
  el.skeleton.hidden=true;
  if(!items.length){
    el.listRows.innerHTML='';
    el.noResult.hidden=false;
    const hasFilter=filters.status!=='all'||filters.platform!=='all';
    const hasSearch=!!filters.query;
    if(hasFilter&&hasSearch)el.noResultText.textContent='当前筛选与搜索组合下没有结果。建议先清除筛选，再调整搜索词。';
    else if(hasFilter)el.noResultText.textContent='当前筛选条件下没有结果。';
    else if(hasSearch)el.noResultText.textContent='没有匹配“'+filters.query+'”的邀请码。';
    else el.noResultText.textContent='当前数据文件没有可显示的邀请码。';
    el.noResult.querySelector('[data-clear-filters]').hidden=!hasFilter;
    el.noResult.querySelector('[data-clear-search]').hidden=!hasSearch;
    return;
  }
  el.noResult.hidden=true;
  el.listRows.innerHTML=items.slice(0,visibleCount).map(rowHtml).join('');
}

function rowHtml(item){
  const display=displayStatus(item);
  const isMine=display==='tried';
  const sourceLabel=escapeHtml(item.platform_label);
  const source=item.post_url
    ? '<a class="src-plat" href="'+escapeAttr(item.post_url)+'" target="_blank" rel="noopener noreferrer">'+sourceLabel+'</a>'
    : '<div class="src-plat">'+sourceLabel+'</div>';
  const demo=item.is_demo?'<span class="demo-tag">DEMO</span>':'';
  const changed=statusChanged.has(item.code)?' is-status-changed':'';
  const sub=statusChanged.has(item.code)?'刚由可能可用更新':'';
  return '<article class="row'+(isMine?' is-mine':'')+changed+'" data-code="'+escapeAttr(item.code)+'">'+
    '<div class="code-cell" data-code-value><span class="code-text">'+escapeHtml(item.code)+'</span>'+demo+'</div>'+
    '<div class="src-cell">'+source+'<div class="src-author">'+escapeHtml(item.author)+'</div></div>'+
    '<div class="time-cell">'+escapeHtml(formatRelative(item.first_collected_at))+'</div>'+
    '<div class="status-cell">'+chipHtml(display,display==='tried'?'仅本机标记，不代表服务端状态':item.status_reason)+'<div class="status-sub">'+sub+'</div></div>'+
    '<div class="act-cell">'+
      '<button class="mini-btn" type="button" data-copy-code="'+escapeAttr(item.code)+'">复制</button>'+
      '<button class="tried-btn" type="button" aria-pressed="'+String(isMine)+'" data-tried-code="'+escapeAttr(item.code)+'">'+(isMine?'已试':'试过')+'</button>'+
    '</div>'+
  '</article>';
}

function chipHtml(status,reason){
  const cls=status==='available'?'st-ok':status==='used_uncertain'?'st-used':'st-mine';
  return '<span class="chip-status '+cls+'" title="'+escapeAttr(reason||'')+'"><i class="sdot" aria-hidden="true"></i>'+STATUS_TEXT[status]+'</span>';
}

function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function escapeAttr(value){return escapeHtml(value);}

function toggleTried(code){
  if(!code)return;
  if(tried.has(code))tried.delete(code);else tried.add(code);
  saveTried();
  renderAll();
  showToast(tried.has(code)?'已标记“'+code+'”为试过':'已撤销“'+code+'”的试过标记');
}

async function copyText(text,button){
  if(!text||!button)return;
  if(!copyState.has(button))copyState.set(button,{html:button.innerHTML,timer:null});
  const state=copyState.get(button);
  clearTimeout(state.timer);
  button.classList.remove('copied');
  removeFallbackHint(button);
  try{
    await navigator.clipboard.writeText(text);
    button.textContent='已复制';
    button.classList.add('copied');
    showToast('已复制 '+text);
  }catch(error){
    selectTextNear(button,text);
    button.textContent='无法自动复制';
    const hint=document.createElement('span');
    hint.className='copy-fallback-hint';
    hint.textContent='已选中，长按或按 Ctrl+C';
    button.insertAdjacentElement('afterend',hint);
    showToast('无法自动复制，已选中，长按或按 Ctrl+C');
  }
  state.timer=setTimeout(()=>{
    button.innerHTML=state.html;
    button.classList.remove('copied');
    removeFallbackHint(button);
  },1600);
}

function removeFallbackHint(button){
  const parent=button.parentElement;
  if(parent){const hint=parent.querySelector('.copy-fallback-hint');if(hint)hint.remove();}
}

function selectTextNear(button,text){
  const scope=button.closest('.row')||button.closest('.card-hero')||document.body;
  const target=scope.querySelector('[data-code-value]')||scope.querySelector('.code-cell')||scope.querySelector('.term');
  const selection=window.getSelection();
  if(target&&target.textContent.trim()===text&&selection){
    const range=document.createRange();range.selectNodeContents(target);selection.removeAllRanges();selection.addRange(range);return;
  }
  const area=document.createElement('textarea');
  area.value=text;
  area.setAttribute('readonly','');
  area.style.position='fixed';area.style.top='0';area.style.left='-9999px';
  document.body.appendChild(area);area.select();
  setTimeout(()=>area.remove(),1600);
}

function showToast(text){
  el.toastText.textContent=text;
  el.toast.classList.add('show');
  clearTimeout(toastId);
  toastId=setTimeout(()=>el.toast.classList.remove('show'),1800);
}

function hashString(value){
  let hash=0x811c9dc5;
  for(let i=0;i<value.length;i++){
    hash^=value.charCodeAt(i);
    hash=(hash+(hash<<1)+(hash<<4)+(hash<<7)+(hash<<8)+(hash<<24))>>>0;
  }
  return hash.toString(16);
}

})();
