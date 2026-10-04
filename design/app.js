/* Review prototype only. No wallet, secret generation, RPC calls, or live operations.
 * Lucide path data follows the MIT-licensed Zenon UI kit; see vendor/zenon/LICENSE.
 */
'use strict';
const icons = {
  plus: '<path d="M5 12h14M12 5v14"/>',
  layers: '<path d="m12 3-10 5 10 5 10-5-10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  arrow: '<path d="M7 7h10v10M7 17 17 7"/>',
  arrowRight: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  shield: '<path d="M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4Z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m12 11 9-9m-4 4 3 3m-6 0 3 3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.7-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.7 6.3L3 16M3 21v-5h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2m-4.9-7.1 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4"/>',
  moon: '<path d="M20.9 13a9 9 0 1 1-9.9-9.9A7 7 0 0 0 20.9 13Z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  zap: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7v.01"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const assets = [
  {id:'momentum',title:'First momentum',creator:'Pillar studies',profile:'pillar-studies',image:'assets/momentum.svg',description:'A quiet landscape, just before the next momentum.',owned:true,state:'owned',epoch:0,public:true},
  {id:'signal',title:'A signal, received',creator:'Signals from NoM',profile:'signals',image:'assets/signal.svg',description:'Finding a connection in the space between points.',owned:true,state:'owned',epoch:2,public:true},
  {id:'afterhours',title:'After hours',creator:'Night shift',profile:'night-shift',image:'assets/afterhours.svg',description:'A little doorway into the part of the day that belongs to you.',owned:false,state:'public',epoch:1,public:true},
  {id:'passage',title:'The long way home',creator:'Pillar studies',profile:'pillar-studies',image:'assets/passage.svg',description:'One more door. One more possibility.',owned:false,state:'public',epoch:0,public:true},
  {id:'orbit',title:'Close enough to orbit',creator:'Night shift',profile:'night-shift',image:'assets/orbit.svg',description:'Some things find their way back.',owned:false,state:'public',epoch:1,public:true},
  {id:'pillar',title:'Standing still',creator:'Signals from NoM',profile:'signals',image:'assets/pillar.svg',description:'A small monument to the work that keeps a network moving.',owned:false,state:'public',epoch:0,public:true},
];
const profiles = [
  {id:'pillar-studies',name:'Pillar studies',image:'assets/passage.svg',avatar:'assets/pillar.svg',bio:'Small worlds. Open doors. Pictures worth passing on.',followers:12,following:3,likes:8,sent:1},
  {id:'signals',name:'Signals from NoM',image:'assets/signal.svg',avatar:'assets/signal.svg',bio:'A collection of connections, shapes, and quiet signals.',followers:9,following:4,likes:6,sent:2},
  {id:'night-shift',name:'Night shift',image:'assets/afterhours.svg',avatar:'assets/orbit.svg',bio:'Pictures for the space after the sun goes down.',followers:7,following:2,likes:5,sent:1},
];
const activity = [
  {art:'momentum',text:'Pillar studies minted First momentum',kind:'Minted',time:'Sample'},
  {art:'signal',text:'You collected A signal, received',kind:'Claimed',time:'Sample'},
  {art:'afterhours',text:'Night shift minted After hours',kind:'Minted',time:'Sample'},
  {art:'passage',text:'Pillar studies shared The long way home',kind:'Shared',time:'Sample'},
];
const state = {filter:'owned',profileTab:'collection',backupReady:false,backupCurrent:false,backupDownloaded:false,following:new Set(),liked:new Set(),mintImage:null,mintName:'',mintDescription:'',mintPublic:false,returnAfterBackup:null,claimReady:false,claimStale:false,importPreview:null};
const main = document.getElementById('main');
const dialog = document.getElementById('flow-dialog');
const content = document.getElementById('dialog-content');
let toastTimer;

