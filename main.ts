import {readdirSync, readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const input = process.env.MAKEFUN_INPUT_DIR || '/input';
const output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const z = [-1.644854,-0.67449,0,0.67449,1.644854];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lg = p => Math.log(clamp(p,0.01,99.99)/(100-clamp(p,0.01,99.99)));
const logistic = v => 100/(1+Math.exp(-clamp(v,-25,25)));
function forecast(c,i) {
  const obs = c.history.filter(h => Number.isFinite(h.rates[i])).map(h => ({t:Date.parse(h.at), n:h.players_tracked, p:h.rates[i]}));
  if (!obs.length) return z.map(() => 0.01);
  const last = obs[obs.length-1], end = Date.parse(c.target);
  const earliest = end - 14*86400000;
  let points = obs.filter(h => h.t >= Math.max(earliest,last.t-48*3600000));
  // A repeated snapshot is not a new observation; keep the last representative.
  points = points.filter((h,j) => j===points.length-1 || h.n!==points[j+1].n || h.p!==points[j+1].p);
  const x = points.map(h=>Math.log1p(Math.max(0,(h.t-Date.parse(c.game.release_date+'T00:00:00Z'))/3600000)));
  const y = points.map(h=>lg(h.p));
  let slope=0, residual=0;
  if (points.length>=3 && x[x.length-1]-x[0]>0.03) {
    const xm=x.reduce((a,b)=>a+b,0)/x.length, ym=y.reduce((a,b)=>a+b,0)/y.length;
    let xx=0,xy=0; for(let j=0;j<x.length;j++){xx+=(x[j]-xm)**2;xy+=(x[j]-xm)*(y[j]-ym);}
    slope=clamp(xy/(xx+0.2),-1.5,1.5);
    residual=Math.sqrt(y.reduce((a,v,j)=>a+(v-ym-slope*(x[j]-xm))**2,0)/y.length);
  }
  const base=Date.parse(c.game.release_date+'T00:00:00Z');
  const step=Math.max(0,Math.log1p(Math.max(0,(end-base)/3600000))-Math.log1p(Math.max(0,(last.t-base)/3600000)));
  const median=lg(last.p)+slope*step;
  const horizon=Math.max(0,c.horizon_minutes/1440);
  const spread=clamp(0.18+0.22*Math.sqrt(horizon)+residual*0.65,0.18,1.4);
  return z.map(v=>Math.round(logistic(median+v*spread)*10000)/10000);
}
mkdirSync(output,{recursive:true});
for(const file of readdirSync(input).filter(f=>f.endsWith('.in')).sort()) {
 const c=JSON.parse(readFileSync(join(input,file),'utf8'));
 const trophies=c.trophies.map((t,i)=>({id:t.id,q:forecast(c,i)}));
 writeFileSync(join(output,file.slice(0,-3)+'.out'),JSON.stringify({trophies})+'\n');
}

