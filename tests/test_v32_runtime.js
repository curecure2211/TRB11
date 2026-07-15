const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('/mnt/data/trb_v32_work/app/app.js','utf8');
const context = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  URLSearchParams, Map, Set, Date, Math, JSON, Number, String, Array, Object, RegExp, Promise,
  fetch: async () => { throw new Error('not used'); },
  navigator: { onLine: true, serviceWorker: null, geolocation: null },
  location: { hash: '', protocol: 'http:', hostname: 'localhost', port: '8080' },
  document: {
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: { classList: { add(){}, remove(){}, toggle(){} } },
    documentElement: { dataset: {}, classList: { add(){}, remove(){}, toggle(){} } },
    createElement() { return { classList:{add(){},remove(){},toggle(){}}, style:{}, dataset:{}, appendChild(){}, addEventListener(){}, setAttribute(){}}; }
  },
  window: {
    localStorage: { getItem(){return null;}, setItem(){} },
    addEventListener() {},
    matchMedia(){return {matches:false, addEventListener(){}};},
  },
};
context.window.window=context.window;
context.window.document=context.document;
context.globalThis=context;
vm.createContext(context);
vm.runInContext(code, context, {filename:'app.js'});

function stop(id, lat, lng){ return {id,name:id,latitude:lat,longitude:lng}; }
const origin={lat:10.9900,lng:-74.8200,label:'Origen'};
const destination={lat:10.9900,lng:-74.7900,label:'Destino'};
const bus={route:{id:'bus-short',shortName:'B-CORTO',longName:'Bus corto',operator:'Empresa',system:'sibus'},stops:[
 stop('b0',10.9900,-74.8200),stop('b1',10.9900,-74.8150),stop('b2',10.9900,-74.8100)
]};
const metro={route:{id:'tm1',shortName:'T1',longName:'Transmetro',operator:'Transmetro',system:'transmetro'},stops:[
 stop('t0',10.9900,-74.8100),stop('t1',10.9900,-74.8000),stop('t2',10.9900,-74.7900)
]};
const plans=context.findCrossSystemJourneyPlans(origin,destination,[bus],[metro],{
 maxAccessWalk:1000,maxEgressWalk:1000,maxTransferWalk:200,maxTotalWalk:2000,candidateCount:3,resultLimit:5,minRideMeters:200
});
console.log(JSON.stringify(plans.map(p=>({systems:context.planSystems(p),key:context.plannerFilterKey(p),short:p.shortBusConnector,minutes:p.totalMinutes,legs:p.legs.map(l=>l.mode==='bus'?l.route.shortName:l.mode)})),null,2));
if(!plans.length) throw new Error('No mixed plan generated');
if(context.plannerFilterKey(plans[0])!=='combined') throw new Error('Mixed plan not classified combined');
if(!plans[0].shortBusConnector) throw new Error('Short bus connector not detected');
const busPlan={type:'direct',legs:[{mode:'bus',route:bus.route}],totalMinutes:10};
const metroPlan={type:'direct',legs:[{mode:'bus',route:metro.route}],totalMinutes:10};
if(context.plannerFilterKey(busPlan)!=='buses') throw new Error('bus classifier');
if(context.plannerFilterKey(metroPlan)!=='transmetro') throw new Error('metro classifier');
console.log('RUNTIME_OK');
