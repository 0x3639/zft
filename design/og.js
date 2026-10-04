'use strict';
const examples = {
  profiles: {
    'pillar-studies': {title:'Pillar studies',avatar:'assets/pillar.svg',images:['assets/passage.svg','assets/momentum.svg'],titles:['The long way home','First momentum'],description:'Small worlds. Pictures worth passing on.',meta:'2 pieces · 12 followers',label:'Collection'},
    signals: {title:'Signals from NoM',avatar:'assets/signal.svg',images:['assets/signal.svg','assets/pillar.svg'],titles:['A signal, received','Standing still'],description:'Connections, shapes, and quiet signals.',meta:'2 pieces · 9 followers',label:'Collection'},
    'night-shift': {title:'Night shift',avatar:'assets/orbit.svg',images:['assets/orbit.svg','assets/afterhours.svg'],titles:['Close enough to orbit','After hours'],description:'Pictures for the space after the sun goes down.',meta:'2 pieces · 7 followers',label:'Collection'},
  },
  items: {
    momentum: {title:'First momentum',image:'assets/momentum.svg',creator:'Pillar studies'},
    signal: {title:'A signal, received',image:'assets/signal.svg',creator:'Signals from NoM'},
    afterhours: {title:'After hours',image:'assets/afterhours.svg',creator:'Night shift'},
    passage: {title:'The long way home',image:'assets/passage.svg',creator:'Pillar studies'},
    orbit: {title:'Close enough to orbit',image:'assets/orbit.svg',creator:'Night shift'},
    pillar: {title:'Standing still',image:'assets/pillar.svg',creator:'Signals from NoM'},
  },
};
const params=new URLSearchParams(location.search), kind=params.get('kind'), id=params.get('id');
let data;
if(kind==='profile') data=examples.profiles[id]||examples.profiles['pillar-studies'];
else if(kind==='item') {const item=examples.items[id]||examples.items.momentum;data={title:item.title,images:[item.image],titles:[item.title],description:`A collectible by ${item.creator}.`,meta:'Edition of one · ZVM devnet',label:'Collectible'};}
else data={title:'The NFT is the file.',images:['assets/afterhours.svg','assets/momentum.svg'],titles:['After hours','First momentum'],description:'Collect a picture. Send the original file. Pass it on.',meta:'JPG + PNG · built on Zenon',label:'ZFT / pictures with ownership'};
document.title=`${data.title} · ZFT social-card design`;
document.getElementById('social-card').innerHTML=`<div class="og-panel"><div class="og-copy"><div class="og-top">${data.avatar?`<img class="og-avatar" src="${data.avatar}" alt="">`:''}<span class="og-label">${data.label}</span></div><h1>${data.title}</h1><p>${data.description}</p><p class="og-meta">${data.meta}</p><div class="og-brand"><img src="vendor/zenon/assets/znn-logo.svg" alt="">zft.<span>zft.foo / design sample</span></div></div><div class="og-art ${data.images.length===1?'single':''}">${data.images.map((image,i)=>`<div class="og-frame ${i===0?'back':'front'}"><img src="${image}" alt="${data.titles[i]}"><h2>${data.titles[i]}</h2></div>`).join('')}<span class="og-count">${data.images.length===1?'1 of 1':'Sample collection'}</span></div></div>`;
