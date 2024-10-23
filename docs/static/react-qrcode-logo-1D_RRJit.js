import{c as T}from"./@babel-CsLD84_c.js";import{l as et}from"./lodash.isequal-DF9OFu-p.js";import{q as at}from"./qrcode-generator-B7rwAJ2l.js";import{r as nt}from"./react-BMFadVfK.js";var H={},it=T&&T.__extends||function(){var P=function(l,o){return P=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(t,r){t.__proto__=r}||function(t,r){for(var e in r)Object.prototype.hasOwnProperty.call(r,e)&&(t[e]=r[e])},P(l,o)};return function(l,o){if(typeof o!="function"&&o!==null)throw new TypeError("Class extends value "+String(o)+" is not a constructor or null");P(l,o);function t(){this.constructor=l}l.prototype=o===null?Object.create(o):(t.prototype=o.prototype,new t)}}(),G=T&&T.__assign||function(){return G=Object.assign||function(P){for(var l,o=1,t=arguments.length;o<t;o++){l=arguments[o];for(var r in l)Object.prototype.hasOwnProperty.call(l,r)&&(P[r]=l[r])}return P},G.apply(this,arguments)};Object.defineProperty(H,"__esModule",{value:!0});var lt=H.QRCode=void 0,st=et,ft=at,U=nt,ut=function(P){it(l,P);function l(o){var t=P.call(this,o)||this;return t.canvasRef=U.createRef(),t}return l.prototype.download=function(o,t){if(this.canvasRef.current){var r=void 0;switch(o){case"jpg":r="image/jpeg";break;case"webp":r="image/webp";break;case"png":default:r="image/png";break}var e=this.canvasRef.current.toDataURL(r,1),c=document.createElement("a");c.download=t??"react-qrcode-logo",c.href=e,c.click()}},l.prototype.utf16to8=function(o){var t="",r,e,c=o.length;for(r=0;r<c;r++)e=o.charCodeAt(r),e>=1&&e<=127?t+=o.charAt(r):e>2047?(t+=String.fromCharCode(224|e>>12&15),t+=String.fromCharCode(128|e>>6&63),t+=String.fromCharCode(128|e>>0&63)):(t+=String.fromCharCode(192|e>>6&31),t+=String.fromCharCode(128|e>>0&63));return t},l.prototype.drawRoundedSquare=function(o,t,r,e,c,f,v,u){u.lineWidth=o,u.fillStyle=c,u.strokeStyle=c,r+=o/2,t+=o/2,e-=o,Array.isArray(f)||(f=[f,f,f,f]),f=f.map(function(M){return M=Math.min(M,e/2),M<0?0:M});var p=f[0]||0,d=f[1]||0,m=f[2]||0,C=f[3]||0;u.beginPath(),u.moveTo(t+p,r),u.lineTo(t+e-d,r),d&&u.quadraticCurveTo(t+e,r,t+e,r+d),u.lineTo(t+e,r+e-m),m&&u.quadraticCurveTo(t+e,r+e,t+e-m,r+e),u.lineTo(t+C,r+e),C&&u.quadraticCurveTo(t,r+e,t,r+e-C),u.lineTo(t,r+p),p&&u.quadraticCurveTo(t,r,t+p,r),u.closePath(),u.stroke(),v&&u.fill()},l.prototype.drawPositioningPattern=function(o,t,r,e,c,f,v){v===void 0&&(v=[0,0,0,0]);var u=Math.ceil(t),p,d;typeof v!="number"&&!Array.isArray(v)?(p=v.outer||0,d=v.inner||0):(p=v,d=p);var m,C;typeof f!="string"?(m=f.outer,C=f.inner):(m=f,C=f);var M=e*t+r,q=c*t+r,I=t*7;this.drawRoundedSquare(u,q,M,I,m,p,!1,o),I=t*3,M+=t*2,q+=t*2,this.drawRoundedSquare(u,q,M,I,C,d,!0,o)},l.prototype.isInPositioninZone=function(o,t,r){return r.some(function(e){return t>=e.row&&t<=e.row+7&&o>=e.col&&o<=e.col+7})},l.prototype.transformPixelLengthIntoNumberOfCells=function(o,t){return o/t},l.prototype.isCoordinateInImage=function(o,t,r,e,c,f,v,u){if(u){var p=2,d=this.transformPixelLengthIntoNumberOfCells(c,v),m=this.transformPixelLengthIntoNumberOfCells(f,v),C=this.transformPixelLengthIntoNumberOfCells(r,v)-1,M=this.transformPixelLengthIntoNumberOfCells(e,v)-1;return t>=d-p&&t<=d+C+p&&o>=m-p&&o<=m+M+p}else return!1},l.prototype.shouldComponentUpdate=function(o){return!st(this.props,o)},l.prototype.componentDidMount=function(){this.update()},l.prototype.componentDidUpdate=function(){this.update()},l.prototype.update=function(){var o,t=this.props,r=t.value,e=t.ecLevel,c=t.enableCORS,f=t.bgColor,v=t.fgColor,u=t.logoImage,p=t.logoOpacity,d=t.logoOnLoad,m=t.removeQrCodeBehindLogo,C=t.qrStyle,M=t.eyeRadius,q=t.eyeColor,I=t.logoPaddingStyle,O=+this.props.size,W=+this.props.quietZone,$=this.props.logoWidth?+this.props.logoWidth:0,z=this.props.logoHeight?+this.props.logoHeight:0,k=this.props.logoPadding?+this.props.logoPadding:0,g=ft(0,e);g.addData(this.utf16to8(r)),g.make();var Z=(o=this.canvasRef)===null||o===void 0?void 0:o.current,i=Z.getContext("2d"),E=O+2*W,y=g.getModuleCount(),s=O/y,Q=window.devicePixelRatio||1;Z.height=Z.width=E*Q,i.scale(Q,Q),i.fillStyle=f,i.fillRect(0,0,E,E);var h=W,F=[{row:0,col:0},{row:0,col:y-7},{row:y-7,col:0}];if(i.strokeStyle=v,C==="dots"){i.fillStyle=v;for(var w=s/2,a=0;a<y;a++)for(var n=0;n<y;n++)g.isDark(a,n)&&!this.isInPositioninZone(a,n,F)&&(i.beginPath(),i.arc(Math.round(n*s)+w+h,Math.round(a*s)+w+h,w/100*75,0,2*Math.PI,!1),i.closePath(),i.fill())}else if(C==="fluid"){for(var w=Math.ceil(s/2),a=0;a<y;a++)for(var n=0;n<y;n++)if(g.isDark(a,n)&&!this.isInPositioninZone(a,n,F)){var S=[!1,!1,!1,!1];a>0&&!g.isDark(a-1,n)&&n>0&&!g.isDark(a,n-1)&&(S[0]=!0),a>0&&!g.isDark(a-1,n)&&n<y-1&&!g.isDark(a,n+1)&&(S[1]=!0),a<y-1&&!g.isDark(a+1,n)&&n<y-1&&!g.isDark(a,n+1)&&(S[2]=!0),a<y-1&&!g.isDark(a+1,n)&&n>0&&!g.isDark(a,n-1)&&(S[3]=!0);var _=Math.ceil((n+1)*s)-Math.floor(n*s),b=Math.ceil((a+1)*s)-Math.floor(a*s);i.fillStyle=v,i.beginPath(),i.arc(Math.round(n*s)+w+h,Math.round(a*s)+w+h,w,0,2*Math.PI,!1),i.closePath(),i.fill(),S[0]||i.fillRect(Math.round(n*s)+h,Math.round(a*s)+h,_/2,b/2),S[1]||i.fillRect(Math.round(n*s)+h+Math.floor(_/2),Math.round(a*s)+h,_/2,b/2),S[2]||i.fillRect(Math.round(n*s)+h+Math.floor(_/2),Math.round(a*s)+h+Math.floor(b/2),_/2,b/2),S[3]||i.fillRect(Math.round(n*s)+h,Math.round(a*s)+h+Math.floor(b/2),_/2,b/2)}}else for(var a=0;a<y;a++)for(var n=0;n<y;n++)if(g.isDark(a,n)&&!this.isInPositioninZone(a,n,F)){i.fillStyle=v;var _=Math.ceil((n+1)*s)-Math.floor(n*s),b=Math.ceil((a+1)*s)-Math.floor(a*s);i.fillRect(Math.round(n*s)+h,Math.round(a*s)+h,_,b)}for(var D=0;D<3;D++){var J=F[D],a=J.row,n=J.col,R=M,A=void 0;Array.isArray(R)&&(R=R[D]),typeof R=="number"&&(R=[R,R,R,R]),q?Array.isArray(q)?A=q[D]:A=q:A=v,this.drawPositioningPattern(i,s,h,a,n,A,R)}if(u){var L=new Image;c&&(L.crossOrigin="Anonymous"),L.onload=function(tt){i.save();var j=$||O*.2,B=z||j,K=(O-j)/2,V=(O-B)/2;if(m||k){i.beginPath(),i.strokeStyle=f,i.fillStyle=f;var x=j+2*k,N=B+2*k,X=K+h-k,Y=V+h-k;if(I==="circle"){var ot=X+x/2,rt=Y+N/2;i.ellipse(ot,rt,x/2,N/2,0,0,2*Math.PI),i.stroke(),i.fill()}else i.fillRect(X,Y,x,N)}i.globalAlpha=p,i.drawImage(L,K+h,V+h,j,B),i.restore(),d&&d(tt)},L.src=u}},l.prototype.render=function(){var o,t=+this.props.size+2*+this.props.quietZone;return U.createElement("canvas",{id:(o=this.props.id)!==null&&o!==void 0?o:"react-qrcode-logo",height:t,width:t,style:G({height:t+"px",width:t+"px"},this.props.style),ref:this.canvasRef})},l.defaultProps={value:"https://reactjs.org/",ecLevel:"M",enableCORS:!1,size:150,quietZone:10,bgColor:"#FFFFFF",fgColor:"#000000",logoOpacity:1,qrStyle:"squares",eyeRadius:[0,0,0],logoPaddingStyle:"square"},l}(U.Component);lt=H.QRCode=ut;export{lt as Q};