function button(label, action, variant='primary', attrs='') {
  return `<button class="nom-btn nom-btn--${variant} nom-btn--default" data-action="${action}" ${attrs}>${label}</button>`;
}
function badge(text, kind='outline') { return `<span class="nom-badge nom-badge--${kind}">${text}</span>`; }
function status(asset) {
  if(asset.state==='exported') return badge('Sample · exported','warning');
  if(asset.state==='sent') return badge('Sample · sent','pending');
  return badge(asset.owned?'Sample · owned':'Sample collectible',asset.owned?'success':'outline');
}
function card(asset, profileId=null) {
  const href=typeof profileId==='string'?`#p/${esc(profileId)}?nft=${esc(asset.id)}`:`#item/${esc(asset.id)}`;
  return `<a class="nom-card art-card" href="${href}"><div class="art-image"><img src="${esc(asset.image)}" alt="${esc(asset.title)}" loading="lazy"><span class="art-label">Design sample</span></div><div class="art-copy"><h3>${esc(asset.title)}</h3><p>${esc(asset.creator)}</p><div class="art-bottom">${status(asset)}<span class="mono">1 of 1</span></div></div></a>`;
}
function activityRows() {
  return `<ul class="activity-list">${activity.map(a=>{const art=assets.find(x=>x.id===a.art)||assets[0];return `<li class="activity-row"><img src="${esc(art.image)}" alt=""><div><p>${esc(a.text)}</p><small>${esc(a.kind)} · simulated activity</small></div><span class="mono">${esc(a.time)}</span></li>`;}).join('')}</ul>`;
}
function previewCard(asset, cls) {
  return `<div class="preview-card ${cls}"><img src="${asset.image}" alt="${asset.title}, illustrative preview"><span class="art-label">Preview</span><h3>${asset.title}</h3><div class="caption">${badge('Sample collectible','success')}<span class="mono">1 of 1</span></div></div>`;
}
function home() {
  return `<div class="page"><section class="nom-card hero"><div class="hero-copy"><div class="eyebrow">${badge(`${icon('zap')} Free minting, sponsored on devnet`,'success')}</div><h1>The NFT<br>is the <span>file.</span></h1><p>Turn a picture into a collectible. Its transfer key travels inside the file. Pass it on, and let someone new claim it.</p><div class="actions">${button(`${icon('plus')} Start a collection`,'mint','primary','class-extra="hero"')}<a class="nom-btn nom-btn--outline nom-btn--lg" href="#about">How it works</a></div><button class="text-button subtle-link" data-action="recovery">Already collecting? Restore your collection</button></div><div class="hero-art" aria-label="Illustrative collectible cards">${previewCard(assets[2],'back')}${previewCard(assets[0],'front')}<span class="floating-label">${icon('image')} Send the original file</span></div></section><div class="ticker"><span>${icon('image')} JPG + PNG</span><span>${icon('key')} Your keys, your collection</span><span>${icon('refresh')} First claim wins</span><span>${icon('layers')} Built on Zenon</span></div><section class="section"><div class="section-heading"><h2>Popular collections</h2><a href="#gallery">Explore all ${icon('arrowRight')}</a></div><div class="collections-grid">${profiles.map((p,i)=>`<a class="nom-card collection-row" href="#p/${p.id}"><span class="rank mono">0${i+1}</span><img src="${p.avatar}" alt=""><div><h3>${p.name}</h3><p><span class="mono">2</span> sample pieces · collection</p></div><span class="arrow">${icon('arrow')}</span></a>`).join('')}</div></section><section class="section"><div class="section-heading"><h2>Fresh mints</h2><a href="#gallery">Browse all ${icon('arrowRight')}</a></div><div class="art-grid">${assets.filter(a=>a.public).map(card).join('')}</div></section><section class="section two-column"><div><div class="section-heading"><h2>Happening now</h2><a href="#activity">All activity ${icon('arrowRight')}</a></div>${activityRows()}</div><div class="feature-list"><div class="feature"><span class="feature-icon">${icon('image')}</span><div><h3>Drop a picture. Make it collectible.</h3><p>A photo, a drawing, a moment. Start with something you want to keep.</p></div></div><div class="feature"><span class="feature-icon">${icon('share')}</span><div><h3>Send it like a picture</h3><p>Share the original file. Whoever claims it first becomes the new owner.</p></div></div><div class="feature"><span class="feature-icon">${icon('layers')}</span><div><h3>A collection with your name on it</h3><p>Show your pictures on a public page, or keep your collection local.</p></div></div><div class="feature"><span class="feature-icon">${icon('shield')}</span><div><h3>Ownership you can check</h3><p>Zenon’s ZVM records each claim. Your collectible keys stay with you.</p></div></div></div></section><section class="bottom-cta"><div><h2>One picture is all it takes.</h2><p>Your next collectible might already be on your camera roll.</p></div>${button(`${icon('plus')} Start a collection`,'mint')}</section></div>`;
}
function collection() {
  const filtered=assets.filter(a=>a.owned && (state.filter==='owned'?a.state==='owned':a.state===state.filter));
  return `<div class="page"><div class="page-top"><span class="text-ledger">Your local collection</span><h1>A few things worth keeping.</h1><p>Your pictures, your transfer keys. This preview starts with two sample collectibles.</p></div><div class="nom-card backup-strip">${icon('shield')}<span>${state.backupCurrent?'Sample backup is current.':'Your newest keys need a recovery snapshot.'}</span>${button('Review backup','recovery','outline')}</div><div class="collection-toolbar"><div class="tabs" role="group" aria-label="Collection filter">${['owned','exported','sent'].map(f=>`<button data-action="filter" data-value="${f}" aria-pressed="${state.filter===f}">${f[0].toUpperCase()+f.slice(1)}</button>`).join('')}</div><div class="actions">${button(`${icon('upload')} Import a collectible`,'import','outline')}${button(`${icon('plus')} Mint a picture`,'mint')}</div></div>${filtered.length?`<div class="art-grid">${filtered.map(card).join('')}</div>`:`<div class="nom-card empty-state"><h2>${state.filter==='exported'?'Nothing is out in the world yet.':state.filter==='sent'?'No pictures passed on yet.':'Your collection starts with one picture.'}</h2><p>Mint a picture or import an original collectible file.</p>${button('Import a collectible','import','outline')}</div>`}</div>`;
}
function item(id) {
  const art=assets.find(a=>a.id===id);
  if(!art) return `<div class="page"><h1>Picture not found</h1><a href="#explore">Back to explore</a></div>`;
  return `<div class="page"><a class="link-inline" href="#${art.owned?'collection':'gallery'}">Back to ${art.owned?'my collection':'explore'}</a><div class="item-layout"><img class="item-main-art" src="${esc(art.image)}" alt="${esc(art.title)}"><div class="item-info"><span class="text-ledger">Design sample / edition of one</span><h1>${esc(art.title)}</h1><p>Created by <a class="link-inline" href="#p/${esc(art.profile)}">${esc(art.creator)}</a></p><p>${esc(art.description)}</p>${status(art)}<div class="actions">${art.owned && art.state!=='sent'?button(`${icon('share')} Send this picture`,'export','primary',`data-id="${esc(art.id)}"`):button(`${icon('download')} Save public preview`,'public-preview','outline',`data-id="${esc(art.id)}"`)}${button(`${icon('share')} Share page`,'share','outline',`data-kind="item" data-id="${esc(art.id)}"`)}</div>${art.state==='exported'?`<div class="notice"><strong>Exported · still yours until claimed.</strong><br>Anyone holding the original file can claim it. ${button('Cancel exported copies','cancel','outline',`data-id="${art.id}"`)}</div>`:''}<details class="details"><summary>Proof & details</summary><div class="detail-row"><span>Network</span><span class="mono">ZVM devnet · 7340469</span></div><div class="detail-row"><span>Ownership epoch</span><span class="mono">${art.epoch} · simulated</span></div><div class="detail-row"><span>Contract</span><span>Not deployed</span></div><div class="detail-row"><span>Verification</span><span>Design sample · no live proof</span></div><a class="link-inline" href="https://devnet.zenon.foo/explorer/" target="_blank" rel="noopener noreferrer">Open ZVM explorer ${icon('external')}</a></details><div class="notice">A public preview contains no transfer key. It is safe to share; it cannot transfer this collectible.</div></div></div></div>`;
}
function getProfile(id) {
  return id==='you'?{id:'you',name:'Your collection',image:'assets/momentum.svg',avatar:'assets/pillar.svg',bio:'Pictures worth keeping and passing on.',followers:0,following:0,likes:0,sent:0}:profiles.find(p=>p.id===id);
}
function profile(id) {
  const p=getProfile(id);
  if(!p)return `<div class="page"><h1>Collection not found</h1><a href="#explore">Back to explore</a></div>`;
  const pieces=assets.filter(a=>a.profile===p.id && a.public);
  const followed=state.following.has(p.id), liked=state.liked.has(p.id);
  const selected=state.profileTab==='sent'?pieces.slice(0,1).map(a=>({...a,owned:false,state:'sent'})):pieces;
  return `<div class="page"><section class="nom-card profile-panel"><img class="profile-cover" src="${p.image}" alt="${p.name} collection cover"><div class="profile-header"><img class="profile-avatar" src="${p.avatar}" alt="${p.name} avatar"><div class="profile-name"><h1>${p.name}</h1><button class="text-button mono" data-action="copy-profile" data-id="${p.id}">${p.id} · sample profile ${icon('copy')}</button><p>${p.bio}</p></div><div class="actions">${button(`${icon('heart')} ${p.likes+(liked?1:0)}`,'like','outline',`data-id="${p.id}" aria-pressed="${liked}"`)}${button(`${icon('user')} ${followed?'Following':'Follow'}`,'follow',followed?'outline':'primary',`data-id="${p.id}" aria-pressed="${followed}"`)}${button(`${icon('share')} Share`,'share','outline',`data-kind="profile" data-id="${p.id}"`)}${button(`${icon('key')} Unlock`,'recovery','ghost')}</div></div><div class="profile-stats">${[[pieces.length,'Collected'],[p.sent,'Sent'],[p.likes+(liked?1:0),'Likes'],[p.followers+(followed?1:0),'Followers'],[p.following,'Following']].map(([v,k])=>`<div><span class="mono">${v}</span><span>${k}</span></div>`).join('')}</div></section><div class="collection-toolbar"><div class="tabs" role="group" aria-label="Profile sections">${['collection','sent','activity'].map(t=>`<button data-action="profile-tab" data-value="${t}" aria-pressed="${state.profileTab===t}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div>${button(`${icon('refresh')} Re-check ownership`,'recheck','outline')}</div><p class="scope-note">Sample profile · follows, likes, and ownership are simulated for design review.</p>${state.profileTab==='activity'?activityRows():`<div class="art-grid">${selected.map(a=>card(a,p.id)).join('')}</div>`}</div>`;
}
function publicItemModal(id) {
  const art=assets.find(a=>a.id===id);if(!art)return;
  modal(esc(art.title),`<img class="public-detail-art" src="${esc(art.image)}" alt="${esc(art.title)}"><div class="actions" style="margin-top:18px">${badge('Public picture · design sample','success')}${button(`${icon('refresh')} View proof`,'public-proof','outline',`data-id="${esc(id)}"`)}</div><p style="margin-top:18px">By ${esc(art.creator)}. ${esc(art.description)}</p><ul class="check-list"><li>${icon('check')} Image identity · simulated check</li><li>${icon('check')} Collector possession · simulated check</li><li>${icon('info')} Current ownership · not checked on-chain in this preview</li></ul><div class="notice">Public images and proofs contain no transfer credential.</div>`,`<span>Profile artwork · public view</span><div class="actions">${button('Save image sample','public-preview','outline',`data-id="${esc(id)}"`)}${button('Share artwork','share','primary',`data-kind="item" data-id="${esc(id)}"`)}</div>`);
}
function market() {
  return `<div class="page"><div class="page-top"><span class="text-ledger">Market / planned expansion</span><h1>Find your next favorite.</h1><p>The reference marketplace layout, in the Zenon theme. Listing and purchase integration follows the collectible-transfer beta.</p></div><div class="notice"><strong>Design samples only.</strong> These are example prices, not live listings. Trading will use a verified exchange and non-exported wallet custody.</div><div class="art-grid">${assets.filter(a=>a.public).slice(0,6).map((a,i)=>`<article class="nom-card art-card"><a href="#item/${a.id}"><div class="art-image"><img src="${a.image}" alt="${esc(a.title)}"><span class="art-label">Sample listing</span></div><div class="art-copy"><h3>${esc(a.title)}</h3><p>${esc(a.creator)}</p><div class="art-bottom"><span class="mono">${i+1}.00 ZNN</span><span>Example price</span></div></div></a><div class="market-action">${button('Review purchase flow','market-flow','outline',`data-id="${a.id}"`)}</div></article>`).join('')}</div></div>`;
}
function about() {
  return `<div class="page"><div class="page-top"><span class="text-ledger">How it works</span><h1>Keep the picture.<br>Pass on the collectible.</h1><p>A ZFT file is a picture with a disposable ownership key inside. Claiming rotates that key on Zenon’s ZVM.</p></div><div class="about-grid">${[['01','Start with a picture','Mint a JPG or PNG. Its canonical bytes identify the collectible. Keep it locally or publish it in a collection.'],['02','Your file can transfer ownership','Export the original picture with its item key. Copies are transferable only while that key is current.'],['03','First claim wins','The recipient claims into a fresh key. After confirmation, every earlier copy becomes stale. The sender can race to cancel before that happens.'],['04','Save your recovery snapshot','Keys stay in your browser. Save an updated secret backup after each new item key. Your old snapshot cannot restore keys acquired later.']].map(([n,t,p])=>`<article class="nom-card about-card"><span class="mono">${n}</span><h2>${t}</h2><p>${p}</p></article>`).join('')}</div><div class="notice"><strong>Public by design in v1.</strong> Ownership transitions are visible on-chain. Sponsored operations have limits. This proposal does not reproduce Cashu’s private blind-signature protocol.</div><div class="actions">${button('Mint a picture','mint')}${button('Import a collectible','import','outline')}</div></div>`;
}
function render() {
  const [path,query]=location.hash.slice(1).split('?'),[route,id]=path.split('/');
  const selectedItem=new URLSearchParams(query||'').get('nft');
  let page;
  if(route==='collection') page=collection();
  else if(route==='item') page=item(id);
  else if(route==='p') page=profile(id);
  else if(route==='about') page=about();
  else if(route==='market') page=market();
  else if(route==='gallery') page=`<div class="page"><div class="page-top"><span class="text-ledger">Explore / sample gallery</span><h1>A picture for every kind of person.</h1><p>Discover collections and the pictures people want to pass on.</p></div><div class="art-grid">${assets.filter(a=>a.public).map(card).join('')}</div></div>`;
  else if(route==='activity') page=`<div class="page"><div class="page-top"><span class="text-ledger">Public activity / sample data</span><h1>Pictures on the move.</h1><p>Mints and ownership transitions, ordered by Zenon. These entries are design samples.</p></div>${activityRows()}</div>`;
  else page=home();
  main.innerHTML=page;
  document.querySelectorAll('[data-nav]').forEach(a=>a.setAttribute('aria-current',a.dataset.nav===(route||'explore')?'page':'false'));
  hydrateIcons();
  document.title=route==='p'?`${getProfile(id)?.name||'Collection not found'} · ZFT preview`:route==='item'?`${assets.find(a=>a.id===id)?.title||'Picture'} · ZFT preview`:'ZFT · The NFT is the file';
  if(route==='p'&&selectedItem)publicItemModal(selectedItem);
}
function hydrateIcons() { document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon)); }
function toast(message) {
  const el=document.getElementById('toast'); el.textContent=message; el.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.hidden=true,4500);
}
function modal(title, body, footer='', label='ZVM devnet / simulated flow') {
  content.innerHTML=`<div class="dialog-head"><div><span class="text-ledger">${label}</span><h2 id="dialog-title">${title}</h2></div><button class="nom-btn nom-btn--ghost nom-btn--icon" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;
  if(!dialog.open) dialog.showModal();
  content.querySelector('[data-action="close"]').focus();
}
function mintModal() {
  modal('Make a picture collectible.',`<p>Choose a JPG or PNG, give it a name, and keep it in your collection.</p>${state.mintImage?`<div class="upload-preview"><img src="${esc(state.mintImage)}" alt="Your local preview"><div><h3>Picture selected</h3><p>Local preview only. Canonicalization is part of implementation.</p>${button('Choose another','pick-mint','outline')}</div></div>`:`<button class="dropzone" data-action="pick-mint">${icon('upload')}<strong>Choose a picture</strong><span>JPG or PNG · up to 10 MB · stays in this preview</span></button><button class="text-button subtle-link" data-action="sample-mint">Or use a sample picture</button>`}<input type="file" id="mint-file" accept="image/jpeg,image/png" hidden><label class="field"><span>Title</span><input class="nom-input" id="mint-title" maxlength="100" placeholder="Something worth keeping" value="${esc(state.mintName)}"></label><label class="field"><span>Description <span class="muted">(optional)</span></span><textarea class="nom-input" id="mint-description" maxlength="500" placeholder="Tell the story behind the picture.">${esc(state.mintDescription)}</textarea></label><label class="check-row"><input id="mint-public" type="checkbox" ${state.mintPublic?'checked':''}><span>Show on my public collection<small>Off by default. Public previews never carry your transfer key.</small></span></label>${!state.backupReady?'<div class="notice">Save a recovery snapshot before your first mint. This preview will walk you through the backup step.</div>':''}`,`<span>${icon('zap')} Sponsored on devnet · simulation</span>${button(state.backupReady?'Simulate mint':'Review recovery first',state.backupReady?'mint-submit':'mint-backup','primary',state.mintImage?'':'disabled')}`);
}
function recoveryModal() {
  state.backupDownloaded=false;
  modal('Keep a recovery snapshot.',`<p>Your collection lives in your browser. A secret snapshot restores the keys it contains. Save a new one after collecting another picture.</p><div class="notice"><strong>Keep the real backup private.</strong> Anyone holding it can recover your collection. An older snapshot cannot restore keys created later.</div><div class="check-list"><div>${badge(state.backupCurrent?'Sample backup current':'Sample backup needs updating',state.backupCurrent?'success':'warning')}</div></div>${button(`${icon('download')} Download a design sample`,'download-backup','outline')}<p class="scope-note" style="margin-top:12px">The downloaded .txt is a design sample, not a real recovery bundle. This preview does not generate or request secrets.</p><label class="check-row"><input id="backup-ack" type="checkbox"><span>I saved the sample and understand that a real backup must be kept private.</span></label><button class="text-button" data-action="restore-preview">Review the restore flow</button>`,`<span>Local recovery · design only</span>${button('Continue','backup-confirm','primary','disabled')}`);
}
function importModal() {
  state.claimReady=false;
  modal('Import an original picture.',`<p>Open the JPG or PNG someone sent you. In the live app, the transfer key is read locally and checked against the chain.</p><button class="dropzone" data-action="pick-import">${icon('upload')}<strong>Choose a picture to preview</strong><span>This design preview does not validate real ZFT files.</span></button><input type="file" id="import-file" accept="image/jpeg,image/png" hidden>${state.importPreview?`<img class="local-preview" src="${esc(state.importPreview)}" alt="Locally selected picture"><div class="notice">Local image preview only. No credential or ownership has been verified.</div>`:''}<div class="notice">Use the sample scenario below to review claim and stale-file states.</div><div class="actions">${button('Load sample collectible','sample-import','outline')}${button('Show already-claimed state','stale-import','ghost')}</div>`);
}
function claimModal(stale=false) {
  state.claimStale=stale;
  if(stale) {
    modal('This copy is no longer current.',`<div class="status-large error"><div class="status-symbol">${icon('lock')}</div><h3>Already claimed or canceled</h3><p>The picture is still viewable, but its old transfer key cannot claim the collectible.</p></div><p class="scope-note">Simulated stale-file result. No network lookup was performed.</p>`,`<span>Ask for the current original file.</span>${button('Try another','import','outline')}`); return;
  }
  state.claimReady=true;
  modal('A picture is waiting for you.',`<div class="flow-summary"><img src="assets/afterhours.svg" alt="After hours, sample picture"><div><h3>After hours</h3><p>By Night shift · sample collectible</p></div></div><ul class="check-list"><li>${icon('check')} Picture matches · simulated</li><li>${icon('check')} Transfer key is current · simulated</li><li>${icon('check')} New recipient key saved · simulated</li></ul><div class="notice">Claim into your collection. After confirmation, older copies of this file cannot claim it.</div>${!state.backupReady?'<p>Review recovery before your first claim.</p>':''}`,`<span>First valid claim wins · simulation</span>${button(state.backupReady?'Simulate claim':'Review recovery first',state.backupReady?'claim-submit':'claim-backup')}`);
}
function exportModal(id) {
  const art=assets.find(a=>a.id===id);
  if(!art?.owned || art.state==='sent') return toast('This sample is no longer in your collection.');
  modal('Pass this picture on.',`<div class="flow-summary"><img src="${esc(art.image)}" alt="${esc(art.title)}"><div><h3>${esc(art.title)}</h3><p>Sample epoch <span class="mono">${art.epoch}</span></p></div></div><p>The live app exports a JPG or PNG with this item’s disposable transfer key inside.</p><div class="notice"><strong>Whoever claims the file first gets the collectible.</strong><br>You still own it until a claim or cancellation confirms. Send the original file as an attachment.</div><p class="scope-note">This prototype downloads a clearly labeled .txt sample. It contains no key and cannot transfer anything.</p>`,`<span>File export · no transaction</span>${button(`${icon('download')} Download design sample`,'export-download','primary',`data-id="${esc(id)}"`)}`);
}
function cancelModal(id) {
  modal('Cancel exported copies?',`<p>A new ownership key makes every earlier export stale. If someone else claims first, their claim wins.</p><div class="notice">Cancellation is an on-chain rotation in the live app. This button simulates the resulting state.</div>`,`<span>Sponsored devnet operation · simulation</span>${button('Simulate cancellation','cancel-submit','primary',`data-id="${esc(id)}"`)}`);
}
function operation(title, onComplete) {
  modal(title,`<div class="status-large"><div class="status-symbol">${icon('refresh')}</div><h3 id="operation-label">Submitted · simulation</h3><p>No blockchain transaction is being sent.</p></div><div class="progress-steps"><span class="active">Submitted</span><span>Included</span><span>Confirmed</span></div>`);
  document.getElementById('announcements').textContent='Simulated operation submitted';
  setTimeout(()=>{if(document.getElementById('operation-label'))document.getElementById('operation-label').textContent='Included · simulated confirmation';},650);
  setTimeout(()=>{
    onComplete(); state.backupCurrent=false; render();
    modal('Ready for your collection.',`<div class="status-large"><div class="status-symbol">${icon('check')}</div><h3>Simulation complete</h3><p>Your sample collection has been updated. Save an updated recovery snapshot after a real new key.</p></div>`,`<span>Design preview · no live transaction</span>${button('View my collection','view-collection')}`);
    document.getElementById('announcements').textContent='Simulation complete';
  },1450);
}
function downloadSample(filename, text) {
  const blob=new Blob([`ZFT DESIGN PREVIEW\nNOT A REAL CREDENTIAL OR RECOVERY BUNDLE\n\n${text}\n\nNo secrets or transferable ownership are contained in this file.\n`],{type:'text/plain'});
  const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download=filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function shareModal(kind,id) {
  const title=kind==='profile'?getProfile(id)?.name:assets.find(a=>a.id===id)?.title;
  modal('A page worth sharing.',`<p>A public page and its social preview never contain a transfer key.</p><div class="share-card"><span class="text-ledger">Social preview / 1200 × 630</span><h3>${esc(title||'ZFT')}</h3><p>${kind==='profile'?'A collection of pictures worth passing on.':'A one-of-one collectible on Zenon’s ZVM.'}</p></div><p class="scope-note">Implementation will generate a unique cached image for this page. Review the proposed templates below.</p><a class="link-inline" href="og-preview.html?kind=${kind}&id=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">Open this social-card design ${icon('external')}</a>`,`<span>Public preview · safe to share</span>${button('Copy preview link','copy-share','outline',`data-kind="${kind}" data-id="${esc(id)}"`)}`);
}

document.addEventListener('click', async event=>{
  const target=event.target.closest('[data-action]'); if(!target)return;
  const action=target.dataset.action, id=target.dataset.id;
  if(action==='close'){dialog.close();if(location.hash.includes('?nft='))location.hash=location.hash.split('?')[0];}
  else if(action==='mint')mintModal();
  else if(action==='recovery')recoveryModal();
  else if(action==='import')importModal();
  else if(action==='filter'){state.filter=target.dataset.value;render();}
  else if(action==='profile-tab'){state.profileTab=target.dataset.value;render();}
  else if(action==='sample-mint'){state.mintImage='assets/momentum.svg';state.mintName='My first momentum';mintModal();}
  else if(action==='pick-mint')document.getElementById('mint-file').click();
  else if(action==='pick-import')document.getElementById('import-file').click();
  else if(action==='sample-import')claimModal();
  else if(action==='stale-import')claimModal(true);
  else if(action==='mint-backup'){state.mintName=document.getElementById('mint-title').value;state.returnAfterBackup='mint';recoveryModal();}
  else if(action==='claim-backup'){state.returnAfterBackup='claim';recoveryModal();}
  else if(action==='download-backup'){downloadSample('zft-recovery-design-sample.txt','Recovery screen sample only. A real backup will contain an encrypted key snapshot and must stay private.');state.backupDownloaded=true;content.querySelector('[data-action="backup-confirm"]').disabled=!document.getElementById('backup-ack').checked;document.getElementById('backup-ack').focus();}
  else if(action==='backup-confirm'){
    if(!state.backupDownloaded||!document.getElementById('backup-ack').checked)return;
    state.backupReady=true;state.backupCurrent=true;const next=state.returnAfterBackup;state.returnAfterBackup=null;
    if(next==='mint')mintModal();else if(next==='claim')claimModal();else{dialog.close();render();toast('Sample recovery step completed.');}
  }
  else if(action==='restore-preview')modal('Restore your collection.',`<p>The live app will let you open your secret recovery snapshot locally. It restores only the keys included when you saved it.</p><div class="notice">This design preview has no real vault. Never paste or upload a real recovery key here.</div>`,`<span>Local recovery · design only</span>${button('Back to recovery','recovery','outline')}`);
  else if(action==='mint-submit'){
    if(!state.backupReady||!state.mintImage)return;
    const title=document.getElementById('mint-title').value.trim(); if(!title){document.getElementById('mint-title').focus();return toast('Give your sample picture a title.');}
    const description=document.getElementById('mint-description').value.trim(), published=document.getElementById('mint-public').checked, image=state.mintImage;
    operation('Minting your sample picture.',()=>{const newId=`sample-${Date.now()}`;assets.unshift({id:newId,title,description,image,creator:'Your collection',profile:'you',owned:true,state:'owned',epoch:0,public:published});activity.unshift({art:newId,text:`You minted ${title}`,kind:'Minted',time:'Sample'});state.mintImage=null;state.mintName='';state.mintDescription='';state.mintPublic=false;});
  }
  else if(action==='claim-submit'){
    if(!state.backupReady||!state.claimReady||state.claimStale)return;
    state.claimReady=false;operation('Claiming your sample collectible.',()=>{const art=assets.find(a=>a.id==='afterhours');art.owned=true;art.state='owned';art.epoch+=1;activity.unshift({art:art.id,text:'You collected After hours',kind:'Claimed',time:'Sample'});});
  }
  else if(action==='export')exportModal(id);
  else if(action==='export-download'){
    const art=assets.find(a=>a.id===id);if(!art?.owned||art.state==='sent')return;
    downloadSample('zft-export-design-sample.txt',`Title: ${art.title}\nIn the live app, this action creates an original image with a disposable item key. First valid claim wins.`);art.state='exported';render();dialog.close();toast('Sample exported. Still yours until a simulated claim or cancel.');
  }
  else if(action==='cancel')cancelModal(id);
  else if(action==='cancel-submit')operation('Canceling sample exports.',()=>{const art=assets.find(a=>a.id===id);art.state='owned';art.epoch+=1;});
  else if(action==='view-collection'){dialog.close();state.filter='owned';location.hash='collection';render();}
  else if(action==='public-preview'){downloadSample('zft-public-image-design-sample.txt',`Public image download design for ${assets.find(a=>a.id===id)?.title||'this picture'}. The live app downloads sanitized image bytes, without any transfer key.`);toast('Downloaded a public-image design sample, without any transfer key.');}
  else if(action==='public-proof'){downloadSample('zft-public-proof-design-sample.txt',`Public proof screen for ${assets.find(a=>a.id===id)?.title||'this picture'}. A real proof includes public chain/deployment, hashes, owner epoch, and a non-secret possession attestation. This file proves nothing cryptographically.`);toast('Downloaded a proof design sample. No transfer credential is included.');}
  else if(action==='market-flow')modal('Purchase a collectible.',`<p>Planned flow: connect a non-exported wallet, review the price and fees, simulate the verified exchange purchase, then wait for confirmation.</p><div class="notice">Sale proceeds must never go to a key exposed in an exported picture. Trading custody and file custody are separate.</div><p class="scope-note">No wallet connection or purchase is implemented in this proposal.</p>`,`<span>Marketplace expansion · design only</span>${button('View artwork','market-view','outline',`data-id="${esc(id)}"`)}`);
  else if(action==='market-view'){dialog.close();location.hash=`item/${id}`;}
  else if(action==='follow'){state.following.has(id)?state.following.delete(id):state.following.add(id);render();toast('Follow state updated for this design preview.');}
  else if(action==='like'){state.liked.has(id)?state.liked.delete(id):state.liked.add(id);render();}
  else if(action==='recheck')toast('Design sample: no live ownership lookup is performed.');
  else if(action==='share')shareModal(target.dataset.kind,id);
  else if(action==='copy-profile'){try{await navigator.clipboard.writeText(id);toast('Copied the sample profile identifier.');}catch{toast(`Sample profile identifier: ${id}`);}}
  else if(action==='copy-share'){
    const url=new URL(location.href);url.hash=target.dataset.kind==='profile'?`p/${id}`:`item/${id}`;
    try{await navigator.clipboard.writeText(url.href);toast('Copied this local design-preview link.');}catch{toast('Copy the page URL from your browser to share this preview.');}
  }
});
document.addEventListener('input', event=>{
  if(event.target.id==='mint-title')state.mintName=event.target.value;
  if(event.target.id==='mint-description')state.mintDescription=event.target.value;
  if(event.target.id==='mint-public')state.mintPublic=event.target.checked;
});
dialog.addEventListener('close',()=>{state.returnAfterBackup=null;if(location.hash.includes('?nft='))location.hash=location.hash.split('?')[0];});
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();main.focus();main.scrollIntoView();});
document.addEventListener('change', event=>{
  if(event.target.id==='backup-ack'){const submit=content.querySelector('[data-action="backup-confirm"]');if(submit)submit.disabled=!(event.target.checked&&state.backupDownloaded);}
  if(!['mint-file','import-file'].includes(event.target.id))return;
  const file=event.target.files?.[0];if(!file)return;
  if(!['image/jpeg','image/png'].includes(file.type)||file.size>10*1024*1024)return toast('Choose a JPG or PNG under 10 MB.');
  const url=URL.createObjectURL(file);
  if(event.target.id==='mint-file'){if(state.mintImage?.startsWith('blob:'))URL.revokeObjectURL(state.mintImage);state.mintImage=url;state.mintName=file.name.replace(/\.[^.]+$/,'');mintModal();}
  else {if(state.importPreview)URL.revokeObjectURL(state.importPreview);state.importPreview=url;importModal();}
});
document.getElementById('theme-toggle').addEventListener('click',()=>{
  const dark=document.documentElement.classList.toggle('dark');
  const btn=document.getElementById('theme-toggle');btn.setAttribute('aria-label',`Switch to ${dark?'light':'dark'} theme`);btn.innerHTML=icon(dark?'sun':'moon');
});
window.addEventListener('hashchange',()=>{state.profileTab='collection';render();window.scrollTo(0,0);});
render();
