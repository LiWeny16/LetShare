import{n as e}from"./chunk-Y2CYZVJY-DsF7k-Jl.js";import{m as t}from"./src-Cl1eMkr3.js";import{H as n,K as r,U as i,a,c as o,f as s,v as c,w as l,x as u,y as d}from"./chunk-DU6HZSFF-D46Do5s6.js";import{t as f}from"./ordinal-BDEzSJ7C.js";import{n as p}from"./path-fybaL0A-.js";import{m}from"./dist-DuXNC_pq.js";import{t as h}from"./arc-rszGDPJG.js";import{t as g}from"./array-BifhSqXX.js";import{i as _,p as v}from"./chunk-75Z2AOVW-C-Bqd86P.js";import{p as y}from"./dist-aRckhDGy.js";import{n as b}from"./mermaid-parser.core-ChvgqS5P.js";import{t as x}from"./chunk-JWPE2WC7-CEzeTtJC.js";function S(e,t){return t<e?-1:t>e?1:t>=e?0:NaN}function C(e){return e}function w(){var e=C,t=S,n=null,r=p(0),i=p(m),a=p(0);function o(o){var s,c=(o=g(o)).length,l,u,d=0,f=Array(c),p=Array(c),h=+r.apply(this,arguments),_=Math.min(m,Math.max(-m,i.apply(this,arguments)-h)),v,y=Math.min(Math.abs(_)/c,a.apply(this,arguments)),b=y*(_<0?-1:1),x;for(s=0;s<c;++s)(x=p[f[s]=s]=+e(o[s],s,o))>0&&(d+=x);for(t==null?n!=null&&f.sort(function(e,t){return n(o[e],o[t])}):f.sort(function(e,n){return t(p[e],p[n])}),s=0,u=d?(_-c*b)/d:0;s<c;++s,h=v)l=f[s],x=p[l],v=h+(x>0?x*u:0)+b,p[l]={data:o[l],index:s,value:x,startAngle:h,endAngle:v,padAngle:y};return p}return o.value=function(t){return arguments.length?(e=typeof t==`function`?t:p(+t),o):e},o.sortValues=function(e){return arguments.length?(t=e,n=null,o):t},o.sort=function(e){return arguments.length?(n=e,t=null,o):n},o.startAngle=function(e){return arguments.length?(r=typeof e==`function`?e:p(+e),o):r},o.endAngle=function(e){return arguments.length?(i=typeof e==`function`?e:p(+e),o):i},o.padAngle=function(e){return arguments.length?(a=typeof e==`function`?e:p(+e),o):a},o}var T=s.pie,E={sections:new Map,showData:!1,config:T},D=E.sections,O=E.showData,k=structuredClone(T),A={getConfig:e(()=>structuredClone(k),`getConfig`),clear:e(()=>{D=new Map,O=E.showData,a()},`clear`),setDiagramTitle:r,getDiagramTitle:l,setAccTitle:i,getAccTitle:d,setAccDescription:n,getAccDescription:c,addSection:e(({label:e,value:n})=>{if(n<0)throw Error(`"${e}" has invalid value: ${n}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);D.has(e)||(D.set(e,n),t.debug(`added new section: ${e}, with value: ${n}`))},`addSection`),getSections:e(()=>D,`getSections`),setShowData:e(e=>{O=e},`setShowData`),getShowData:e(()=>O,`getShowData`)},j=e((e,t)=>{x(e,t),t.setShowData(e.showData),e.sections.map(t.addSection)},`populateDb`),M={parse:e(async e=>{let n=await b(`pie`,e);t.debug(n),j(n,A)},`parse`)},N=e(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,`getStyles`),P=e(e=>{let t=[...e.values()].reduce((e,t)=>e+t,0),n=[...e.entries()].map(([e,t])=>({label:e,value:t})).filter(e=>e.value/t*100>=1);return w().value(e=>e.value).sort(null)(n)},`createPieArcs`),F={parser:M,db:A,renderer:{draw:e((e,n,r,i)=>{var a;t.debug(`rendering pie chart
`+e);let s=i.db,c=u(),l=_(s.getConfig(),c.pie),d=y(n),p=d.append(`g`);p.attr(`transform`,`translate(225,225)`);let{themeVariables:m}=c,[g]=v(m.pieOuterStrokeWidth);g??(g=2);let b=l.legendPosition,x=l.textPosition,S=l.donutHole>0&&l.donutHole<=.9?l.donutHole:0,C=h().innerRadius(S*185).outerRadius(185),w=h().innerRadius(185*x).outerRadius(185*x),T=p.append(`g`);T.append(`circle`).attr(`cx`,0).attr(`cy`,0).attr(`r`,185+g/2).attr(`class`,`pieOuterCircle`);let E=s.getSections(),D=P(E),O=[m.pie1,m.pie2,m.pie3,m.pie4,m.pie5,m.pie6,m.pie7,m.pie8,m.pie9,m.pie10,m.pie11,m.pie12],k=0;E.forEach(e=>{k+=e});let A=D.filter(e=>(e.data.value/k*100).toFixed(0)!==`0`),j=f(O).domain([...E.keys()]);T.selectAll(`mySlices`).data(A).enter().append(`path`).attr(`d`,C).attr(`fill`,e=>j(e.data.label)).attr(`class`,e=>{let t=`pieCircle`;return l.highlightSlice===`hover`?t+=` highlightedOnHover`:l.highlightSlice===e.data.label&&(t+=` highlighted`),t}),T.selectAll(`mySlices`).data(A).enter().append(`text`).text(e=>(e.data.value/k*100).toFixed(0)+`%`).attr(`transform`,e=>`translate(`+w.centroid(e)+`)`).style(`text-anchor`,`middle`).attr(`class`,`slice`);let M=p.append(`text`).text(s.getDiagramTitle()).attr(`x`,0).attr(`y`,-200).attr(`class`,`pieTitleText`),N=[...E.entries()].map(([e,t])=>({label:e,value:t})),F=p.selectAll(`.legend`).data(N).enter().append(`g`).attr(`class`,`legend`);F.append(`rect`).attr(`width`,18).attr(`height`,18).style(`fill`,e=>j(e.label)).style(`stroke`,e=>j(e.label)),F.append(`text`).attr(`x`,22).attr(`y`,14).text(e=>s.getShowData()?`${e.label} [${e.value}]`:e.label);let I=Math.max(...F.selectAll(`text`).nodes().map(e=>(e==null?void 0:e.getBoundingClientRect().width)??0)),L=450,R=490,z=N.length*22;switch(b){case`center`:F.attr(`transform`,(e,t)=>{let n=22*N.length/2,r=-I/2-22,i=t*22-n;return`translate(`+r+`,`+i+`)`});break;case`top`:L+=z,F.attr(`transform`,(e,t)=>`translate(${-I/2-22}, ${t*22-185})`),T.attr(`transform`,()=>`translate(0, ${z+22})`);break;case`bottom`:L+=z,F.attr(`transform`,(e,t)=>{let n=-I/2-22,r=t*22- -207;return`translate(`+n+`,`+r+`)`});break;case`left`:R+=22+I,F.attr(`transform`,(e,t)=>{let n=22*N.length/2;return`translate(-207,`+(t*22-n)+`)`}),T.attr(`transform`,()=>`translate(${I+18+4}, 0)`);break;default:R+=22+I,F.attr(`transform`,(e,t)=>{let n=22*N.length/2;return`translate(216,`+(t*22-n)+`)`})}let B=((a=M.node())==null?void 0:a.getBoundingClientRect().width)??0,V=225-B/2,H=225+B/2,U=Math.min(0,V),W=Math.max(R,H)-U;d.attr(`viewBox`,`${U} 0 ${W} ${L}`),o(d,L,W,l.useMaxWidth)},`draw`)},styles:N};export{F as diagram};