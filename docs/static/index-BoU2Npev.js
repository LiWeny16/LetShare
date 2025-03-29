import{r as c,j as n,a as H}from"./react-B4V_vTrs.js";import{R as Ce,c as je}from"./react-dom-CqEOeDN_.js";import{S as Ie,A as ke,B as h,T as J,I as ne,d as Ae,a as De,D as Y,b as G,c as q,e as V,C as R,u as Ue,f as ae,g as Fe,L as Me,h as A,F as Ee,i as Z,j as Pe,k as Ne,l as Je,m as Be,n as Ve,o as ze,p as Te,q as Qe,r as Le,s as We,t as se,v as Oe,M as re}from"./@mui-BbOp440l.js";import{m as Ze}from"./mitt-DJ65BbbF.js";import{k as Ke}from"./bigonion-kit-CY3QLVqN.js";import{Q as ce}from"./react-qrcode-logo-BeSdvrP5.js";import{H as He}from"./react-router-dom-BTLnAETc.js";import{a as Ye,b as ie}from"./react-router-eewwE4pT.js";import"./@babel-LAXhhp6N.js";import"./scheduler-CzFDRTuY.js";import"./clsx-B-dksMZM.js";import"./react-is-DUDD-a5e.js";import"./@emotion-Dtuj-UBK.js";import"./hoist-non-react-statics-DQogQWOa.js";import"./stylis-DW3lCxvG.js";import"./react-transition-group-CSnmlvJK.js";import"./lodash.isequal-CFHbgcyd.js";import"./qrcode-generator-B7rwAJ2l.js";import"./@remix-run-DspApiwr.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))r(s);new MutationObserver(s=>{for(const i of s)if(i.type==="childList")for(const l of i.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&r(l)}).observe(document,{childList:!0,subtree:!0});function t(s){const i={};return s.integrity&&(i.integrity=s.integrity),s.referrerPolicy&&(i.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?i.credentials="include":s.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function r(s){if(s.ep)return;s.ep=!0;const i=t(s);fetch(s.href,i)}})();const le=Ze(),Ge=()=>{const[a,e]=c.useState(!1),[t,r]=c.useState(""),[s,i]=c.useState("success"),[l,g]=c.useState(2500),[w,m]=c.useState(9999);return c.useEffect(()=>{le.on("show",u=>{r(u.message),i(u.severity||"success"),g(u.duration||2500),m(u.zIndex||9999),e(!0)})},[]),Ce.createPortal(n.jsx(Ie,{open:a,autoHideDuration:l,onClose:()=>e(!1),anchorOrigin:{vertical:"top",horizontal:"center"},style:{zIndex:w},children:n.jsx(ke,{onClose:()=>e(!1),severity:s,variant:"filled",children:t})}),document.body)},F=(a,e,t)=>{le.emit("show",{message:a,severity:t?.kind??"success",duration:e??2500,zIndex:t?.zIndex??9999})};class x{static instance=null;static userId=null;static uniqId=null;static peers=new Map;dataChannels=new Map;ws=null;knownUsers=new Set;setMsgFromSharing=()=>{};setFileFromSharing=()=>{};updateConnectedUsers=()=>{};fileMetaInfo={name:"default_received_file"};lastPongTimes=new Map;isSendingFile=!1;receivingFile=null;totalChunks=0;chunkSize=16*1024*2;receivedChunkCount=0;connectionQueue=new Map;pendingOffers=new Set;negotiationMap=new Map;discoverQueue=[];discoverLock=!1;getStatesMemorable(){const e=localStorage.getItem("memorableState");return e?JSON.parse(e):{memorable:{localLANId:"none"}}}changeStatesMemorable(e){localStorage.setItem("memorableState",JSON.stringify(e))}constructor(){let t=this.getStatesMemorable().memorable.localLANId;t==="none"&&(t=this.generateUUID(),this.changeStatesMemorable({memorable:{localLANId:t}})),x.userId=t,x.uniqId=t+":"+this.generateUUID(),this.knownUsers.add(x.uniqId)}static getInstance(){return x.instance||(x.instance=new x),x.instance}getUniqId(){return x.uniqId}getUserId(){return x.userId}setUserId(e){x.userId=e,this.changeStatesMemorable({memorable:{localLANId:e}})}setUniqId(e){x.uniqId=e}async connect(e,t,r,s){try{this.setMsgFromSharing=t,this.setFileFromSharing=r,this.updateConnectedUsers=s;const i=this.getUniqId();this.ws=new WebSocket(e),this.ws.onopen=()=>{this.broadcastSignal({type:"discover",id:i})},this.ws.onmessage=l=>this.handleSignal(l),this.ws.onclose=()=>this.cleanUpConnections(),this.ws.onerror=l=>console.error("WebSocket error:",l),window.addEventListener("beforeunload",()=>this.disconnect()),window.addEventListener("pagehide",()=>this.disconnect())}catch(i){console.log(i)}}async disconnect(e,t){t&&e&&(t(null),e(null)),this.broadcastSignal({type:"leave",id:this.getUniqId()}),this.cleanUpConnections()}cleanUpConnections(){console.warn("🔌 WebSocket disconnected, cleaning up only WS-related state."),this.ws&&(this.ws.onclose=null,this.ws.close(),this.ws=null),this.updateConnectedUsers&&this.updateConnectedUsers(this.getAllUsers())}async handleSignal(e){try{const t=JSON.parse(e.data);if(!t)return;switch(t.type){case"discover":await this.handleDiscover(t);break;case"offer":await this.handleOffer(t);break;case"answer":await this.handleAnswer(t);break;case"candidate":await this.handleCandidate(t);break;case"leave":this.handleLeave(t);break;default:console.warn("Unknown message type",t.type)}}catch(t){console.error("🚨 Failed to parse WebSocket message:",e.data,t)}}async handleDiscover(e){const t=e.id;!t||t===this.getUniqId()||this.knownUsers.has(t)||(this.discoverQueue.push(e),this.processDiscoverQueue())}async processDiscoverQueue(){if(!this.discoverLock){this.discoverLock=!0;try{for(;this.discoverQueue.length>0;){const e=this.discoverQueue.shift(),t=e.id;this.knownUsers.has(t)||(this.knownUsers.add(t),await new Promise(r=>setTimeout(r,Math.random()*500)),t>this.getUniqId()&&await this.connectToUser(t),F("收到链接请求",2e3,{kind:"success"}),!e.isReply&&!e.processed&&this.broadcastSignal({type:"discover",id:this.getUniqId(),isReply:!0,processed:!0}))}}finally{this.discoverLock=!1}}}handleLeave(e){const t=e.id;if(this.knownUsers.has(t)){this.knownUsers.delete(t);const r=x.peers.get(t);r&&(r.close(),x.peers.delete(t));const s=this.dataChannels.get(t);s&&(s.close(),this.dataChannels.delete(t)),this.updateConnectedUsers(this.getAllUsers()),console.log(`User ${t} has left, cleaned up resources.`)}}createPeerConnection(e){const t=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun.counterpath.net"},{urls:"stun:stun.internetcalls.com"},{urls:"stun:stun.voip.aebc.com"},{urls:"stun:stun.voipbuster.com"},{urls:"stun:stun.xten.com"},{urls:"stun:global.stun.twilio.com:3478"}],iceTransportPolicy:"all",bundlePolicy:"max-bundle",rtcpMuxPolicy:"require"});this.negotiationMap.set(e,{isNegotiating:!1,queue:[]}),t.onnegotiationneeded=async()=>{};let r=[],s=!1;return t.onicecandidate=i=>{i.candidate&&(r.push(i.candidate),s||(s=!0,setTimeout(()=>{this.broadcastSignal({type:"candidate",candidates:r,to:e}),r=[],s=!1},500)))},t.ondatachannel=i=>{this.setupDataChannel(i.channel,e)},t.onconnectionstatechange=()=>{(t.connectionState==="failed"||t.connectionState==="disconnected")&&(console.log(`Peer connection with ${e} failed, attempting to reconnect.`),this.connectToUser(e))},e&&x.peers.set(e,t),t}broadcastSignal(e){if(this.ws&&this.ws.readyState===WebSocket.OPEN){const t={...e,from:this.getUniqId()};this.ws.send(JSON.stringify(t))}}async handleOffer(e){const t=e.from;x.peers.has(t)||this.createPeerConnection(t),this.negotiationMap.get(t).queue.push({type:"offer",sdp:e.offer}),this.processNegotiationQueue(t)}async processNegotiationQueue(e){if(!x.peers.get(e))return;const r=this.negotiationMap.get(e);if(r&&!r.isNegotiating){r.isNegotiating=!0;try{for(;r.queue.length>0;){const s=r.queue.shift();s.type==="offer"?await this.doHandleOffer(e,s.sdp):s.type==="answer"&&await this.doHandleAnswer(e,s.sdp)}}finally{r.isNegotiating=!1}}}async doHandleOffer(e,t){const r=x.peers.get(e);if(!r)return;await r.setRemoteDescription(new RTCSessionDescription(t));const s=await r.createAnswer();await r.setLocalDescription(s),this.broadcastSignal({type:"answer",answer:r.localDescription,to:e})}async handleAnswer(e){const t=e.from;if(!x.peers.has(t))return;const r=this.negotiationMap.get(t);r&&(r.queue.push({type:"answer",sdp:e.answer}),this.processNegotiationQueue(t))}async doHandleAnswer(e,t){const r=x.peers.get(e);if(r){if(r.signalingState!=="have-local-offer"){console.warn(`Ignore answer from ${e}, because local signalingState=${r.signalingState}`);return}await r.setRemoteDescription(new RTCSessionDescription(t))}}async handleCandidate(e){const t=x.peers.get(e.from);if(t&&e.candidates)for(const r of e.candidates)try{await t.addIceCandidate(new RTCIceCandidate(r))}catch(s){console.error("Error adding ICE candidate:",s)}}getAllUsers(){return Array.from(this.knownUsers).filter(e=>e!==this.getUniqId())}setupDataChannel(e,t){e.binaryType="arraybuffer";let r=null;e.onopen=()=>{console.log(`Data channel with user ${t} is open`),this.updateConnectedUsers(this.getAllUsers()),r=setInterval(()=>{e.readyState==="open"&&e.send(JSON.stringify({type:"ping"}))},2e3)},e.onmessage=s=>{if(typeof s.data=="string"){const i=JSON.parse(s.data);switch(i.type){case"file-meta":this.receivingFile={name:i.name,size:i.size,receivedSize:0,chunks:[]},this.totalChunks=Math.ceil(this.receivingFile.size/this.chunkSize),b.fileMetaInfo.name=i.name,console.log(`File meta received: ${this.receivingFile.name}, Size: ${this.receivingFile.size}`);break;case"ping":e.send(JSON.stringify({type:"pong"}));break;case"pong":this.lastPongTimes.set(t,Date.now());break;case"text":default:this.setMsgFromSharing(i.msg);break}}else{const i=s.data,l=8;if(i.byteLength<l){console.error("接收到的二进制数据太小");return}const g=new DataView(i),w=g.getUint32(0),m=g.getUint32(4),u=i.slice(l);if(u.byteLength!==m){console.error(`切片 ${w} 数据长度不匹配: 声明 ${m}，实际 ${u.byteLength}`);return}if(!this.receivingFile){console.error("尚未接收到文件元数据，无法处理切片");return}if(this.receivingFile.chunks[w]||(this.receivingFile.chunks[w]=u,this.receivingFile.receivedSize+=u.byteLength,this.receivedChunkCount++),this.receivedChunkCount===this.totalChunks){const p=[];for(let y=0;y<this.totalChunks;y++){if(!this.receivingFile.chunks[y]){console.error(`缺少切片 ${y}`);return}p.push(this.receivingFile.chunks[y])}const S=new Blob(p),C=new File([S],this.receivingFile.name,{type:"application/octet-stream"});this.setFileFromSharing(C),console.log("✅ 文件接收成功",C),this.receivingFile=null,this.totalChunks=0,this.receivedChunkCount=0}}e.onclose=()=>{console.log(`Data channel with user ${t} is closed`),F("与对方断开连接,请刷新页面",2e3,{kind:"error"}),r&&(clearInterval(r),r=null),this.dataChannels.delete(t),this.lastPongTimes.delete(t)},e.onerror=i=>{console.error("Data channel error:",i)},this.dataChannels.set(t,e),this.lastPongTimes.set(t,Date.now())}}async connectToUser(e){if(!this.connectionQueue.has(e)){this.connectionQueue.set(e,!0);try{if(!x.peers.has(e)){e>this.getUniqId()&&await new Promise(i=>setTimeout(i,Math.random()*500));const t=this.createPeerConnection(e);if(this.pendingOffers.has(e))return;this.pendingOffers.add(e);const r=t.createDataChannel("chat");this.setupDataChannel(r,e);const s=await t.createOffer({iceRestart:!0});await t.setLocalDescription(s),this.broadcastSignal({type:"offer",offer:t.localDescription,to:e}),setTimeout(()=>{t.iceConnectionState!=="connected"&&(console.log(`Retrying connection to ${e}`),this.connectToUser(e))},2e3)}}finally{this.connectionQueue.delete(e),this.pendingOffers.delete(e)}}}async sendMessageToUser(e,t){const r=this.dataChannels.get(e);if(r?.readyState==="open"){r.send(JSON.stringify({msg:t,type:"text"}));return}console.warn(`Channel not open with user ${e}. Attempting reconnection...`);try{await this.connectToUser(e),await new Promise(i=>setTimeout(i,500));const s=this.dataChannels.get(e);s?.readyState==="open"?(s.send(JSON.stringify({msg:t,type:"text"})),console.log(`Message re-sent after reconnecting to user ${e}`)):console.error(`Reconnected but channel still not open with ${e}`)}catch(s){console.error(`Failed to reconnect and send message to ${e}:`,s)}}async sendFileToUser(e,t,r){const s=this.dataChannels.get(e);if(!s||s.readyState!=="open")return console.error(`Data channel with user ${e} is not available.`),()=>{};const i=Math.ceil(t.size/this.chunkSize),l=10;let g=0,w=0,m=!1;const u=[],p=()=>{m=!0,u.length=0,this.isSendingFile=!1,console.warn("⛔️ 文件传输已被中断")},S={type:"file-meta",name:t.name,size:t.size,totalChunks:i};s.send(JSON.stringify(S)),console.log("已发送文件元数据:",S);const C=D=>new Promise((v,j)=>{if(m)return j(new Error("读取中止"));const I=D*this.chunkSize,N=t.slice(I,I+this.chunkSize),k=new FileReader;k.onload=()=>{k.result instanceof ArrayBuffer?v(k.result):j(new Error("读取结果不是 ArrayBuffer"))},k.onerror=M=>j(M),k.readAsArrayBuffer(N)}),y=async D=>{if(!m)try{const v=await C(D);if(m)return;const j=8,I=new ArrayBuffer(j+v.byteLength),N=new DataView(I);N.setUint32(0,D),N.setUint32(4,v.byteLength),new Uint8Array(I,j).set(new Uint8Array(v));const k=()=>{if(!m)if(s.bufferedAmount<256*1024){if(s.send(I),g++,r){let M=Math.min(g/i*100,100);r(M),M>=100||M===null||M===0?this.isSendingFile=!1:this.isSendingFile=!0}}else setTimeout(k,100)};k()}catch(v){m||console.error(`切片 ${D} 发送失败:`,v)}};return await(async()=>{for(;w<i&&!m;){u.length>=l&&await Promise.race(u);const D=w++,v=y(D);u.push(v),v.finally(()=>{const j=u.indexOf(v);j>-1&&u.splice(j,1)})}})(),await Promise.allSettled(u),m||console.log("✅ 文件发送完成"),p}generateUUID(){return Math.random().toString(36).substring(2,8)}isConnected(){return this.ws!==null&&this.ws.readyState===WebSocket.OPEN}getConnectedUserIds(){return this.getAllUsers()}}const b=x.getInstance();async function qe(){if(navigator.clipboard?.readText||F("当前浏览器不支持读取剪切板，请手动粘贴。",3e3,{kind:"warning"}),navigator.clipboard&&typeof navigator.clipboard.readText=="function")try{return await navigator.clipboard.readText()||""}catch(a){console.error("Failed to read clipboard contents via clipboard API: ",a)}try{const a=document.createElement("textarea");document.body.appendChild(a),a.style.position="absolute",a.style.left="-9999px",a.focus(),document.execCommand("paste");const e=a.value;return document.body.removeChild(a),e||""}catch(a){console.error("Failed to read clipboard contents via execCommand: ",a)}return console.warn("Clipboard API and execCommand are not supported on this device."),""}async function Re(a){if(navigator.clipboard&&typeof navigator.clipboard.writeText=="function")try{if(await navigator.clipboard.writeText(a),typeof navigator.clipboard.readText=="function")try{const e=await navigator.clipboard.readText();if(e===a)return!0;console.warn("Clipboard text mismatch. Written vs Read:",a,e)}catch(e){console.warn("Could not verify clipboard content:",e)}else return!0}catch(e){console.error("Failed to write clipboard via Clipboard API:",e)}try{const e=document.createElement("textarea");e.value=a,e.style.position="fixed",e.style.top="-1000px",document.body.appendChild(e),e.focus(),e.select();const t=document.execCommand("copy");if(document.body.removeChild(e),t)return!0;console.warn("execCommand copy returned false.")}catch(e){console.error("Failed to write clipboard via execCommand:",e)}return F("复制失败，请手动复制文本。",3e3,{kind:"warning"}),!1}const Xe=()=>{const[a,e]=c.useState(!1),t=()=>e(!0),r=()=>e(!1);return n.jsxs(n.Fragment,{children:[n.jsxs(h,{component:"footer",sx:{display:"flex",justifyContent:"space-between",alignItems:"center",p:2,borderTop:"1px solid #e0e0e0",borderBottom:"1px solid #e0e0e0",mb:"20px",mt:"auto"},children:[n.jsx(J,{variant:"body2",color:"text.secondary",children:"© 2025 LetShare Copyright Author Onion"}),n.jsxs(h,{sx:{display:"flex",alignItems:"center"},children:[n.jsx(ne,{"aria-label":"GitHub",component:"a",href:"https://github.com/LiWeny16/LetShare",target:"_blank",rel:"noopener noreferrer",children:n.jsx(Ae,{})}),n.jsx(ne,{"aria-label":"QR Code",onClick:t,children:n.jsx(De,{})})]})]}),n.jsxs(Y,{open:a,onClose:r,children:[n.jsx(G,{children:"分享·一触即发"}),n.jsx(q,{sx:{display:"flex",justifyContent:"center",alignItems:"center",p:4},children:n.jsx(ce,{value:"https://bit.ly/4j0NA74",size:180,ecLevel:"H",quietZone:10})})]})]})},$e=({onEditDone:a})=>{const[e,t]=c.useState(!1),[r,s]=c.useState(""),[i,l]=c.useState(!1),g=c.useRef("");c.useEffect(()=>{const p=b.getUserId();p&&(s(p),g.current=p)},[]);const w=/^[\u4e00-\u9fa5a-zA-Z0-9]*$/,m=p=>{const S=p.target.value;s(S),l(!w.test(S))},u=()=>{const p=r.trim();if(!w.test(p)||!p){s(g.current),l(!0),t(!1);return}b.setUserId(p),g.current=p,l(!1),t(!1),a&&a(p)};return n.jsx(n.Fragment,{children:e?n.jsx(V,{value:r,onChange:m,onBlur:u,onKeyDown:p=>{p.key==="Enter"&&u()},autoFocus:!0,variant:"standard",error:i,helperText:i?"只允许输入字母、数字和汉字":" ",inputProps:{style:{textAlign:"center"}},sx:{mt:2,display:"block",mx:"auto"}}):n.jsxs(J,{variant:"body2",color:"textSecondary",align:"center",sx:{mt:2,cursor:"pointer"},onClick:()=>t(!0),children:["你的ID: ",r]})})},_e=({open:a})=>n.jsx(h,{sx:{width:"100vw",minHeight:"100vh",position:"fixed",top:0,left:0,display:a?"flex":"none",flexDirection:"column",justifyContent:"center",alignItems:"center",background:"linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",color:"white",textAlign:"center",p:2,boxSizing:"border-box"},children:n.jsxs(h,{sx:{mb:"200px"},children:[n.jsx(h,{component:"img",src:"/icons/512x512.png",alt:"Logo",sx:{width:{xs:120,sm:160,md:200},height:"auto",mb:3}}),n.jsx(J,{variant:"h6",sx:{fontWeight:300},children:"Connect To The World"}),n.jsx(J,{variant:"subtitle1",sx:{opacity:.85},children:"轻触，开启通往世界的大门"}),n.jsx(h,{mt:4,children:n.jsx(R,{color:"inherit"})})]})});function et({open:a,progress:e,setProgress:t,onClose:r,abortFileTransfer:s}){const i=Ue(),l=async()=>{F("终止传输",2e3,{kind:"error"});try{typeof s=="function"&&(t(0),await s())}catch(g){console.error("取消传输失败：",g)}finally{r()}};return H.useEffect(()=>{e===null&&r()},[e]),n.jsxs(n.Fragment,{children:[n.jsx(ae,{open:a,onClick:r,sx:{zIndex:i.zIndex.modal,backgroundColor:"rgba(0, 0, 0, 0.4)"}}),n.jsx(Fe,{in:a,direction:"down",mountOnEnter:!0,unmountOnExit:!0,children:n.jsx(h,{sx:{position:"fixed",top:0,left:0,width:"100%",display:"flex",justifyContent:"center",zIndex:i.zIndex.modal},children:n.jsxs(h,{sx:{width:{xs:"88%",sm:"80%",md:"60%",lg:"50%"},height:90,backgroundColor:i.palette.background.paper,boxShadow:3,px:2,py:2,borderBottomLeftRadius:19,borderBottomRightRadius:19,display:"flex",flexDirection:"column",justifyContent:"space-between"},children:[n.jsx(h,{children:"传输进度"}),n.jsxs(h,{sx:{display:"flex",alignItems:"center",gap:2},children:[n.jsxs(h,{sx:{flex:1},children:[n.jsxs(J,{variant:"body2",color:"text.secondary",gutterBottom:!0,sx:{mb:1},children:["正在发送文件：",e?e.toFixed(0):0,"%"]}),n.jsx(Me,{variant:"determinate",value:e??0,sx:{height:8,borderRadius:5}})]}),n.jsx(A,{variant:"contained",color:"error",size:"small",onClick:l,sx:{whiteSpace:"nowrap",minWidth:64,...z},children:"取消"})]})]})})})]})}const oe="wss://md-server-md-server-bndnqhexdf.cn-hangzhou.fcapp.run",tt={transition:"background-color 0.4s ease, box-shadow 0.4s ease",position:"relative",padding:"10px",borderRadius:"8px",display:"flex",flexDirection:"column",mt:"10px",mb:"5px",backgroundColor:"white",boxShadow:"0 2px 8px rgba(0, 0, 0, 0.1)",overflow:"hidden",cursor:"pointer"},K={"& .MuiBadge-badge":{top:4,right:4}},z={borderRadius:"5px",borderColor:"#e0e0e0"};function nt(){const[a,e]=H.useState(()=>{}),[t,r]=c.useState(null),[s,i]=c.useState(null),[l,g]=c.useState(!1),[w,m]=c.useState([]),[u,p]=c.useState(!1),[S,C]=c.useState("clip"),[y,Q]=c.useState(null),[D,v]=c.useState(null),[j,I]=c.useState(!1),[N,k]=c.useState(""),[M,L]=c.useState(null),[de,ue]=c.useState(!0),[W,he]=c.useState(!0),[ge,T]=c.useState(!1),[$,O]=H.useState(!1),fe=c.useRef(null),_=c.useRef(null),ee=o=>{o.preventDefault(),o.stopPropagation(),console.log(o);const d=o.target.files?.[0]||null;d&&(Q(d),C("file"))},pe=()=>{k(""),I(!0)},te=o=>{const d=o.map(f=>{const U=f.split(":");return{id:f,name:U[0]||f}});m(d)};async function xe(){p(!0);try{b.isConnected()||await b.connect(oe,o=>{r(o),g(!0)},o=>{i(o),g(!0)},te).catch(console.error),b.broadcastSignal({type:"discover",id:b.getUniqId(),isReply:!1}),await Ke.sleep(1e3)}catch(o){console.error("Search error:",o)}finally{p(!1)}}const me=async(o,d)=>{try{if(S==="file"&&y){if(b.isSendingFile){F("有任务正在进行中！",2e3,{kind:"info"}),T(!0);return}T(!0);let f=await b.sendFileToUser(d,y,U=>{L(U),U>=100&&setTimeout(()=>L(null),1500)});e(()=>f)}else if(S==="text"&&D)await b.sendMessageToUser(d,D);else if(S==="clip"){let f=await qe();f?await b.sendMessageToUser(d,f??"读取剪切板失败"):F("剪切板为空",2e3,{kind:"error"})}else F("未选择发送内容",2e3,{kind:"info"})}catch(f){console.error("发送失败：",f)}};c.useEffect(()=>(setTimeout(()=>{he(!1)},1e3),b.connect(oe,o=>{r(o),g(!0)},o=>{i(o),g(!0)},te).catch(console.error),()=>{b.disconnect(r,i)}),[W]),c.useEffect(()=>{(t||s)&&g(!0)},[t,s]),c.useEffect(()=>{const o=async d=>{if(j||l)return;const f=d.clipboardData;if(!f)return;const U=f.items;for(const P of U)if(P.kind==="file"){const B=P.getAsFile();if(B){Q(B),C("file");return}}const E=f.getData("text/plain");E&&E.trim().length>0&&(v(E),C("text"))};return window.addEventListener("paste",o),ue(!1),()=>{window.removeEventListener("paste",o)}},[j,l]),c.useEffect(()=>{const o=setInterval(async()=>{const d=[...w];for(const f of d){const U=b.dataChannels.get(f.id);if(!U||U.readyState!=="open"){console.warn(`通道不通，尝试重连 ${f.id}`);try{await b.connectToUser(f.id),await new Promise(P=>setTimeout(P,500));const E=b.dataChannels.get(f.id);!E||E.readyState!=="open"?(console.warn(`重连失败，剔除 ${f.id}`),m(P=>P.filter(B=>B.id!==f.id))):console.log(`用户 ${f.id} 重连成功`)}catch(E){console.error(`连接用户 ${f.id} 失败`,E),m(P=>P.filter(B=>B.id!==f.id))}}}},3500);return()=>clearInterval(o)},[w]);const ye=()=>{try{if(t)Re(t),F("成功写入剪贴板",2e3,{kind:"success"});else if(s){const o=new Blob([s]),d=document.createElement("a");d.href=URL.createObjectURL(o),d.download=b.fileMetaInfo.name||"shared_file",document.body.appendChild(d),d.click(),document.body.removeChild(d)}}catch(o){console.error("处理接受失败",o)}finally{g(!1),setTimeout(()=>{i(null),r(null)},500)}},we=o=>{o.preventDefault(),o.stopPropagation()},Se=o=>{o.preventDefault(),o.stopPropagation(),O(!0)},be=o=>{o.preventDefault(),o.stopPropagation();const d=_.current?.getBoundingClientRect();d&&(o.clientX<d.left||o.clientX>d.right||o.clientY<d.top||o.clientY>d.bottom)&&O(!1)},ve=o=>{o.preventDefault(),o.stopPropagation(),O(!1);const d=o.dataTransfer.files;d.length>0&&ee({target:{files:d}})};return n.jsxs(n.Fragment,{children:[!W&&n.jsxs(h,{ref:_,onDragEnter:Se,onDragLeave:be,onDragOver:we,onDrop:ve,sx:{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%, -50%)",width:{xs:"75%",sm:"80%",md:"60%"},maxWidth:"900px",height:"70vh",p:3,m:"auto",boxShadow:8,borderRadius:2,backgroundColor:"background.paper",zIndex:o=>o.zIndex.modal,display:"flex",flexDirection:"column",justifyContent:"space-between"},children:[$&&n.jsx(Ee,{in:$,timeout:400,unmountOnExit:!0,children:n.jsx(h,{sx:{position:"absolute",top:0,left:0,width:"100%",height:"100%",zIndex:1e3,backgroundColor:"rgba(0, 0, 0, 0.5)",borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"},children:n.jsx(J,{variant:"h6",color:"white",children:"松手上传文件"})})}),n.jsx(Xe,{}),n.jsxs(h,{sx:{display:"flex",gap:2,flexWrap:"wrap"},children:[n.jsx(Z,{color:"primary",badgeContent:S==="file"?1:0,overlap:"circular",sx:K,children:n.jsx(A,{variant:"outlined",sx:z,startIcon:n.jsx(Pe,{}),onClick:()=>{const o=document.getElementById("file-input");o&&(o.value="",o.click())},children:"文件"})}),n.jsx("input",{id:"file-input",type:"file",hidden:!0,onChange:ee}),n.jsx(A,{disabled:!0,variant:"outlined",startIcon:n.jsx(Ne,{}),sx:z,children:"文件夹"}),n.jsx(Z,{color:"primary",badgeContent:S==="text"?1:0,overlap:"circular",sx:K,children:n.jsx(A,{onClick:pe,variant:"outlined",startIcon:n.jsx(Je,{}),sx:z,children:"文本"})}),n.jsx(Z,{color:"primary",badgeContent:S==="clip"?1:0,overlap:"circular",sx:K,children:n.jsx(A,{onClick:()=>C("clip"),variant:"outlined",startIcon:n.jsx(Be,{}),sx:z,children:"剪贴板"})})]}),n.jsx(h,{sx:{mt:3},children:n.jsx(A,{ref:fe,onClick:xe,variant:"contained",endIcon:u?n.jsx(R,{size:20,color:"inherit"}):n.jsx(Ve,{}),disabled:u,children:"搜索同WIFI下用户"})}),n.jsx(ze,{sx:{my:2}}),n.jsx(h,{sx:{flexGrow:1,overflowY:"auto"},children:w.map(o=>n.jsx(h,{sx:{...tt,width:"93%"},onClick:d=>me(d,o.id),children:n.jsxs(h,{sx:{display:"flex",alignItems:"center",gap:1},children:[n.jsx(Te,{}),n.jsx(J,{children:o.name})]})},o.id))}),n.jsx(Qe,{color:"primary",onClick:()=>{T(!0)},sx:{position:"absolute",bottom:65,right:35,zIndex:o=>o.zIndex.modal+1},children:n.jsx(Le,{})}),n.jsx($e,{})]}),n.jsxs(Y,{open:l,onClose:()=>{g(!1),setTimeout(()=>{r(null),i(null)},300)},children:[n.jsx(G,{children:"✨ 新分享"}),n.jsxs(q,{sx:{width:{sx:200,sm:200,md:400,lg:400}},children:[n.jsx(We,{children:"您有来自外部的消息，是否接受？"}),t&&n.jsx(V,{value:t??"",multiline:!0,fullWidth:!0,InputProps:{readOnly:!0},variant:"outlined",sx:{border:"none",maxHeight:300,overflowY:"auto",backgroundColor:"#f5f5f5",borderRadius:1,mt:1,fontSize:{xs:"14px",sm:"15px"},"& .MuiInputBase-input":{whiteSpace:"pre-wrap"}}})]}),n.jsxs(se,{children:[n.jsx(A,{onClick:()=>{g(!1),r(null),i(null)},color:"secondary",children:"拒绝"}),n.jsx(A,{onClick:ye,color:"primary",autoFocus:!0,children:"接受"})]})]}),n.jsxs(Y,{open:j,onClose:()=>I(!1),fullWidth:!0,maxWidth:"sm",PaperProps:{sx:{borderRadius:2,px:{xs:1,sm:4},py:2,mx:{xs:1,sm:"auto"}}},children:[n.jsx(G,{sx:{fontWeight:600,fontSize:{xs:"1.1rem",sm:"1.25rem"}},children:"输入文本"}),n.jsx(q,{children:n.jsx(V,{autoFocus:!0,value:N,onChange:o=>k(o.target.value),multiline:!0,rows:6,fullWidth:!0,variant:"outlined",placeholder:"请输入要发送的文本...",sx:{mt:1,fontSize:{xs:"14px",sm:"16px"}}})}),n.jsxs(se,{sx:{px:{xs:2,sm:3},pb:{xs:1,sm:2},justifyContent:"flex-end"},children:[n.jsx(A,{onClick:()=>I(!1),color:"secondary",children:"取消"}),n.jsx(A,{onClick:()=>{v(N),C("text"),I(!1)},color:"primary",variant:"contained",children:"确认"})]})]}),n.jsx(et,{abortFileTransfer:a,onClose:()=>{T(!1)},open:ge,progress:M,setProgress:L}),n.jsx(ae,{sx:{color:"#fff",zIndex:o=>o.zIndex.drawer+9999},open:de,children:n.jsx(R,{color:"inherit"})}),n.jsx(_e,{open:W}),n.jsx(Ge,{})]})}const st="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANMAAACECAYAAAAKjB6WAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6NjdFMjg1MUU1MEJGMTFFN0IxNEZDN0U5MzZCREMyQjMiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6NjdFMjg1MUY1MEJGMTFFN0IxNEZDN0U5MzZCREMyQjMiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDo2N0UyODUxQzUwQkYxMUU3QjE0RkM3RTkzNkJEQzJCMyIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDo2N0UyODUxRDUwQkYxMUU3QjE0RkM3RTkzNkJEQzJCMyIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PrGIRRAAABbASURBVHja7F1/cFzF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";function X(a,e,t){return e<String(a).length?a.toString():Array(e-String(a).length+1).join("0")+a}function rt(a){const e=[0,4129,8258,12387,16516,20645,24774,28903,33032,37161,41290,45419,49548,53677,57806,61935,4657,528,12915,8786,21173,17044,29431,25302,37689,33560,45947,41818,54205,50076,62463,58334,9314,13379,1056,5121,25830,29895,17572,21637,42346,46411,34088,38153,58862,62927,50604,54669,13907,9842,5649,1584,30423,26358,22165,18100,46939,42874,38681,34616,63455,59390,55197,51132,18628,22757,26758,30887,2112,6241,10242,14371,51660,55789,59790,63919,35144,39273,43274,47403,23285,19156,31415,27286,6769,2640,14899,10770,56317,52188,64447,60318,39801,35672,47931,43802,27814,31879,19684,23749,11298,15363,3168,7233,60846,64911,52716,56781,44330,48395,36200,40265,32407,28342,24277,20212,15891,11826,7761,3696,65439,61374,57309,53244,48923,44858,40793,36728,37256,33193,45514,41451,53516,49453,61774,57711,4224,161,12482,8419,20484,16421,28742,24679,33721,37784,41979,46042,49981,54044,58239,62302,689,4752,8947,13010,16949,21012,25207,29270,46570,42443,38312,34185,62830,58703,54572,50445,13538,9411,5280,1153,29798,25671,21540,17413,42971,47098,34713,38840,59231,63358,50973,55100,9939,14066,1681,5808,26199,30326,17941,22068,55628,51565,63758,59695,39368,35305,47498,43435,22596,18533,30726,26663,6336,2273,14466,10403,52093,56156,60223,64286,35833,39896,43963,48026,19061,23124,27191,31254,2801,6864,10931,14994,64814,60687,56684,52557,48554,44427,40424,36297,31782,27655,23652,19525,15522,11395,7392,3265,61215,65342,53085,57212,44955,49082,36825,40952,28183,32310,20053,24180,11923,16050,3793,7920];let t=65535,r,s;for(s=0;s<a.length;s++){const i=a.charCodeAt(s);if(i>255)throw new RangeError;r=(i^t>>8)&255,t=e[r]^t<<8}return X(((t^0)&65535).toString(16).toUpperCase(),4)}function it(a){let t=[{id:"00",value:"01"},{id:"01",value:"11"},{id:"26",value:[{id:"00",value:"SG.PAYNOW"},{id:"01",value:"0"},{id:"02",value:a.uen},{id:"03",value:a.editable.toString()},{id:"04",value:a.expiry}]},{id:"52",value:"0000"},{id:"53",value:"702"},{id:"54",value:a.amount.toString()},{id:"58",value:"SG"},{id:"59",value:a.name},{id:"60",value:"Singapore"},{id:"62",value:[{id:"01",value:"Blank is fine..."}]}].reduce((r,s)=>(Array.isArray(s.value)&&(s.value=s.value.reduce((i,l)=>(i+=l.id+X(l.value.length.toString(),2)+l.value,i),"")),r+=s.id+X(s.value.length.toString(),2)+s.value,r),"");return t+="6304"+rt(t+"6304"),t}const ot=()=>{const[a,e]=c.useState(localStorage.getItem("countryCode")||"+65"),[t,r]=c.useState(localStorage.getItem("phoneNumber")||""),[s,i]=c.useState(localStorage.getItem("payNowName")||"");c.useEffect(()=>{localStorage.setItem("countryCode",a)},[a]),c.useEffect(()=>{localStorage.setItem("phoneNumber",t)},[t]),c.useEffect(()=>{localStorage.setItem("payNowName",s)},[s]);const l=y=>{e(y.target.value)},g=y=>{r(y.target.value)},w=y=>{i(y.target.value)},u={uen:`${a}${t}`,name:s||"Payee",editable:1,expiry:"20990106",amount:0,refNumber:""},p=it(u),[S,C]=c.useState(!1);return c.useEffect(()=>{const y=()=>{window.innerHeight<document.documentElement.clientHeight?C(!0):C(!1)};return window.addEventListener("resize",y),()=>{window.removeEventListener("resize",y)}},[]),n.jsxs(Oe,{maxWidth:"xs",sx:{height:S?"calc(100vh - 50px)":"100vh",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",paddingBottom:S?"50px":"0"},children:[n.jsxs(h,{sx:{width:"100%",mb:4},children:[n.jsxs(V,{select:!0,label:"国家代码",value:a,onChange:l,variant:"outlined",sx:{width:"30%",mr:1},children:[n.jsx(re,{value:"+65",children:"+65 新加坡"}),n.jsx(re,{value:"+86",children:"+86 中国"})]}),n.jsx(V,{label:"手机号",variant:"outlined",value:t,onChange:g,sx:{width:"65%"}})]}),n.jsx(h,{sx:{width:"100%",mb:4},children:n.jsx(V,{label:"PayNow 名字",variant:"outlined",fullWidth:!0,value:s,onChange:w})}),n.jsx(h,{sx:{width:"100%",display:"flex",justifyContent:"center",alignItems:"center",flexDirection:"column"},children:n.jsxs(h,{sx:{width:"80%",display:"flex",justifyContent:"center",alignItems:"center",flexDirection:"column",boxShadow:"0px 4px 12px rgba(0, 0, 0, 0.1)",padding:"16px",borderRadius:"8px",backgroundColor:"#fff"},children:[n.jsxs(h,{sx:{height:"8svh"},children:[n.jsx(h,{sx:{height:"4.4svh"},children:n.jsx("p",{style:{textAlign:"center",fontSize:"25px",margin:"0"},children:n.jsx("b",{children:s})})}),n.jsx(h,{sx:{height:"3svh"},children:n.jsx("p",{style:{textAlign:"center",color:"#645f60",fontSize:"20px",margin:"0"},children:a+" "+t})})]}),n.jsx(ce,{style:{marginBottom:"10px"},value:p,size:250,fgColor:"#771976",logoImage:st,logoHeight:60,logoWidth:90,quietZone:10,logoOpacity:1,removeQrCodeBehindLogo:!0,eyeRadius:[{outer:0,inner:0},{outer:0,inner:0},{outer:0,inner:0}]}),n.jsx(A,{variant:"contained",color:"secondary",sx:{backgroundColor:"#771976"},children:"SCAN TO PAY"})]})})]})};function at(){return n.jsx(He,{children:n.jsxs(Ye,{children:[n.jsx(ie,{path:"/",element:n.jsx(nt,{})}),n.jsx(ie,{path:"/paynow",element:n.jsx(ot,{})})]})})}je.createRoot(document.getElementById("root")).render(n.jsx(at,{}));
