import { Game } from '../../../public/apps/skyrise/js/game.js';
const NS = +process.argv[2] || 4, NC = +process.argv[3] || 4;
const g = new Game(7); g.funds = 2e7;
for (let x = 160; x < 240; x += 4) g.build('lobby', x, 0);
for (let L = 1; L <= 8; L++) for (let i = 0; i < 8; i++) g.build('office', 160 + i * 9, L);
for (let L = 9; L <= 11; L++) for (let i = 0; i < 4; i++) g.build('condo', 160 + i * 16, L);
for (let i=0;i<3;i++) g.build('fastfood', 160+i*16, 12);
for (let k=0;k<NS;k++){ const r=g.buildTransport('elevator', 166+k*12, 0, 12); for(let c=1;c<NC;c++) g.addCar(r.o.id, c*3); }
let gave=0; const orig=g.gaveUp.bind(g); g.gaveUp=(p)=>{gave++; orig(p);};
for (let day = 0; day < 9; day++) {
  let maxQ=0, samples=[];
  for (let i = 0; i < 2600; i++) { g.step(); for (const sh of g.shafts()) maxQ=Math.max(maxQ, sh.totalWaiting());
    if (g.t%2600===2299) for (const f of g.tower.facs.values()) if (f.type==='office'&&f.occupied&&f.sN) samples.push(f.sSum/f.sN); }
  samples.sort((a,b)=>a-b);
  const occ = [...g.tower.facs.values()].filter(f => f.occupied).length;
  console.log(`day ${g.dateDay} star=${g.star} pop=${g.pop.total} occ=${occ} funds=${g.funds} maxQ=${maxQ} gaveUp=${gave} officeTripStress med=${(samples[samples.length>>1]||0).toFixed(0)} max=${(samples.at(-1)||0).toFixed(0)}`);
  gave=0;
}
